import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomBytes, randomUUID } from "node:crypto";
import { ddb, gsi1pkForPublic, pkAlbum, skBuild, skMeta, tableName } from "../shared/ddb";
import {
  ApiEvent,
  badRequest,
  created,
  notFound,
  ok,
  requireAdmin,
  unauthorized,
} from "../shared/response";

type Item = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build + QR routes (single Lambda):
 *  POST /albums/{id}/publish
 *  GET  /albums/{id}/builds/{buildId}
 *  POST /albums/{id}/qr/rotate
 *  POST /albums/{id}/qr/revoke
 */
export async function handler(event: ApiEvent) {
  const admin = requireAdmin(event);
  if (!admin) return unauthorized();
  const method: string = event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  const path: string = event.requestContext?.http?.path ?? event.path ?? "";
  const albumId = event.pathParameters?.["id"] ?? "";
  const buildId = event.pathParameters?.["buildId"] ?? "";
  try {
    if (method === "POST" && path.endsWith("/publish")) return await publish(albumId);
    if (method === "GET" && path.includes("/builds/")) return await buildStatus(albumId, buildId);
    if (method === "POST" && path.endsWith("/qr/rotate")) return await rotateQr(albumId);
    if (method === "POST" && path.endsWith("/qr/revoke")) return await revokeQr(albumId);
    return notFound("Unknown build route.");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Build request failed.";
    if (message.includes("INVALID") || message.includes("quota") || message.includes("No pages")) {
      return badRequest("INVALID_INPUT", message.replace(/^INVALID\s*/, ""));
    }
    throw e;
  }
}

async function publish(albumId: string) {
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const album = (meta.Item ?? null) as Item | null;
  if (!album || album["entity"] !== "ALBUM") return notFound("Album not found.");
  if (album["status"] === "expired")
    return badRequest("EXPIRED", "Expired albums cannot be published.");
  const pages = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":p": "PAGE#" },
      Limit: 60,
    }),
  );
  const count = pages.Count ?? 0;
  if (count === 0)
    return badRequest("NO_PAGES", "Add at least one photo + video page before publishing.");
  if (count > 30)
    return badRequest(
      "PAGE_QUOTA",
      "Album exceeds the 30-page limit. Split the album before publishing.",
    );

  const revision = Number(album["revision"] ?? 0) + 1;
  const newBuildId = `bld_${randomUUID().slice(0, 8)}`;
  const now = nowIso();
  const build: Item = {
    PK: pkAlbum(albumId),
    SK: skBuild(revision, newBuildId),
    entity: "BUILD",
    buildId: newBuildId,
    albumId,
    revision,
    status: "queued",
    pageCount: count,
    createdAt: now,
    updatedAt: now,
  };
  await ddb().send(
    new PutCommand({
      TableName: tableName(),
      Item: build,
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET #status = :p, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":p": "processing", ":now": now },
    }),
  );
  const queueUrl = process.env["BUILD_QUEUE_URL"];
  if (!queueUrl) throw new Error("BUILD_QUEUE_URL is not configured");
  const sqs = new SQSClient({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ albumId, buildId: newBuildId, revision }),
      MessageGroupId: albumId,
      MessageDeduplicationId: newBuildId,
    }),
  );
  return created(build);
}

async function buildStatus(albumId: string, wantedBuildId: string) {
  const res = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :b)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":b": "BUILD#" },
      Limit: 60,
    }),
  );
  const found = ((res.Items ?? []) as Item[]).find((r) => r["buildId"] === wantedBuildId);
  if (!found) return notFound("Build not found.");
  const out: Item = {
    buildId: found["buildId"],
    revision: found["revision"],
    status: found["status"],
    pageCount: found["pageCount"],
    createdAt: found["createdAt"],
    updatedAt: found["updatedAt"],
  };
  if (typeof found["error"] === "string") out["error"] = found["error"];
  return ok(out);
}

/** Rotate the high-entropy bearer link; old QR stops working after republish. */
async function rotateQr(albumId: string) {
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  if (!meta.Item) return notFound("Album not found.");
  const publicId = randomBytes(16).toString("base64url");
  const now = nowIso();
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET publicId = :p, GSI1PK = :g, #status = :draft, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":p": publicId,
        ":g": gsi1pkForPublic(publicId),
        ":draft": "draft",
        ":now": now,
      },
    }),
  );
  const after = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  return ok(after.Item);
}

/** Revoke the bearer link immediately (pointer deleted by expiry worker). */
async function revokeQr(albumId: string) {
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const prev = (meta.Item ?? null) as Item | null;
  if (!prev) return notFound("Album not found.");
  const tombstone = `REVOKED-${randomBytes(8).toString("base64url")}`;
  const now = nowIso();
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET publicId = :p, GSI1PK = :g, #status = :draft, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":p": tombstone,
        ":g": gsi1pkForPublic(tombstone),
        ":draft": "draft",
        ":now": now,
      },
    }),
  );
  try {
    const queueUrl = process.env["EXPIRY_QUEUE_URL"];
    if (queueUrl) {
      const sqs = new SQSClient({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            type: "revoke-qr",
            albumId,
            oldPublicId: prev["publicId"],
          }),
        }),
      );
    }
  } catch {
    /* revocation of the pointer is retried by the worker */
  }
  return ok({ ok: true });
}
