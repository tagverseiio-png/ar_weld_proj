import { useEffect, useRef, useState } from "react";
import type { GuestManifest } from "@/contracts";

type Props = {
  manifest: GuestManifest;
  started: boolean;
  onTargetFound: (markerIndex: number) => void;
  onTargetLost?: (markerIndex: number) => void;
  onPlaybackEnded?: () => void;
  onError?: (message: string) => void;
};

type Page = GuestManifest["pages"][number];

/**
 * Client-only WebAR experience (MindAR + Three.js).
 * Nothing in this file may run during SSR — all imports are dynamic
 * inside the started-effect and every resource is released on unmount.
 *
 * Performance model (phones, hundreds of memories):
 * - Zero media is preloaded. Anchors exist only; each memory's video is
 *   fetched from storage the moment its photo is found, and discarded on
 *   end — so data/decode cost stays at "one video at a time".
 * - Tracking stays LIVE while a memory plays so the plane keeps following
 *   the photo as the phone moves; the CPU savings come from streaming a
 *   single video on demand and capping the WebGL raster scale.
 * - WebGL renders below devicePixelRatio to keep the raster affordable.
 */
export function ArExperience({
  manifest,
  started,
  onTargetFound,
  onTargetLost,
  onPlaybackEnded,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"starting" | "tracking" | "failed">("starting");
  const foundRef = useRef(onTargetFound);
  foundRef.current = onTargetFound;
  const lostRef = useRef(onTargetLost);
  lostRef.current = onTargetLost;
  const endedRef = useRef(onPlaybackEnded);
  endedRef.current = onPlaybackEnded;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!started || !container) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mindar: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any = null;
    let raf = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ThreeObj = any;
    // Currently playing memory (at most one at a time).
    const playing: {
      idx: number;
      video: HTMLVideoElement | null;
      plane: ThreeObj | null;
      anchor: ThreeObj | null;
      dispose: Array<() => void>;
    } = { idx: -1, video: null, plane: null, anchor: null, dispose: [] };
    // Marker that just played to its end. While the photo stays in frame,
    // re-acquiring it must NOT replay the memory (that read as an endless
    // loop). Cleared when the photo actually leaves the frame, so guests
    // rewatch by pointing away and back.
    let lastEndedIdx = -1;
    const cleanups: Array<() => void> = [];

    function stopPlayback() {
      const had = playing.idx >= 0;
      const endedIdx = playing.idx;
      playing.video?.pause();
      if (playing.plane && playing.anchor) playing.anchor.group.remove(playing.plane);
      playing.dispose.forEach((d) => {
        try {
          d();
        } catch {
          /* ignore */
        }
      });
      if (playing.video) {
        playing.video.removeAttribute("src");
        try {
          playing.video.load();
        } catch {
          /* ignore */
        }
      }
      playing.idx = -1;
      playing.video = null;
      playing.plane = null;
      playing.anchor = null;
      playing.dispose = [];
      if (had) {
        lastEndedIdx = endedIdx;
        endedRef.current?.();
      }
    }

    async function start() {
      try {
        // MindAR wraps getUserMedia errors in opaque controller errors. Probe
        // the camera first so denials/missing cameras surface with a real
        // reason instead of "AR failed to start".
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true });
          probe.getTracks().forEach((t) => t.stop());
        } catch (err) {
          const name = (err as DOMException)?.name;
          if (name === "NotAllowedError")
            throw new Error(
              "Camera access was denied. Allow camera permission for this site, then tap Start camera again.",
            );
          if (name === "NotFoundError")
            throw new Error("No camera found. Open this album link on a phone.");
          if (name === "NotReadableError")
            throw new Error("The camera is busy in another app. Close it and retry.");
          throw new Error("Camera could not be started on this device.");
        }
        // WebAR runtime is vendored in public/vendor (mind-ar@1.2.5 +
        // three@0.149.0, MIT) and loaded at runtime so `npm install` stays
        // free of mind-ar's native `canvas` dependency (unbuildable on
        // Vercel). three is pinned pre-0.152: mind-ar imports sRGBEncoding.
        // @vite-ignore keeps these as runtime URLs (served from our domain).
        const origin = window.location.origin;
        const vendorUrl: string = `${origin}/vendor/mindar-image-three.prod.js`;
        const threeUrl: string = `${origin}/vendor/three.module.js`;
        const [vendor, threeNs] = (await Promise.all([
          import(/* @vite-ignore */ vendorUrl),
          import(/* @vite-ignore */ threeUrl),
        ])) as [
          { MindARThree?: new (args: unknown) => Record<string, unknown> },
          Record<string, unknown>,
        ];
        const MindAR = vendor.MindARThree;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const THREE = threeNs as any;
        if (!MindAR) throw new Error("AR engine failed to load.");
        const el = containerRef.current;
        if (cancelled || !el || !el.isConnected) return;

        mindar = new MindAR({
          container,
          imageTargetSrc: manifest.marker.url,
          maxTrack: 1,
          // One-euro filter: minimal cutoff, tiny beta -> heavily smoothed
          // pose. On glossy/screen targets the matched features jitter
          // frame to frame; strong smoothing keeps the overlay anchored
          // (costs a little lag, fine for video playback).
          filterMinCF: 0.0001,
          filterBeta: 0.0001,
          // Tolerate brief detection dropouts so a shaky hand doesn't
          // flip found/lost every few frames (which looks like jitter).
          // Warmup needs several consistent frames before "found" — glossy
          // targets (photo behind glass, screens) produce glare flashes
          // that must not lock the anchor.
          warmupTolerance: 10,
          missTolerance: 15,
        });
        renderer = mindar.renderer;
        // MindAR renders at devicePixelRatio (3x on most phones) — full-screen
        // WebGL at 3x every frame overheats mid-range devices and janks the
        // whole page. Cap the raster scale; tracking still runs on the camera
        // frames at full fidelity.
        renderer.setPixelRatio?.(Math.min(window.devicePixelRatio || 1, 1.5));
        const scene = mindar.scene;
        const camera = mindar.camera;

        // Keep the camera feed and the AR canvas in perfect lockstep by
        // delegating to MindAR's own resize(): it sizes the video (cover),
        // the WebGL canvas, and re-derives the camera projection from the
        // live stream dimensions. Doing this by hand drifts the overlay off
        // the photo. iOS reports videoWidth/videoHeight late, so keep
        // re-asserting until the stream settles.
        const applyCover = () => {
          const v = mindar?.video as HTMLVideoElement | undefined;
          if (!v || !v.videoWidth || !v.videoHeight) return;
          try {
            mindar.resize?.();
          } catch {
            /* ignore */
          }
        };
        const camVideo: HTMLVideoElement | undefined = mindar.video;
        const camEvents = ["loadedmetadata", "resize", "playing"] as const;
        camEvents.forEach((ev) => camVideo?.addEventListener(ev, applyCover));
        window.addEventListener("resize", applyCover);
        window.addEventListener("orientationchange", applyCover);
        let coverPolls = 0;
        const coverPoll = window.setInterval(() => {
          applyCover();
          if (++coverPolls > 15) window.clearInterval(coverPoll);
        }, 400);
        cleanups.push(() => {
          window.clearInterval(coverPoll);
          camEvents.forEach((ev) => camVideo?.removeEventListener(ev, applyCover));
          window.removeEventListener("resize", applyCover);
          window.removeEventListener("orientationchange", applyCover);
        });

        // Anchors only — no media upfront. Each video streams from storage
        // when its photo is found and is discarded when it ends.
        const anchors = manifest.pages.map((page) => {
          const anchor = mindar.addAnchor(page.markerIndex);
          anchor.onTargetFound = () => void onFound(page);
          anchor.onTargetLost = () => {
            // Photo left the frame: pause the memory here (it resumes in
            // place when the photo returns) and allow a fresh replay of
            // anything that already finished.
            if (playing.idx === page.markerIndex) playing.video?.pause();
            lastEndedIdx = -1;
            lostRef.current?.(page.markerIndex);
          };
          return anchor;
        });

        async function onFound(page: Page) {
          if (playing.idx === page.markerIndex) {
            // Same photo re-acquired after tracking flicker: resume exactly
            // where it paused — never restart, never recreate the video.
            void playing.video?.play().catch(() => undefined);
            return;
          }
          if (lastEndedIdx === page.markerIndex) {
            // This memory just finished and the photo never left the frame;
            // re-finding it must not restart the show.
            return;
          }
          stopPlayback();
          foundRef.current(page.markerIndex);
          const idx = manifest.pages.findIndex((p) => p === page);
          playing.idx = page.markerIndex;
          playing.anchor = anchors[idx];
          const video = document.createElement("video");
          // crossOrigin BEFORE src: the fetch starts on src assignment, so a
          // late crossOrigin leaves the video CORS-tainted and WebGL texture
          // upload throws SecurityError the moment the plane renders.
          video.crossOrigin = "anonymous";
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          playing.video = video;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const texture = new (THREE as any).VideoTexture(video);
          playing.dispose.push(() => texture.dispose());
          // The anchor's local unit is the PHOTO's height (MindAR divides
          // the tracked pose by the marker height), so the photo occupies
          // (markerW/markerH) x 1 in anchor space. Size the plane to the
          // photo's exact rectangle — never the video's aspect — so the
          // video stays inside the photo frame.
          const dims = mindar.controller?.markerDimensions?.[page.markerIndex];
          const photoW = dims && dims[1] ? dims[0] / dims[1] : 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const geometry = new (THREE as any).PlaneGeometry(photoW, 1);
          playing.dispose.push(() => geometry.dispose());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const material = new (THREE as any).MeshBasicMaterial({ map: texture });
          playing.dispose.push(() => material.dispose());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const plane = new (THREE as any).Mesh(geometry, material);
          // Gold outline on the photo rect: makes the live tracking lock
          // visible (this is an AR overlay, not a pasted picture) and
          // shows the exact anchor boundary.
          const outlineGeo = new (THREE as ThreeObj).EdgesGeometry(geometry);
          const outlineMat = new (THREE as ThreeObj).LineBasicMaterial({
            color: 0xe6b54a,
            transparent: true,
            opacity: 0.9,
          });
          const outline = new (THREE as ThreeObj).LineSegments(outlineGeo, outlineMat);
          plane.add(outline);
          playing.dispose.push(() => {
            outlineGeo.dispose();
            outlineMat.dispose();
          });
          playing.plane = plane;
          // object-fit: cover for the texture — crop the video's UVs to its
          // aspect so it fills the photo rect without distortion.
          const fitUVs = () => {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (!vw || !vh) return;
            const va = vw / vh;
            let u0 = 0;
            let v0 = 0;
            let u1 = 1;
            let v1 = 1;
            if (va > photoW) {
              const c = (1 - photoW / va) / 2;
              u0 = c;
              u1 = 1 - c;
            } else if (va < photoW) {
              const c = (1 - va / photoW) / 2;
              v0 = c;
              v1 = 1 - c;
            }
            const uv = geometry.attributes.uv;
            uv.setXY(0, u0, 1);
            uv.setXY(1, u1, 1);
            uv.setXY(2, u0, 0);
            uv.setXY(3, u1, 0);
            uv.needsUpdate = true;
          };
          video.addEventListener("loadedmetadata", fitUVs);
          video.addEventListener("ended", () => stopPlayback());
          video.addEventListener("error", () => stopPlayback());
          // iOS can reject the first play() because metadata hasn't arrived
          // yet; retry once the element is actually able to play.
          video.addEventListener("canplay", () => {
            if (playing.video === video && video.paused) {
              void video.play().catch(() => undefined);
            }
          });
          playing.dispose.push(() => {
            video.removeEventListener("loadedmetadata", fitUVs);
          });
          playing.anchor.group.add(plane);
          video.src = page.videoUrl;
          video.play().catch(() => undefined);
        }

        await mindar.start();
        if (cancelled) {
          await mindar.stop().catch(() => undefined);
          return;
        }
        applyCover();
        setStatus("tracking");
        const renderLoop = () => {
          // A single throwing frame (e.g. a tainted video texture) must not
          // kill the whole loop — otherwise the camera view freezes dead.
          try {
            renderer.render(scene, camera);
          } catch {
            /* keep rendering alive; next frame retries */
          }
          if (!cancelled) raf = requestAnimationFrame(renderLoop);
        };
        renderLoop();
      } catch (e) {
        if (cancelled) return;
        setStatus("failed");
        errorRef.current?.(e instanceof Error ? e.message : "AR failed to start.");
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopPlayback();
      cleanups.forEach((c) => {
        try {
          c();
        } catch {
          /* ignore */
        }
      });
      try {
        renderer?.setAnimationLoop?.(null);
        renderer?.dispose?.();
      } catch {
        /* ignore */
      }
      // Release camera tracks — MindAR stops streams on stop(), but enforce it.
      if (mindar?.stop) void mindar.stop().catch(() => undefined);
      try {
        container.querySelectorAll("video").forEach((el) => {
          const stream = (el as HTMLVideoElement).srcObject as MediaStream | null;
          stream?.getTracks().forEach((t) => t.stop());
          el.remove();
        });
      } catch {
        /* ignore */
      }
      const gl = container.querySelector("canvas");
      gl?.remove();
    };
  }, [started, manifest]);

  return (
    <div className="absolute inset-0 isolate">
      <div
        ref={containerRef}
        className="absolute inset-0 [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:size-full [&>video]:absolute [&>video]:inset-0 [&>video]:size-full [&>video]:object-cover"
      />
      {status === "starting" && (
        <div className="absolute inset-x-0 top-24 z-10 flex justify-center">
          <p className="rounded-full bg-black/60 px-4 py-2 text-xs text-white">Starting camera…</p>
        </div>
      )}
      {status === "failed" && (
        <div className="absolute inset-x-0 top-24 z-10 flex justify-center px-6 text-center">
          <p className="rounded-xl bg-black/70 px-4 py-3 text-xs text-white">
            Couldn&apos;t start AR on this device. Check camera permission and use iOS Safari or
            Android Chrome.
          </p>
        </div>
      )}
    </div>
  );
}
