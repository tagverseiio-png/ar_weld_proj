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
 * - While a memory plays the MindAR tracking loop is stopped (its WASM
 *   inference is the dominant CPU/heat cost) and resumed afterwards.
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
    // Currently playing memory (at most one — tracking is paused meanwhile).
    const playing: {
      idx: number;
      video: HTMLVideoElement | null;
      plane: ThreeObj | null;
      anchor: ThreeObj | null;
      dispose: Array<() => void>;
    } = { idx: -1, video: null, plane: null, anchor: null, dispose: [] };
    const cleanups: Array<() => void> = [];

    function stopPlayback(resumeTracking: boolean) {
      const had = playing.idx >= 0;
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
      if (resumeTracking && mindar?.controller?.processVideo && mindar?.video) {
        try {
          mindar.controller.processVideo(mindar.video);
        } catch {
          /* ignore */
        }
      }
      if (had) endedRef.current?.();
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
          filterMinCF: 0.0001,
          filterBeta: 0.001,
        });
        renderer = mindar.renderer;
        // MindAR renders at devicePixelRatio (3x on most phones) — full-screen
        // WebGL at 3x every frame overheats mid-range devices and janks the
        // whole page. Cap the raster scale; tracking still runs on the camera
        // frames at full fidelity.
        renderer.setPixelRatio?.(Math.min(window.devicePixelRatio || 1, 1.5));
        const scene = mindar.scene;
        const camera = mindar.camera;

        // Keep the camera feed covering the viewport. MindAR computes its
        // cover letterbox once at init, which can run before the stream
        // reports videoWidth/videoHeight (iOS Safari) — leaving the feed
        // letterboxed. Re-assert with live dimensions.
        const applyCover = () => {
          const v = mindar?.video as HTMLVideoElement | undefined;
          if (!v || !v.videoWidth || !v.videoHeight) return;
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
          v.style.width = `${v.videoWidth * scale}px`;
          v.style.height = `${v.videoHeight * scale}px`;
          v.style.top = `${(ch - v.videoHeight * scale) / 2}px`;
          v.style.left = `${(cw - v.videoWidth * scale) / 2}px`;
          v.style.objectFit = "cover";
        };
        const camVideo: HTMLVideoElement | undefined = mindar.video;
        camVideo?.addEventListener("loadedmetadata", applyCover);
        camVideo?.addEventListener("resize", applyCover);
        window.addEventListener("resize", applyCover);
        cleanups.push(() => {
          camVideo?.removeEventListener("loadedmetadata", applyCover);
          camVideo?.removeEventListener("resize", applyCover);
          window.removeEventListener("resize", applyCover);
        });

        // Anchors only — no media upfront. Each video streams from storage
        // when its photo is found and is discarded when it ends.
        const anchors = manifest.pages.map((page) => {
          const anchor = mindar.addAnchor(page.markerIndex);
          anchor.onTargetFound = () => void onFound(page);
          anchor.onTargetLost = () => lostRef.current?.(page.markerIndex);
          return anchor;
        });

        async function onFound(page: Page) {
          if (playing.idx === page.markerIndex) return;
          stopPlayback(true);
          foundRef.current(page.markerIndex);
          // Pause the tracker while this memory plays: the WASM tracking
          // loop is the dominant CPU/heat cost and nothing else can be
          // detected while the guest watches.
          try {
            mindar.controller?.stopProcessVideo?.();
          } catch {
            /* ignore */
          }
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const geometry = new (THREE as any).PlaneGeometry(1, 1);
          playing.dispose.push(() => geometry.dispose());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const material = new (THREE as any).MeshBasicMaterial({ map: texture });
          playing.dispose.push(() => material.dispose());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const plane = new (THREE as any).Mesh(geometry, material);
          playing.plane = plane;
          // MindAR normalizes each target to a 1x1 plane in anchor space;
          // fit the video over it without distortion (object-fit: cover).
          const fitPlane = () => {
            const vw = video.videoWidth || 16;
            const vh = video.videoHeight || 9;
            const aspect = vw / vh;
            if (aspect >= 1) plane.scale.set(aspect, 1, 1);
            else plane.scale.set(1, 1 / aspect, 1);
          };
          video.addEventListener("loadedmetadata", fitPlane);
          video.addEventListener("ended", () => stopPlayback(true));
          video.addEventListener("error", () => stopPlayback(true));
          playing.dispose.push(() => {
            video.removeEventListener("loadedmetadata", fitPlane);
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
      stopPlayback(false);
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
