import { useEffect, useRef, useState } from "react";
import type { GuestManifest } from "@/contracts";

type Props = {
  manifest: GuestManifest;
  started: boolean;
  activeIndex: number | null;
  onTargetFound: (markerIndex: number) => void;
  onTargetLost?: (markerIndex: number) => void;
  onError?: (message: string) => void;
};

/**
 * Client-only WebAR experience (MindAR + Three.js).
 * Nothing in this file may run during SSR — all imports are dynamic
 * inside the started-effect and every resource is released on unmount.
 */
export function ArExperience({
  manifest,
  started,
  activeIndex,
  onTargetFound,
  onTargetLost,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<HTMLVideoElement[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "tracking" | "failed">("idle");
  const foundRef = useRef(onTargetFound);
  foundRef.current = onTargetFound;
  const lostRef = useRef(onTargetLost);
  lostRef.current = onTargetLost;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  // Pause all videos when the tab is backgrounded (mobile data + battery).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) videosRef.current.forEach((v) => v.pause());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pause non-active videos when the tracked target changes.
  useEffect(() => {
    videosRef.current.forEach((v, i) => {
      if (i !== activeIndex) v.pause();
    });
  }, [activeIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!started || !container) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mindar: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any = null;
    let raf = 0;
    const disposables: Array<{ dispose: () => void }> = [];
    const videos: HTMLVideoElement[] = [];

    async function start() {
      try {
        setStatus("starting");
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
        const scene = mindar.scene;
        const camera = mindar.camera;

        manifest.pages.forEach((page) => {
          const video = document.createElement("video");
          // crossOrigin BEFORE src: the fetch starts on src assignment, so a
          // late crossOrigin leaves the video CORS-tainted and WebGL texture
          // upload throws SecurityError the moment a target is found.
          video.crossOrigin = "anonymous";
          video.src = page.videoUrl;
          video.loop = true;
          // Muted by default: iOS Safari blocks unmuted autoplay outside a
          // tap handler, which silently freezes the tracked plane on sound.
          // Guests get audio from the bottom-sheet player (has controls).
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          videos.push(video);
          const texture = new THREE.VideoTexture(video);
          disposables.push(texture as unknown as { dispose: () => void });
          const geometry = new THREE.PlaneGeometry(1, 0.75);
          disposables.push(geometry as unknown as { dispose: () => void });
          const material = new THREE.MeshBasicMaterial({ map: texture });
          disposables.push(material as unknown as { dispose: () => void });
          const plane = new THREE.Mesh(geometry, material);
          const anchor = mindar.addAnchor(page.markerIndex);
          anchor.group.add(plane);
          anchor.onTargetFound = () => {
            foundRef.current(page.markerIndex);
            video.play().catch(() => undefined);
          };
          anchor.onTargetLost = () => {
            lostRef.current?.(page.markerIndex);
            video.pause();
          };
        });
        videosRef.current = videos;

        await mindar.start();
        if (cancelled) {
          await mindar.stop().catch(() => undefined);
          return;
        }
        setStatus("tracking");
        const renderLoop = () => {
          // A single throwing frame (e.g. a tainted video texture) must not
          // kill the whole loop — otherwise the camera view freezes dead.
          try {
            renderer.render(scene, camera);
          } catch {
            /* keep tracking alive; next frame retries */
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
      videos.forEach((v) => {
        v.pause();
        v.removeAttribute("src");
        v.load();
      });
      videosRef.current = [];
      disposables.forEach((d) => {
        try {
          d.dispose();
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
    <div className="absolute inset-0">
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
