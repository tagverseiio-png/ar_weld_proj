import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes, randomUUID } from "node:crypto";
import { ddb, gsi1pkForPublic, pkAlbum, skMeta, tableName } from "../shared/ddb";
import {
  ApiEvent,
  badRequest,
  conflict,
  corsPreflight,
  created,
  notFound,
  ok,
  parseBody,
  requireAdmin,
  unauthorized,
} from "../shared/response";

type Item = Record<string, unknown>;

function toPublicId(): string {
  return randomBytes(16).toString("base64url");
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiryInFuture(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("expiryDate must be an ISO date string");
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) throw new Error("expiryDate must be an ISO date string");
  if (t <= Date.now()) throw new Error("expiryDate must be in the future");
  return new Date(t).toISOString();
}

/** Route: ANY /albums and /albums/{id} -> single Lambda via HTTP API routeKeys. */
export async function handler(event: ApiEvent) {
  const httpMethod = event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  if (httpMethod === "OPTIONS") return corsPreflight(event);
  const admin = requireAdmin(event);
  if (!admin) return unauthorized();
  const routeKey: string = event.requestContext?.http?.method
    ? `${event.requestContext.http.method} ${event.requestContext.http.path}`
    : `${event.httpMethod ?? "GET"} ${event.path ?? ""}`;
  const id = event.pathParameters?.["id"];

  try {
    if (routeKey.startsWith("GET ") && !id) return await listAlbums();
    if (routeKey.startsWith("POST ") && !id) return await createAlbum(parseBody(event));
    if (id && routeKey.startsWith("GET ")) return await getAlbum(id);
    if (id && (routeKey.startsWith("PATCH ") || routeKey.startsWith("PUT ")))
      return await updateAlbum(id, parseBody(event));
    if (id && routeKey.startsWith("DELETE ")) return await deleteAlbumRecord(id);
    return notFound("Unknown albums route.");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed.";
    if (message.includes("expiryDate") || message.includes("coupleName"))
      return badRequest("INVALID_INPUT", message);
    if (message.includes("ConditionalCheckFailed"))
      return conflict("CONFLICT", "Album changed. Reload and retry.");
    throw e;
  }
}

async function listAlbums() {
  // Single-studio scale: scan META rows (tiny). Paginate defensively.
  const res = await ddb().send(
    new ScanCommand({
      TableName: tableName(),
      FilterExpression: "SK = :meta AND entity = :album AND #status <> :expired",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":meta": skMeta(),
        ":album": "ALBUM",
        ":expired": "expired",
      },
      Limit: 100,
    }),
  );
  const items = ((res.Items ?? []) as Item[]).sort((a, b) =>
    String(b["createdAt"]).localeCompare(String(a["createdAt"])),
  );
  return ok(items);
}

async function createAlbum(body: unknown) {
  const input = (body ?? {}) as {
    coupleName?: unknown;
    eventDate?: unknown;
    venue?: unknown;
    expiryDate?: unknown;
  };
  const coupleName = typeof input.coupleName === "string" ? input.coupleName.trim() : "";
  if (!coupleName || coupleName.length > 120)
    return badRequest("INVALID_INPUT", "coupleName is required (1–120 chars).");
  const eventDate = typeof input.eventDate === "string" ? input.eventDate.slice(0, 60) : "";
  const venue = typeof input.venue === "string" ? input.venue.slice(0, 160) : "";
  let expiryDate: string | undefined;
  try {
    expiryDate = expiryInFuture(input.expiryDate);
  } catch (e) {
    return badRequest("INVALID_INPUT", e instanceof Error ? e.message : "Invalid expiryDate.");
  }
  const now = nowIso();
  const albumId = `alb_${randomUUID().slice(0, 8)}${Date.now().toString(36)}`;
  const publicId = toPublicId();
  const item: Item = {
    PK: pkAlbum(albumId),
    SK: skMeta(),
    entity: "ALBUM",
    albumId,
    publicId,
    coupleName,
    eventDate,
    venue,
    status: "draft",
    revision: 0,
    activeMarkerRevision: 0,
    pageCount: 0,
    ...(expiryDate ? { expiryDate } : {}),
    GSI1PK: gsi1pkForPublic(publicId),
    GSI1SK: "META",
    createdAt: now,
    updatedAt: now,
  };
  await ddb().send(
    new PutCommand({
      TableName: tableName(),
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return created(item);
}

async function getAlbum(albumId: string) {
  const meta = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const item = (meta.Item ?? null) as Item | null;
  if (!item || item["entity"] !== "ALBUM") return notFound("Album not found.");
  const pages = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :page)",
      ExpressionAttributeValues: { ":pk": pkAlbum(albumId), ":page": "PAGE#" },
      Limit: 60,
    }),
  );
  const sorted = ((pages.Items ?? []) as Item[]).sort(
    (a, b) => Number(a["order"] ?? 0) - Number(b["order"] ?? 0),
  );
  return ok({ ...item, pages: sorted });
}

async function updateAlbum(albumId: string, body: unknown) {
  const input = (body ?? {}) as {
    coupleName?: unknown;
    eventDate?: unknown;
    venue?: unknown;
    expiryDate?: unknown;
  };
  const existing = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  const current = (existing.Item ?? null) as Item | null;
  if (!current) return notFound("Album not found.");
  if (current["status"] === "expired")
    return badRequest("EXPIRED", "Expired albums cannot be edited.");
  const patch: Item = { updatedAt: nowIso() };
  if (input.coupleName !== undefined) {
    const v = String(input.coupleName ?? "").trim();
    if (!v || v.length > 120) return badRequest("INVALID_INPUT", "coupleName must be 1–120 chars.");
    patch["coupleName"] = v;
  }
  if (input.eventDate !== undefined)
    patch["eventDate"] = String(input.eventDate ?? "").slice(0, 60);
  if (input.venue !== undefined) patch["venue"] = String(input.venue ?? "").slice(0, 160);
  let removeExpiry = false;
  if (input.expiryDate !== undefined) {
    try {
      const v = expiryInFuture(input.expiryDate === null ? undefined : input.expiryDate);
      if (v) patch["expiryDate"] = v;
      else removeExpiry = true;
    } catch (e) {
      return badRequest("INVALID_INPUT", e instanceof Error ? e.message : "Invalid expiryDate.");
    }
    if (input.expiryDate === null) removeExpiry = true;
  }
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  let updateExpr = `SET ${sets.join(", ")}`;
  if (removeExpiry) updateExpr += " REMOVE expiryDate";
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
  const after = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  return ok(after.Item);
}

/**
 * Application-controlled deletion (admin-selected expiry or manual delete).
 * Removes metadata rows; S3 objects + CloudFront invalidation happen in the
 * expiry worker so manual deletes and scheduled deletes share one path.
 */
async function deleteAlbumRecord(albumId: string) {
  const existing = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK: pkAlbum(albumId), SK: skMeta() } }),
  );
  if (!existing.Item) return notFound("Album not found.");
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: pkAlbum(albumId), SK: skMeta() },
      UpdateExpression: "SET #status = :deleted, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":deleted": "expired", ":now": nowIso() },
    }),
  );
  try {
    const queueUrl = process.env["EXPIRY_QUEUE_URL"];
    if (queueUrl) {
      const { SQSClient, SendMessageCommand } = await import("@aws-sdk/client-sqs");
      const sqs = new SQSClient({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ type: "delete-album", albumId, reason: "manual" }),
        }),
      );
    }
  } catch {
    /* cleanup remains retryable via expiry worker/scheduler */
  }
  return ok({ ok: true });
}
