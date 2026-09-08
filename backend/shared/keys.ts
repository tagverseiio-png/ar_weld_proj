/** S3 key layout — single source of truth for Lambdas and docs. */

export function stagingPhotoKey(albumId: string, pageId: string, ext: "jpg" | "webp"): string {
  return `uploads/${albumId}/${pageId}/photo.${ext}`;
}

export function stagingVideoKey(albumId: string, pageId: string): string {
  return `uploads/${albumId}/${pageId}/video.mp4`;
}

export function publishedPrefix(publicId: string, revision: number): string {
  return `published/${publicId}/v${revision}`;
}

export function publishedMarkerKey(publicId: string, revision: number): string {
  return `${publishedPrefix(publicId, revision)}/marker.mind`;
}

export function publishedVideoKey(publicId: string, revision: number, markerIndex: number): string {
  return `${publishedPrefix(publicId, revision)}/video-${markerIndex}.mp4`;
}

export function publishedManifestKey(publicId: string, revision: number): string {
  return `${publishedPrefix(publicId, revision)}/manifest.json`;
}

/** Mutable pointer to the active immutable revision (short cache). */
export function publishedPointerKey(publicId: string): string {
  return `published/${publicId}/manifest.latest.json`;
}

export function quarantineKey(albumId: string, name: string): string {
  return `quarantine/${albumId}/${Date.now()}-${name}`;
}
