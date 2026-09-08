import { describe, expect, it } from "vitest";
import {
  MAX_PAGES_PER_ALBUM,
  apiError,
  createAlbumInput,
  guestManifestSchema,
  guestPathForPublicId,
  isExpired,
  newPublicId,
  uploadIntentSchema,
  validatePhotoFile,
  validateVideoFile,
} from "./index";

describe("contracts", () => {
  it("creates opaque public ids with >=128 bits of entropy", () => {
    const a = newPublicId();
    const b = newPublicId();
    expect(a).not.toBe(b);
    // 16 bytes -> 22 base64url chars
    expect(a.length).toBeGreaterThanOrEqual(21);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects empty couple names", () => {
    expect(() => createAlbumInput.parse({ coupleName: "  " })).toThrow();
  });

  it("enforces the 30-page quota on manifest", () => {
    const pages = Array.from({ length: MAX_PAGES_PER_ALBUM + 1 }, (_, i) => ({
      markerIndex: i,
      title: `Page ${i}`,
      videoUrl: "https://cdn.example/v.mp4",
    }));
    const r = guestManifestSchema.safeParse({
      version: 1,
      revision: 1,
      markerRevision: 1,
      publicId: newPublicId(),
      album: {
        coupleName: "A & B",
        eventDate: "",
        venue: "",
        studioName: "S",
        studioCity: "C",
      },
      marker: { url: "https://cdn.example/a.mind", targetCount: 1 },
      pages,
    });
    expect(r.success).toBe(false);
  });

  it("validates upload intents and quotas", () => {
    const ok = uploadIntentSchema.safeParse({
      title: "The Muhurtham",
      photo: { mime: "image/jpeg", bytes: 1024 },
      video: { mime: "video/mp4", bytes: 8 * 1024 * 1024, durationSeconds: 18 },
    });
    expect(ok.success).toBe(true);
    const tooBig = uploadIntentSchema.safeParse({
      title: "x",
      photo: { mime: "image/png", bytes: 10 },
      video: { mime: "video/mp4", bytes: 10 },
    });
    expect(tooBig.success).toBe(false);
  });

  it("validates File objects client-side", () => {
    const photo = new File(["x"], "p.jpg", { type: "image/jpeg" });
    expect(validatePhotoFile(photo)).toBeNull();
    const badPhoto = new File(["x"], "p.png", { type: "image/png" });
    expect(validatePhotoFile(badPhoto)).toMatch(/JPEG or WebP/);
    const video = new File(["x"], "v.mp4", { type: "video/mp4" });
    expect(validateVideoFile(video)).toBeNull();
  });

  it("detects expiry", () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 86400000).toISOString())).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });

  it("builds guest paths from public ids only", () => {
    expect(guestPathForPublicId("abcDEF123_-xyz456789")).toBe("/ar/abcDEF123_-xyz456789");
  });

  it("builds api errors without leaking internals", () => {
    const e = apiError("NOT_READY", "Album is not published yet.");
    expect(e.error).toBe("AR_ALBUM_ERROR");
    expect(JSON.stringify(e)).not.toMatch(/Key|arn:aws|stack/i);
  });
});
