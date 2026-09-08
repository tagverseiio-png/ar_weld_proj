import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ddb, pkAlbum, skBuild, skMeta, tableName } from "../shared/ddb";
import {
  publishedManifestKey,
  publishedMarkerKey,
  publishedPointerKey,
  publishedVideoKey,
} from "../shared/keys";
import {
  buildManifestPages,
  nextRevisionIfWinner,
  orderPagesForBuild,
  shouldFailBuild,
} from "../shared/manifest";
// In-process MindAR compile (no CLI/npx — Lambda has no writable npm home).
// Compiler src vendored at backend/vendor/mind-ar (MIT, mind-ar@1.2.5).
// `canvas` is aliased to @napi-rs/canvas at bundle time by infra/deploy.sh.
import { OfflineCompiler } from "../vendor/mind-ar/src/image-target/offline-compiler.js";
import { loadImage } from "@napi-rs/canvas";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}
function nowIso(): string {
  return new Date().toISOString();
}

type BuildMessage = { albumId: string; buildId: string; revision: number };

/**
 * SQS -> marker-builder (reserved concurrency 1, FIFO per album).
 * Compiles ONE combined versioned .mind target on explicit publish only,
 * copies videos under immutable keys, then atomically activates the pointer.
 * An older build may never replace a newer one.
 */
export async function handler(event: { Records: Array<{ body: string }> }) {
  for (const record of event.Records ?? []) {
    const msg = JSON.parse(record.body) as BuildMessage;
    await processBuild(msg).catch(async (e) => {
      await markFailed(msg, e instanceof Error ? e.message : "Marker build failed.");
      throw e; // -> DLQ after max receives
    });
  }
  return { ok: true };
}

async function markFailed(msg: BuildMessage, error: string) {
  const safe = error.slice(0, 2000);
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(msg.albumId), SK: skBuild(msg.revision, msg.buildId) },
        UpdateExpression: "SET #status = :f, #error = :e, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status", "#error": "error" },
        ExpressionAttributeValues: { ":f": "failed", ":e": safe, ":now": nowIso() },
      }),
    );
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(msg.albumId), SK: skMeta() },
        UpdateExpression: "SET #status = :f, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":f": "failed", ":now": nowIso() },
      }),
    );
  } catch {
    /* DLQ preserves the failure */
  }
}

async function processBuild(msg: BuildMessage) {
  const bucket = env("MEDIA_BUCKET");
  const cdnOrigin = (process.env["CLOUDFRONT_ORIGIN"] ?? "").replace(/\/$/, "");
  const region = process.env["AWS_REGION"] ?? "ap-south-1";
  const s3 = new S3Client({ region });

  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(msg.albumId), SK: skBuild(msg.revision, msg.buildId) },
      UpdateExpression: "SET #status = :b, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":b": "building", ":now": nowIso() },
    }),
  );

  const metaRes = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(msg.albumId), SK: skMeta() } }),
  );
  const album = (metaRes.Item ?? null) as Record<string, unknown> | null;
  if (!album) throw new Error("Album not found for build.");
  // Revision race guard BEFORE expensive work.
  if (nextRevisionIfWinner(Number(album["revision"] ?? 0), msg.revision) === null) {
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(msg.albumId), SK: skBuild(msg.revision, msg.buildId) },
        UpdateExpression: "SET #status = :f, #error = :e, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status", "#error": "error" },
        ExpressionAttributeValues: {
          ":f": "failed",
          ":e": "Superseded by a newer publish.",
          ":now": nowIso(),
        },
      }),
    );
    return;
  }

  const pagesRes = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": pkAlbum(msg.albumId), ":p": "PAGE#" },
      Limit: 60,
    }),
  );
  const pages = (pagesRes.Items ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      pageId: String(row["pageId"]),
      title: String(row["title"] ?? "Untitled"),
      order: Number(row["order"] ?? 0),
      photoKey: String(row["photoKey"]),
      videoKey: String(row["videoKey"]),
    };
  });
  const fatal = shouldFailBuild(pages.length, 30);
  if (fatal) throw new Error(fatal);
  const ordered = orderPagesForBuild(pages);
  const publicId = String(album["publicId"]);

  // 1) Copy videos to immutable published keys (range-request compatible MP4s).
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i] as (typeof ordered)[number];
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${p.videoKey}`,
        Key: publishedVideoKey(publicId, msg.revision, i),
        MetadataDirective: "COPY",
        ContentType: "video/mp4",
      }),
    );
  }

  // 2) Compile the combined .mind target from staged photos.
  const mindBytes = await compileMindTarget(
    s3,
    bucket,
    ordered.map((p) => p.photoKey),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: publishedMarkerKey(publicId, msg.revision),
      Body: mindBytes,
      ContentType: "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  // 3) Write the immutable guest manifest (CDN URLs only).
  const cdn = (key: string) =>
    cdnOrigin ? `${cdnOrigin}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  const manifest = {
    version: 1,
    revision: msg.revision,
    markerRevision: msg.revision,
    publicId,
    album: {
      coupleName: String(album["coupleName"] ?? ""),
      eventDate: String(album["eventDate"] ?? ""),
      venue: String(album["venue"] ?? ""),
      studioName: "Marikkanu Studios",
      studioCity: "Chennai",
    },
    marker: {
      url: cdn(publishedMarkerKey(publicId, msg.revision)),
      targetCount: ordered.length,
    },
    pages: buildManifestPages(ordered, (_videoKey, markerIndex) =>
      cdn(publishedVideoKey(publicId, msg.revision, markerIndex)),
    ),
    ...(album["expiryDate"] ? { expiresAt: String(album["expiryDate"]) } : {}),
  };
  const manifestKey = publishedManifestKey(publicId, msg.revision);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  // 4) Atomically activate: conditional write so an older build never wins.
  const current = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(msg.albumId), SK: skMeta() } }),
  );
  const currentItem = (current.Item ?? null) as Record<string, unknown> | null;
  if (nextRevisionIfWinner(Number(currentItem?.["revision"] ?? 0), msg.revision) === null) {
    throw new Error("Superseded by a newer publish before activation.");
  }
  // Pointer object is tiny; short cache so rotation/expiry propagate fast.
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: publishedPointerKey(publicId),
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
      CacheControl: "public, max-age=60",
    }),
  );
  const now = nowIso();
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(msg.albumId), SK: skMeta() },
      UpdateExpression:
        "SET revision = :r, activeMarkerRevision = :r, #status = :ready, updatedAt = :now",
      ConditionExpression: "revision < :r",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":r": msg.revision, ":ready": "ready", ":now": now },
    }),
  );
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(msg.albumId), SK: skBuild(msg.revision, msg.buildId) },
      UpdateExpression: "SET #status = :ready, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":ready": "ready", ":now": now },
    }),
  );
  // Mark pages ready (ordered positions are the markerIndex contract).
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i] as (typeof ordered)[number];
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(msg.albumId), SK: `PAGE#${p.pageId}` },
        UpdateExpression: "SET #status = :ready, #o = :o, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status", "#o": "order" },
        ExpressionAttributeValues: { ":ready": "ready", ":o": i, ":now": now },
      }),
    );
  }
}

/**
 * Compile staged photos into a combined .mind file — IN PROCESS.
 * mind-ar's OfflineCompiler (tfjs CPU kernels) + @napi-rs/canvas for image
 * decode; no CLI/npx (Lambda has no writable npm home / binaries).
 */
async function compileMindTarget(
  s3: S3Client,
  bucket: string,
  photoKeys: string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "mind-"));
  try {
    const images = [];
    for (let i = 0; i < photoKeys.length; i++) {
      const key = photoKeys[i] as string;
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes || bytes.length === 0) throw new Error(`Staged photo is missing: ${key}`);
      const ext = key.toLowerCase().endsWith(".webp") ? "webp" : "jpg";
      const file = join(dir, `target-${i}.${ext}`);
      await writeFile(file, Buffer.from(bytes));
      const img = await loadImage(file);
      images.push(img);
    }
    const compiler = new OfflineCompiler();
    await compiler.compileImageTargets(images, () => undefined);
    const exported = compiler.exportData();
    if (!exported || (exported as Uint8Array).length === 0) {
      throw new Error("MindAR compiler produced an empty .mind file.");
    }
    return Buffer.from(exported as Uint8Array);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`MindAR compile failed: ${msg.slice(0, 400)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
