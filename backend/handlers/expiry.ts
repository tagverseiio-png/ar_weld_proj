import { DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CreateInvalidationCommand, CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { ddb, pkAlbum, skMeta, tableName } from "../shared/ddb";
import { publishedPointerKey } from "../shared/keys";

type Item = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Expiry worker — two entry points sharing S3/DDB cleanup:
 *  - warningHandler: EventBridge Scheduler 7 days before expiry -> SES email.
 *  - deleteHandler:  EventBridge Scheduler on the expiry date (or SQS
 *    delete-album / revoke-qr messages) -> delete all album S3 objects +
 *    metadata, invalidate the public pointer, leave QR route expired.
 * Idempotent: repeated invocations converge to deleted/expired.
 */
export async function warningHandler(event: { albumId?: string }) {
  const albumId = event.albumId ?? process.env["ALBUM_ID"];
  if (!albumId) return { ok: false, reason: "no albumId" };
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const album = (meta.Item ?? null) as Item | null;
  if (!album || album["status"] === "expired") return { ok: true, skipped: true };
  const sender = process.env["SES_SENDER"];
  const notifyTo = process.env["NOTIFY_TO"];
  if (!sender || !notifyTo) return { ok: true, skipped: true, reason: "email not configured" };
  const ses = new SESv2Client({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [notifyTo] },
      Content: {
        Simple: {
          Subject: { Data: `Album expires in 7 days: ${String(album["coupleName"] ?? albumId)}` },
          Body: {
            Text: {
              Data: `The AR album "${String(album["coupleName"] ?? albumId)}" expires on ${String(album["expiryDate"] ?? "soon")} and will be automatically deleted (photos, videos, markers, links). Download anything you need before then.`,
            },
          },
        },
      },
    }),
  );
  return { ok: true };
}

export async function deleteHandler(event: {
  albumId?: string;
  oldPublicId?: string;
  Records?: Array<{ body: string }>;
}) {
  const fromQueue = (event.Records ?? []).map(
    (r): { albumId?: string; oldPublicId?: string; type?: string } => {
      try {
        return JSON.parse(r.body) as { albumId?: string; oldPublicId?: string; type?: string };
      } catch {
        return {};
      }
    },
  );
  const targets: Array<{ albumId: string; oldPublicId?: string }> = [];
  if (event.albumId) {
    const t: { albumId: string; oldPublicId?: string } = { albumId: event.albumId };
    if (event.oldPublicId) t.oldPublicId = event.oldPublicId;
    targets.push(t);
  }
  for (const m of fromQueue) {
    if (m.albumId) {
      const t: { albumId: string; oldPublicId?: string } = { albumId: m.albumId };
      if (m.oldPublicId) t.oldPublicId = m.oldPublicId;
      targets.push(t);
    }
  }
  if (targets.length === 0) return { ok: false, reason: "no targets" };
  for (const t of targets) {
    await deleteAlbumEverywhere(t.albumId, t.oldPublicId).catch((e) => {
      console.error("expiry delete failed", t.albumId, e);
      throw e;
    });
  }
  return { ok: true, deleted: targets.length };
}

async function deleteAlbumEverywhere(albumId: string, oldPublicId?: string) {
  const region = process.env["AWS_REGION"] ?? "ap-south-1";
  const bucket = process.env["MEDIA_BUCKET"];
  if (!bucket) throw new Error("MEDIA_BUCKET is not configured");
  const s3 = new S3Client({ region });

  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const current = (meta.Item ?? null) as Item | null;
  const publicIds = new Set<string>();
  if (current && typeof current["publicId"] === "string")
    publicIds.add(current["publicId"] as string);
  if (oldPublicId) publicIds.add(oldPublicId);

  const prefixes = [`uploads/${albumId}/`, `quarantine/${albumId}/`];
  for (const pid of publicIds) {
    if (!pid.startsWith("REVOKED-")) prefixes.push(`published/${pid}/`);
  }
  for (const prefix of prefixes) {
    let token: string | undefined;
    do {
      const listed = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 500,
        }),
      );
      for (const obj of listed.Contents ?? []) {
        if (obj.Key) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  }

  for (const pid of publicIds) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: publishedPointerKey(pid) }));
    } catch {
      /* idempotent */
    }
  }
  try {
    const distId = process.env["CLOUDFRONT_DISTRIBUTION_ID"];
    if (distId) {
      const cf = new CloudFrontClient({ region: "us-east-1" });
      const paths = [...publicIds].map((pid) => `/published/${pid}/*`);
      if (paths.length > 0) {
        await cf.send(
          new CreateInvalidationCommand({
            DistributionId: distId,
            InvalidationBatch: {
              CallerReference: `${albumId}-${Date.now()}`,
              Paths: { Quantity: paths.length, Items: paths },
            },
          }),
        );
      }
    }
  } catch {
    /* invalidation is best-effort; S3 deletes already revoke content */
  }

  const rows = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId) },
      Limit: 100,
    }),
  );
  for (const row of (rows.Items ?? []) as Item[]) {
    const sk = row["SK"] as string;
    if (sk !== skMeta()) {
      await ddb()
        .send(new DeleteCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: sk } }))
        .catch(() => undefined);
    }
  }
  await ddb()
    .send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pkAlbum(albumId), SK: skMeta() },
        UpdateExpression:
          "SET #status = :expired, updatedAt = :now REMOVE publicId, GSI1PK, expiryDate",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":expired": "expired", ":now": nowIso() },
      }),
    )
    .catch(() => undefined);
}
