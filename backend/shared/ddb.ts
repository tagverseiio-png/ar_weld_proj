import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let doc: DynamoDBDocumentClient | null = null;

export function ddb(): DynamoDBDocumentClient {
  if (!doc) {
    const client = new DynamoDBClient({ region: process.env["AWS_REGION"] ?? "ap-south-1" });
    doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return doc;
}

export const tableName = () => {
  const t = process.env["TABLE_NAME"];
  if (!t) throw new Error("TABLE_NAME is not configured");
  return t;
};

// Single-table key helpers.
export const pkAlbum = (albumId: string) => `ALBUM#${albumId}`;
export const skMeta = () => "META";
export const skPage = (pageId: string) => `PAGE#${pageId}`;
export const skBuild = (revision: number, buildId: string) =>
  `BUILD#${String(revision).padStart(6, "0")}#${buildId}`;
export const gsi1pkForPublic = (publicId: string) => `PUBLIC#${publicId}`;
