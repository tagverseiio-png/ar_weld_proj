/**
 * Pure build/manifest logic — no AWS SDK imports so it is unit-testable
 * in the frontend vitest run as well as in Lambda.
 */

export type PublishPage = {
  pageId: string;
  title: string;
  order: number;
  photoKey: string;
  videoKey: string;
};

export type ManifestPage = { markerIndex: number; title: string; videoUrl: string };

/** Sort snapshot deterministically; markerIndex = position in ordered list. */
export function orderPagesForBuild(pages: PublishPage[]): PublishPage[] {
  return [...pages].sort((a, b) => a.order - b.order || (a.pageId < b.pageId ? -1 : 1));
}

/**
 * Revision race guard: an older build may never replace a newer one.
 * Returns the revision to publish, or null when this build already lost.
 */
export function nextRevisionIfWinner(
  currentRevision: number,
  attemptedRevision: number,
): number | null {
  if (attemptedRevision <= currentRevision) return null;
  return attemptedRevision;
}

export function buildManifestPages(
  ordered: PublishPage[],
  cdnForVideo: (videoKey: string, markerIndex: number) => string,
): ManifestPage[] {
  return ordered.map((p, markerIndex) => ({
    markerIndex,
    title: p.title,
    videoUrl: cdnForVideo(p.videoKey, markerIndex),
  }));
}

export function shouldFailBuild(pageCount: number, maxPages: number): string | null {
  if (pageCount === 0) return "Album has no pages to publish.";
  if (pageCount > maxPages)
    return `Album exceeds the ${maxPages}-page limit. Split the album before publishing.`;
  return null;
}
