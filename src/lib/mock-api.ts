/**
 * Mock data layer for AR Video Album.
 *
 * Every function here is an async stand-in for a real HTTP endpoint.
 * When the backend exists, replace each body with a fetch() call —
 * signatures and return types are already API-shaped.
 */

import album1 from "@/assets/album-1.jpg";
import album2 from "@/assets/album-2.jpg";
import album3 from "@/assets/album-3.jpg";

export type AlbumStatus = "draft" | "processing" | "ready";
export type PageStatus = "uploaded" | "processing" | "ready";

export interface AlbumPage {
  id: string;
  title: string;
  photoUrl: string;
  /** Video that plays when the printed photo is scanned. */
  videoUrl: string;
  status: PageStatus;
}

export interface Album {
  id: string;
  coupleName: string;
  eventDate: string;
  venue: string;
  coverUrl: string;
  status: AlbumStatus;
  pages: AlbumPage[];
}

export const STUDIO_NAME = "Marikkanu Studios";
export const STUDIO_CITY = "Chennai";

/** Placeholder video used for every "now playing" reveal. */
export const PLACEHOLDER_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const albums: Album[] = [
  {
    id: "meera-arjun",
    coupleName: "Meera & Arjun",
    eventDate: "12 February 2026",
    venue: "Kalyana Mandapam, Mylapore",
    coverUrl: album1,
    status: "ready",
    pages: [
      {
        id: "p1",
        title: "The Muhurtham",
        photoUrl: album1,
        videoUrl: PLACEHOLDER_VIDEO,
        status: "ready",
      },
      {
        id: "p2",
        title: "Garland Exchange",
        photoUrl: album2,
        videoUrl: PLACEHOLDER_VIDEO,
        status: "ready",
      },
      {
        id: "p3",
        title: "The Mandap",
        photoUrl: album3,
        videoUrl: PLACEHOLDER_VIDEO,
        status: "ready",
      },
    ],
  },
  {
    id: "divya-karthik",
    coupleName: "Divya & Karthik",
    eventDate: "3 March 2026",
    venue: "Leela Palace, Adyar",
    coverUrl: album2,
    status: "processing",
    pages: [
      {
        id: "p1",
        title: "Reception Entry",
        photoUrl: album2,
        videoUrl: PLACEHOLDER_VIDEO,
        status: "ready",
      },
      {
        id: "p2",
        title: "First Dance",
        photoUrl: album3,
        videoUrl: PLACEHOLDER_VIDEO,
        status: "processing",
      },
    ],
  },
  {
    id: "anitha-vishnu",
    coupleName: "Anitha & Vishnu",
    eventDate: "21 April 2026",
    venue: "Beach House, ECR",
    coverUrl: album3,
    status: "draft",
    pages: [],
  },
];

/** GET /albums */
export async function fetchAlbums(): Promise<Album[]> {
  await delay(700);
  return albums.map((a) => ({ ...a, pages: [...a.pages] }));
}

/** GET /albums/:id */
export async function fetchAlbum(id: string): Promise<Album | null> {
  await delay(700);
  const found = albums.find((a) => a.id === id);
  return found ? { ...found, pages: [...found.pages] } : null;
}

/** POST /albums/:id/pages */
export async function createAlbumPage(
  albumId: string,
  input: { title: string; photoUrl: string; videoUrl: string },
): Promise<AlbumPage> {
  await delay(500);
  return {
    id: `p-${Date.now()}`,
    title: input.title,
    photoUrl: input.photoUrl,
    videoUrl: input.videoUrl,
    status: "uploaded",
  };
}

/**
 * Fakes the AR marker-training step the backend will eventually run.
 * Replace with polling GET /albums/:id/pages/:pageId.
 */
export async function processPageMarker(): Promise<PageStatus> {
  await delay(2600);
  return "ready";
}

/** The public guest URL encoded into the printed QR sticker. */
export function guestUrlForAlbum(albumId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ar/${albumId}`;
}
