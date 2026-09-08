import { describe, expect, it } from "vitest";
import {
  buildManifestPages,
  nextRevisionIfWinner,
  orderPagesForBuild,
  shouldFailBuild,
} from "./manifest";
import {
  publishedManifestKey,
  publishedMarkerKey,
  publishedPointerKey,
  publishedVideoKey,
} from "./keys";

describe("build revision guard", () => {
  it("rejects older builds so they never replace newer ones", () => {
    expect(nextRevisionIfWinner(3, 3)).toBeNull();
    expect(nextRevisionIfWinner(3, 2)).toBeNull();
    expect(nextRevisionIfWinner(3, 4)).toBe(4);
  });
});

describe("page ordering", () => {
  it("maps ordered pages to contiguous markerIndex values", () => {
    const ordered = orderPagesForBuild([
      { pageId: "b", title: "B", order: 1, photoKey: "p1", videoKey: "v1" },
      { pageId: "a", title: "A", order: 0, photoKey: "p2", videoKey: "v2" },
    ]);
    expect(ordered.map((p) => p.pageId)).toEqual(["a", "b"]);
    const pages = buildManifestPages(ordered, (_k, i) => `https://cdn.example/v${i}.mp4`);
    expect(pages).toEqual([
      { markerIndex: 0, title: "A", videoUrl: "https://cdn.example/v0.mp4" },
      { markerIndex: 1, title: "B", videoUrl: "https://cdn.example/v1.mp4" },
    ]);
  });

  it("fails empty or over-quota builds with actionable errors", () => {
    expect(shouldFailBuild(0, 30)).toMatch(/no pages/i);
    expect(shouldFailBuild(31, 30)).toMatch(/30-page/);
    expect(shouldFailBuild(30, 30)).toBeNull();
  });
});

describe("key layout", () => {
  it("keeps published assets immutable and versioned", () => {
    expect(publishedMarkerKey("pub123", 2)).toBe("published/pub123/v2/marker.mind");
    expect(publishedVideoKey("pub123", 2, 0)).toBe("published/pub123/v2/video-0.mp4");
    expect(publishedManifestKey("pub123", 2)).toBe("published/pub123/v2/manifest.json");
    expect(publishedPointerKey("pub123")).toBe("published/pub123/manifest.latest.json");
  });
});
