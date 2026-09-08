import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ddb, pkAlbum, skMeta, skPage, tableName } from "../shared/ddb";
import { stagingPhotoKey, stagingVideoKey } from "../shared/keys";
import {
  ApiEvent,
  badRequest,
  created,
  notFound,
  ok,
  parseBody,
  requireAdmin,
  unauthorized,
} from "../shared/response";

const MAX_PAGES = 30;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type Item = Record<string, unknown>;

function bucket(): string {
  const b = process.env["MEDIA_BUCKET"];
  if (!b) throw new Error("MEDIA_BUCKET is not configured");
  return b;
}
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Upload + page routes (single Lambda):
 *  POST   /albums/{id}/upload-sessions
 *  POST   /albums/{id}/upload-sessions/{pageId}/complete
 *  DELETE /albums/{id}/pages/{pageId}
 *  POST   /albums/{id}/pages/reorder
 */
export async function handler(event: ApiEvent) {
  const admin = requireAdmin(event);
  if (!admin) return unauthorized();
  const method: string = event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  const path: string = event.requestContext?.http?.path ?? event.path ?? "";
  const albumId = event.pathParameters?.["id"] ?? "";
  const pageId = event.pathParameters?.["pageId"] ?? "";
  try {
    if (method === "POST" && path.endsWith("/upload-sessions"))
      return await createSession(albumId, parseBody(event));
    if (method === "POST" && path.includes("/upload-sessions/") && path.endsWith("/complete"))
      return await completeSession(albumId, pageId);
    if (method === "DELETE" && path.includes("/pages/")) return await deletePage(albumId, pageId);
    if (method === "POST" && path.endsWith("/pages/reorder"))
      return await reorderPages(albumId, parseBody(event));
    return notFound("Unknown upload route.");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed.";
    if (message.includes("quota") || message.includes("INVALID") || message.includes("exceed")) {
      return badRequest("INVALID_INPUT", message);
    }
    throw e;
  }
}

async function assertEditableAlbum(albumId: string): Promise<Item> {
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const item = (meta.Item ?? null) as Item | null;
  if (!item || item["entity"] !== "ALBUM") throw new Error("INVALID album not found");
  if (item["status"] === "expired") throw new Error("INVALID expired albums cannot be edited");
  return item;
}

async function pageCount(albumId: string): Promise<number> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":p": "PAGE#" },
      Select: "COUNT",
    }),
  );
  return res.Count ?? 0;
}

async function createSession(albumId: string, body: unknown) {
  await assertEditableAlbum(albumId);
  const count = await pageCount(albumId);
  if (count >= MAX_PAGES)
    return badRequest("PAGE_QUOTA", `Album already has the maximum ${MAX_PAGES} pages.`);
  const input = (body ?? {}) as {
    title?: unknown;
    photo?: { mime?: unknown; bytes?: unknown };
    video?: { mime?: unknown; bytes?: unknown; durationSeconds?: unknown };
  };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 120)
    return badRequest("INVALID_INPUT", "title is required (1–120 chars).");
  const photoMime = input.photo?.mime;
  const videoMime = input.video?.mime;
  const photoBytes = Number(input.photo?.bytes ?? 0);
  const videoBytes = Number(input.video?.bytes ?? 0);
  if (photoMime !== "image/jpeg" && photoMime !== "image/webp")
    return badRequest("INVALID_INPUT", "photo.mime must be image/jpeg or image/webp.");
  if (videoMime !== "video/mp4")
    return badRequest("INVALID_INPUT", "video.mime must be video/mp4.");
  if (!Number.isFinite(photoBytes) || photoBytes <= 0 || photoBytes > MAX_PHOTO_BYTES) {
    return badRequest("INVALID_INPUT", "photo.bytes exceeds the 10 MB limit.");
  }
  if (!Number.isFinite(videoBytes) || videoBytes <= 0 || videoBytes > MAX_VIDEO_BYTES) {
    return badRequest("INVALID_INPUT", "video.bytes exceeds the 50 MB limit.");
  }

  const pageId = `pg_${randomUUID().slice(0, 8)}${Date.now().toString(36)}`;
  const ext = photoMime === "image/webp" ? "webp" : "jpg";
  const photoKey = stagingPhotoKey(albumId, pageId, ext);
  const videoKey = stagingVideoKey(albumId, pageId);
  const s3 = new S3Client({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
  const expiresIn = 900;
  const [photoUploadUrl, videoUploadUrl] = await Promise.all([
    getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket(),
        Key: photoKey,
        ContentType: photoMime as string,
        ContentLength: photoBytes,
      }),
      { expiresIn },
    ),
    getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket(),
        Key: videoKey,
        ContentType: videoMime as string,
        ContentLength: videoBytes,
      }),
      { expiresIn },
    ),
  ]);
  const now = nowIso();
  await ddb().send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: pkAlbum(albumId),
        SK: skPage(pageId),
        entity: "PAGE",
        pageId,
        albumId,
        title,
        order: count,
        photoKey,
        videoKey,
        photoBytes,
        videoBytes,
        photoMime,
        videoMime,
        status: "uploaded",
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET pageCount = :c, #status = :draft, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":c": count + 1, ":draft": "draft", ":now": now },
    }),
  );
  return created({
    pageId,
    photoKey,
    videoKey,
    photoUploadUrl,
    videoUploadUrl,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
}

async function completeSession(albumId: string, pageId: string) {
  const existing = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skPage(pageId) } }),
  );
  const page = (existing.Item ?? null) as Item | null;
  if (!page || page["entity"] !== "PAGE") return notFound("Upload session not found.");
  const s3 = new S3Client({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
  try {
    const [photoHead, videoHead] = await Promise.all([
      s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: String(page["photoKey"]) })),
      s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: String(page["videoKey"]) })),
    ]);
    if ((photoHead.ContentLength ?? 0) > MAX_PHOTO_BYTES)
      return badRequest("INVALID_INPUT", "Uploaded photo exceeds 10 MB.");
    if ((videoHead.ContentLength ?? 0) > MAX_VIDEO_BYTES)
      return badRequest("INVALID_INPUT", "Uploaded video exceeds 50 MB.");
  } catch {
    return badRequest(
      "UPLOAD_INCOMPLETE",
      "Both photo and video must finish uploading before completing. Retry the failed part.",
    );
  }
  const now = nowIso();
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skPage(pageId) },
      UpdateExpression: "SET #status = :s, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": "uploaded", ":now": now },
    }),
  );
  const after = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skPage(pageId) } }),
  );
  return ok(after.Item);
}

async function deletePage(albumId: string, pageId: string) {
  const existing = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skPage(pageId) } }),
  );
  if (!existing.Item) return notFound("Page not found.");
  await ddb().send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skPage(pageId) },
    }),
  );
  const res = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":p": "PAGE#" },
      Limit: 60,
    }),
  );
  const sorted = ((res.Items ?? []) as Item[]).sort(
    (a, b) => Number(a["order"] ?? 0) - Number(b["order"] ?? 0),
  );
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i] as Item;
    if (row["order"] !== i) {
      await ddb().send(
        new UpdateCommand({
          TableName: tableName(),
          Key: { PK: pkAlbum(albumId), SK: String(row["SK"]) },
          UpdateExpression: "SET #o = :o, updatedAt = :now",
          ExpressionAttributeNames: { "#o": "order" },
          ExpressionAttributeValues: { ":o": i, ":now": nowIso() },
        }),
      );
    }
  }
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET pageCount = :c, #status = :draft, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":c": sorted.length, ":draft": "draft", ":now": nowIso() },
    }),
  );
  return ok({ ok: true });
}

async function reorderPages(albumId: string, body: unknown) {
  const input = (body ?? {}) as { orderedPageIds?: unknown };
  if (!Array.isArray(input.orderedPageIds) || input.orderedPageIds.length === 0) {
    return badRequest("INVALID_INPUT", "orderedPageIds must be a non-empty array.");
  }
  const ids = input.orderedPageIds.map(String);
  if (ids.length > MAX_PAGES)
    return badRequest("PAGE_QUOTA", `Album is limited to ${MAX_PAGES} pages.`);
  const res = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":p": "PAGE#" },
      Limit: 60,
    }),
  );
  const existingIds = new Set(((res.Items ?? []) as Item[]).map((r) => String(r["pageId"])));
  if (ids.length !== existingIds.size || !ids.every((x) => existingIds.has(x))) {
    return badRequest("INVALID_INPUT", "orderedPageIds must contain exactly the album's page ids.");
  }
  for (let i = 0; i < ids.length; i++) {
    const pid = ids[i] as string;
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(albumId), SK: skPage(pid) },
        UpdateExpression: "SET #o = :o, updatedAt = :now",
        ExpressionAttributeNames: { "#o": "order" },
        ExpressionAttributeValues: { ":o": i, ":now": nowIso() },
      }),
    );
  }
  return ok({ ok: true });
}
