import { z } from "zod";

/**
 * Shared domain contracts for AR Wedding Moments.
 * Used by the TanStack frontend AND mirrored by backend Lambda validation.
 * Keep this file browser-safe (no Node/AWS imports).
 */

// ---------------------------------------------------------------- quotas

export const MAX_PAGES_PER_ALBUM = 30;
export const MAX_GUESTS_PER_ALBUM = 200;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB hard cap (target ~8 MB/clip)
export const RECOMMENDED_VIDEO_BYTES = 8 * 1024 * 1024;
export const MIN_VIDEO_SECONDS = 3;
export const MAX_VIDEO_SECONDS = 60;
export const RECOMMENDED_VIDEO_SECONDS_MIN = 10;
export const RECOMMENDED_VIDEO_SECONDS_MAX = 30;

export const ALLOWED_PHOTO_MIME = ["image/jpeg", "image/webp"] as const;
export const ALLOWED_VIDEO_MIME = ["video/mp4"] as const;
export const ALLOWED_VIDEO_CODEC_HINT = "avc1"; // H.264 + AAC in MP4

// ---------------------------------------------------------------- ids

/** Internal DynamoDB partition id: `alb_<uuidish>` */
export const internalAlbumId = z.string().min(4).max(80);
/** Opaque public bearer id printed in QR: >=128 bits of randomness, base64url. */
export const publicAlbumId = z
  .string()
  .min(20)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "public id must be base64url");
export const pageIdSchema = z.string().min(1).max(80);
export const buildIdSchema = z.string().min(1).max(80);

/** Generate an opaque public id with ~128 bits of entropy (browser + node safe). */
export function newPublicId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let bin = "";
  buf.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newInternalId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// ---------------------------------------------------------------- enums

export const albumStatusSchema = z.enum(["draft", "processing", "ready", "failed", "expired"]);
export type AlbumStatus = z.infer<typeof albumStatusSchema>;

export const pageStatusSchema = z.enum(["uploaded", "processing", "ready", "failed"]);
export type PageStatus = z.infer<typeof pageStatusSchema>;

export const buildStatusSchema = z.enum(["queued", "building", "ready", "failed"]);
export type BuildStatus = z.infer<typeof buildStatusSchema>;

// ---------------------------------------------------------------- album + page

export const albumSchema = z.object({
  albumId: internalAlbumId,
  publicId: publicAlbumId,
  coupleName: z.string().min(1).max(120),
  eventDate: z.string().max(60).optional().default(""),
  venue: z.string().max(160).optional().default(""),
  status: albumStatusSchema,
  /** Active published manifest revision. 0 = never published. */
  revision: z.number().int().min(0).default(0),
  activeMarkerRevision: z.number().int().min(0).default(0),
  pageCount: z.number().int().min(0).max(MAX_PAGES_PER_ALBUM).default(0),
  expiryDate: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AlbumRecord = z.infer<typeof albumSchema>;

export const createAlbumInput = z.object({
  coupleName: z.string().trim().min(1).max(120),
  eventDate: z.string().trim().max(60).optional().default(""),
  venue: z.string().trim().max(160).optional().default(""),
  /** ISO date; must be in the future. Deletion runs on this date. */
  expiryDate: z.string().datetime({ offset: true }).optional(),
});
export type CreateAlbumInput = z.infer<typeof createAlbumInput>;

export const updateAlbumInput = z.object({
  coupleName: z.string().trim().min(1).max(120).optional(),
  eventDate: z.string().trim().max(60).optional(),
  venue: z.string().trim().max(160).optional(),
  expiryDate: z.string().datetime({ offset: true }).nullable().optional(),
});
export type UpdateAlbumInput = z.infer<typeof updateAlbumInput>;

export const pageSchema = z.object({
  pageId: pageIdSchema,
  albumId: internalAlbumId,
  title: z.string().min(1).max(120),
  /** Zero-based anchor order; maps 1:1 to MindAR markerIndex. */
  order: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES_PER_ALBUM - 1),
  photoKey: z.string().min(1),
  videoKey: z.string().min(1),
  photoBytes: z.number().int().positive().max(MAX_PHOTO_BYTES).optional(),
  videoBytes: z.number().int().positive().max(MAX_VIDEO_BYTES).optional(),
  photoMime: z.enum(ALLOWED_PHOTO_MIME).optional(),
  videoMime: z.enum(ALLOWED_VIDEO_MIME).optional(),
  status: pageStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PageRecord = z.infer<typeof pageSchema>;

// ---------------------------------------------------------------- uploads (presigned, browser -> S3)

export const uploadIntentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  photo: z.object({
    mime: z.enum(ALLOWED_PHOTO_MIME),
    bytes: z.number().int().positive().max(MAX_PHOTO_BYTES),
    checksumSha256Hex: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .optional(),
  }),
  video: z.object({
    mime: z.enum(ALLOWED_VIDEO_MIME),
    bytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
    /** Client-reported duration seconds; server trusts but re-checks on finalize when possible. */
    durationSeconds: z.number().min(1).max(MAX_VIDEO_SECONDS).optional(),
  }),
});
export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const uploadSessionSchema = z.object({
  pageId: pageIdSchema,
  photoKey: z.string().min(1),
  videoKey: z.string().min(1),
  photoUploadUrl: z.string().url(),
  videoUploadUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const completeUploadInput = z.object({
  pageId: pageIdSchema,
});
export type CompleteUploadInput = z.infer<typeof completeUploadInput>;

// ---------------------------------------------------------------- builds

export const buildRecordSchema = z.object({
  buildId: buildIdSchema,
  albumId: internalAlbumId,
  revision: z.number().int().min(1),
  status: buildStatusSchema,
  pageCount: z.number().int().min(1).max(MAX_PAGES_PER_ALBUM),
  error: z.string().max(2000).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type BuildRecord = z.infer<typeof buildRecordSchema>;

// ---------------------------------------------------------------- public guest manifest (CloudFront static JSON)

/** What the guest phone downloads. CDN URLs only — never internal keys or errors. */
export const guestManifestSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(1),
  markerRevision: z.number().int().min(1),
  publicId: publicAlbumId,
  album: z.object({
    coupleName: z.string(),
    eventDate: z.string(),
    venue: z.string(),
    studioName: z.string(),
    studioCity: z.string(),
  }),
  marker: z.object({
    url: z.string().url(),
    targetCount: z.number().int().min(1).max(MAX_PAGES_PER_ALBUM),
  }),
  pages: z
    .array(
      z.object({
        markerIndex: z.number().int().min(0),
        title: z.string(),
        videoUrl: z.string().url(),
      }),
    )
    .min(1)
    .max(MAX_PAGES_PER_ALBUM),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type GuestManifest = z.infer<typeof guestManifestSchema>;

// ---------------------------------------------------------------- api envelopes

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  message: z.string(),
  buildId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(code: string, message: string, buildId?: string): ApiError {
  return { error: "AR_ALBUM_ERROR", code, message, ...(buildId ? { buildId } : {}) };
}

// ---------------------------------------------------------------- media validation (client side, before upload)

export function validatePhotoFile(file: File): string | null {
  if (!(ALLOWED_PHOTO_MIME as readonly string[]).includes(file.type)) {
    return "Photo must be JPEG or WebP.";
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `Photo must be under ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.`;
  }
  if (file.size === 0) return "Photo file is empty.";
  return null;
}

export function validateVideoFile(file: File): string | null {
  if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(file.type)) {
    return "Video must be MP4 (H.264 + AAC).";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video must be under ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB. Keep clips 10–30s at 720p (~8 MB).`;
  }
  if (file.size === 0) return "Video file is empty.";
  return null;
}

export function isExpired(expiryDate?: string, now = new Date()): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate).getTime() <= now.getTime();
}

/** Canonical guest path for an opaque public id (never the internal id). */
export function guestPathForPublicId(publicId: string): string {
  return `/ar/${publicId}`;
}
