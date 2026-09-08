import { config, isProductionApiConfigured } from "./config";
import { getIdToken } from "./auth";
import type {
  AlbumRecord,
  ApiError,
  BuildRecord,
  GuestManifest,
  PageRecord,
  UploadSession,
} from "@/contracts";

/**
 * Typed API client for the AWS HTTP API.
 * Throws ApiError-shaped errors; callers map them to toasts/empty states.
 * When VITE_API_BASE_URL is unset, callers must fall back to mock-api.
 */

async function req<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.headers) {
    for (const [k, v] of new Headers(init.headers).entries()) headers[k] = v;
  }
  if (auth) {
    const token = getIdToken();
    if (!token)
      throw {
        error: "AR_ALBUM_ERROR",
        code: "NOT_AUTHENTICATED",
        message: "Sign in first.",
      } as ApiError;
    headers["authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!res.ok)
    throw (
      (data as ApiError) ?? {
        error: "AR_ALBUM_ERROR",
        code: "REQUEST_FAILED",
        message: `HTTP ${res.status}`,
      }
    );
  return data;
}

export const prodApi = {
  configured: isProductionApiConfigured(),

  listAlbums: () => req<AlbumRecord[]>(`/albums`),
  createAlbum: (input: {
    coupleName: string;
    eventDate?: string;
    venue?: string;
    expiryDate?: string;
  }) => req<AlbumRecord>(`/albums`, { method: "POST", body: JSON.stringify(input) }),
  getAlbum: (albumId: string) => req<AlbumRecord & { pages: PageRecord[] }>(`/albums/${albumId}`),
  updateAlbum: (albumId: string, input: Record<string, unknown>) =>
    req<AlbumRecord>(`/albums/${albumId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAlbum: (albumId: string) => req<{ ok: true }>(`/albums/${albumId}`, { method: "DELETE" }),

  createUploadSession: (albumId: string, intent: unknown) =>
    req<UploadSession>(`/albums/${albumId}/upload-sessions`, {
      method: "POST",
      body: JSON.stringify(intent),
    }),
  completeUpload: (albumId: string, pageId: string) =>
    req<PageRecord>(`/albums/${albumId}/upload-sessions/${pageId}/complete`, {
      method: "POST",
      body: "{}",
    }),
  deletePage: (albumId: string, pageId: string) =>
    req<{ ok: true }>(`/albums/${albumId}/pages/${pageId}`, { method: "DELETE" }),
  reorderPages: (albumId: string, orderedPageIds: string[]) =>
    req<{ ok: true }>(`/albums/${albumId}/pages/reorder`, {
      method: "POST",
      body: JSON.stringify({ orderedPageIds }),
    }),

  publish: (albumId: string) =>
    req<BuildRecord>(`/albums/${albumId}/publish`, { method: "POST", body: "{}" }),
  buildStatus: (albumId: string, buildId: string) =>
    req<BuildRecord>(`/albums/${albumId}/builds/${buildId}`),
  rotateQr: (albumId: string) =>
    req<AlbumRecord>(`/albums/${albumId}/qr/rotate`, { method: "POST", body: "{}" }),
  revokeQr: (albumId: string) =>
    req<AlbumRecord>(`/albums/${albumId}/qr/revoke`, { method: "POST", body: "{}" }),
};

/** Guest manifest lives on CloudFront — no auth, immutable, cacheable. */
export async function fetchGuestManifest(publicId: string): Promise<GuestManifest> {
  // Production layout: https://<cloudfront>/published/<publicId>/manifest.<revision>.json
  // The pointer file `manifest.latest.json` resolves the active revision atomically.
  const base = config.cloudfrontOrigin.replace(/\/$/, "");
  if (!base) throw new Error("CloudFront origin not configured");
  const pointer = await fetch(`${base}/published/${publicId}/manifest.latest.json`, {
    cache: "no-store",
  });
  if (pointer.status === 404)
    throw {
      error: "AR_ALBUM_ERROR",
      code: "NOT_FOUND",
      message: "Album link is invalid.",
    } as ApiError;
  if (pointer.status === 410)
    throw {
      error: "AR_ALBUM_ERROR",
      code: "EXPIRED",
      message: "This album has expired.",
    } as ApiError;
  if (!pointer.ok)
    throw {
      error: "AR_ALBUM_ERROR",
      code: "MANIFEST_FAILED",
      message: "Could not load album.",
    } as ApiError;
  const manifest = (await pointer.json()) as GuestManifest;
  if (manifest.expiresAt && new Date(manifest.expiresAt).getTime() <= Date.now()) {
    throw {
      error: "AR_ALBUM_ERROR",
      code: "EXPIRED",
      message: "This album has expired.",
    } as ApiError;
  }
  return manifest;
}

/** Direct browser -> S3 PUT with progress + cancel. Presigned URL from Lambda. */
export function putToS3(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Upload failed (network)."));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.send(file);
  });
}
