import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Camera, Play, Sparkles } from "lucide-react";
import { AnimatedCameraFrame } from "@/components/AnimatedCameraFrame";
import { ArExperience } from "@/components/ArExperience";
import { BottomSheet } from "@/components/BottomSheet";
import { fetchGuestManifest, prodApi } from "@/lib/api";
import { fetchAlbum, STUDIO_CITY, STUDIO_NAME, type Album } from "@/lib/mock-api";
import type { ApiError, GuestManifest } from "@/contracts";

export const Route = createFileRoute("/ar/$albumId")({
  head: () => ({
    meta: [
      { title: "Scan the Album — AR Video Album" },
      {
        name: "description",
        content: "Point your camera at a printed wedding photo to watch the moment come alive.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Scan the Album — AR Video Album" },
    ],
  }),
  component: GuestArPage,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "manifest"; manifest: GuestManifest }
  | { kind: "mock"; album: Album }
  | { kind: "error"; code: string; message: string };

function looksLikePublicId(s: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(s);
}

function GuestArPage() {
  const { albumId } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [started, setStarted] = useState(false);
  const [scanIndex, setScanIndex] = useState<number | null>(null);
  const [arError, setArError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    async function run() {
      // Production guest path: static CloudFront manifest, no Lambda/DDB.
      if (prodApi.configured && looksLikePublicId(albumId)) {
        try {
          const manifest = await fetchGuestManifest(albumId);
          if (alive) setState({ kind: "manifest", manifest });
        } catch (e) {
          if (!alive) return;
          const err = e as ApiError & { message?: string };
          if (err.code === "EXPIRED") {
            setState({
              kind: "error",
              code: "EXPIRED",
              message: "This album has expired and is no longer available.",
            });
          } else if (err.code === "NOT_FOUND") {
            setState({
              kind: "error",
              code: "NOT_FOUND",
              message: "This QR link is invalid or was revoked.",
            });
          } else {
            setState({
              kind: "error",
              code: "LOAD_FAILED",
              message: "Could not load this album. Check your connection and retry.",
            });
          }
        }
        return;
      }
      // Local prototype / legacy internal ids.
      const data = await fetchAlbum(albumId);
      if (!alive) return;
      if (!data) {
        setState({ kind: "error", code: "NOT_FOUND", message: "Album not found." });
        return;
      }
      setState({ kind: "mock", album: data });
    }
    void run();
    return () => {
      alive = false;
    };
  }, [albumId]);

  const loading = state.kind === "loading";
  const manifest = state.kind === "manifest" ? state.manifest : null;
  const mockAlbum = state.kind === "mock" ? state.album : null;
  const coupleName = manifest?.album.coupleName ?? mockAlbum?.coupleName ?? "";
  const eventLine = manifest
    ? `${manifest.pages.length} memories inside`
    : (mockAlbum?.eventDate ?? "");
  const mockPages = mockAlbum?.pages ?? [];
  const currentMock = scanIndex !== null ? mockPages[scanIndex] : null;
  const currentManifestPage = scanIndex !== null ? (manifest?.pages[scanIndex] ?? null) : null;

  const unsupported =
    typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia && manifest !== null;

  function simulateScan() {
    const n = manifest?.pages.length ?? mockPages.length;
    if (!n) return;
    setScanIndex((i) => (i === null ? 0 : (i + 1) % n));
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#141013] text-primary-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,#3a2c2a_0%,#141013_70%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(0deg,#fff_0_1px,transparent_1px_3px)]" />

      {/* Real AR layer (client-only). Mock mode keeps the placeholder viewfinder. */}
      {manifest && started && !unsupported && (
        <ArExperience
          manifest={manifest}
          started={started}
          activeIndex={scanIndex}
          onTargetFound={(i) => setScanIndex(i)}
          onTargetLost={() => undefined}
          onError={(m) => setArError(m)}
        />
      )}
      <AnimatedCameraFrame />

      <motion.header
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 px-6 pt-10 text-center"
      >
        <p className="text-[11px] tracking-[0.35em] text-gold uppercase">
          {manifest?.album.studioName ?? STUDIO_NAME}
        </p>
        <p className="mt-1 text-[10px] tracking-[0.25em] text-white/40 uppercase">
          {manifest?.album.studioCity ?? STUDIO_CITY}
        </p>
        {loading ? (
          <div className="mx-auto mt-5 space-y-2">
            <div className="shimmer mx-auto h-7 w-56 rounded-md opacity-30" />
            <div className="shimmer mx-auto h-3 w-32 rounded-md opacity-20" />
          </div>
        ) : state.kind === "error" ? (
          <>
            <h1 className="mt-4 text-3xl text-white">
              {state.code === "EXPIRED" ? "Album expired" : "Link unavailable"}
            </h1>
            <p className="mx-auto mt-2 max-w-xs text-xs text-white/60">{state.message}</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-3xl text-white">{coupleName || "Album not found"}</h1>
            {eventLine && <p className="mt-1 text-xs text-white/50">{eventLine}</p>}
          </>
        )}
      </motion.header>

      {arError && (
        <div className="absolute inset-x-0 top-40 z-10 flex justify-center px-6">
          <p
            role="alert"
            className="max-w-sm rounded-xl bg-black/70 px-4 py-3 text-center text-xs text-white"
          >
            {arError} You can still watch from the list below.
          </p>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="absolute inset-x-0 bottom-32 z-10 px-8 text-center"
      >
        {state.kind === "error" ? null : !started && manifest ? (
          <div className="flex flex-col items-center gap-3">
            <p className="flex items-center justify-center gap-2 text-sm text-white/75">
              <Camera className="size-4 text-gold" />
              Point your camera at a photo in the album
            </p>
            <button
              onClick={() => {
                if (unsupported) {
                  setArError(
                    "This device or browser can't run camera AR. Use iOS Safari or Android Chrome.",
                  );
                  return;
                }
                setStarted(true);
              }}
              className="rounded-full bg-gold px-7 py-3.5 text-sm font-semibold text-[#3a1420]"
            >
              Start camera
            </button>
            <button onClick={() => setHelpOpen(true)} className="text-xs text-white/50 underline">
              How scanning works
            </button>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-white/75">
            <Camera className="size-4 text-gold" />
            Point your camera at a photo in the album
          </p>
        )}
      </motion.div>

      <div className="absolute inset-x-0 bottom-10 z-10 flex justify-center gap-3 px-8">
        {/* Prototype fallback stays for mock albums; doubles as an accessible list trigger. */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.03 }}
          onClick={simulateScan}
          disabled={loading || (!(manifest?.pages.length ?? 0) && !mockPages.length)}
          className="flex items-center gap-2 rounded-full bg-gold px-7 py-3.5 text-sm font-semibold text-[#3a1420] disabled:opacity-40"
        >
          <Sparkles className="size-4" /> {manifest ? "Browse memories" : "Simulate Scan"}
        </motion.button>
      </div>

      <BottomSheet open={helpOpen} onClose={() => setHelpOpen(false)}>
        <div className="text-foreground">
          <p className="text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
            How it works
          </p>
          <h2 className="mt-1 text-2xl">Hold a photo in the frame</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Fill the gold frame with one printed photo. Keep the phone steady in good light — glossy
            lamination and glare make tracking harder. The video plays over the photo; lift the
            phone away to pause.
          </p>
        </div>
      </BottomSheet>

      <BottomSheet open={!!(currentMock ?? currentManifestPage)} onClose={() => setScanIndex(null)}>
        {(currentMock ?? currentManifestPage) && (
          <div className="text-foreground">
            <p className="text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
              Now Playing
            </p>
            <h2 className="mt-1 text-2xl">{currentMock?.title ?? currentManifestPage?.title}</h2>
            <div className="relative mt-4 aspect-video overflow-hidden rounded-xl bg-black">
              <video
                key={currentMock?.id ?? `m-${scanIndex}`}
                src={currentMock?.videoUrl ?? currentManifestPage?.videoUrl}
                poster={currentMock?.photoUrl}
                controls
                autoPlay
                playsInline
                className="size-full object-cover"
              />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Play className="size-3.5 text-gold" /> Keep the photo in frame to keep watching
            </p>
          </div>
        )}
      </BottomSheet>
    </main>
  );
}
