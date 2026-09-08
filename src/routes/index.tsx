import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Camera, LayoutGrid } from "lucide-react";
import heroImage from "@/assets/album-1.jpg";
import { STUDIO_CITY, STUDIO_NAME } from "@/lib/mock-api";
import { prodApi } from "@/lib/api";
import { useAlbums } from "@/hooks/useAlbums";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AR Video Album — Wedding Photos That Play" },
      {
        name: "description",
        content:
          "A Chennai wedding studio's AR album: scan a printed photo and watch the moment play back.",
      },
      { property: "og:title", content: "AR Video Album — Wedding Photos That Play" },
      {
        property: "og:description",
        content: "Scan a printed wedding photo and watch the moment play back.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <img
        src={heroImage}
        alt="Wedding couple at golden hour"
        width={800}
        height={600}
        className="absolute inset-0 size-full object-cover opacity-25"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background" />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[11px] tracking-[0.35em] text-primary uppercase"
        >
          {STUDIO_NAME} · {STUDIO_CITY}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="mt-5 text-5xl leading-tight sm:text-6xl"
        >
          AR Video Album
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 max-w-md text-sm text-muted-foreground"
        >
          Printed photographs that remember their moment. Point a phone at the page and the memory
          begins to move.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mt-9 flex flex-wrap justify-center gap-3"
        >
          {/* In production this resolves to a REAL published album so guests
              never land on the mock demo id (which only shows Simulate Scan).
              Falls back to the dashboard when nothing is published yet. */}
          <GuestScanButton />
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-full border border-gold-soft bg-card px-6 py-3 text-sm font-medium text-primary"
          >
            <LayoutGrid className="size-4" /> Studio dashboard
          </Link>
        </motion.div>
      </div>
    </main>
  );
}

function GuestScanButton() {
  const cls =
    "flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground";
  // Local prototype (no API): the mock demo id is the only thing that works.
  if (!prodApi.configured) {
    return (
      <Link to="/ar/$albumId" params={{ albumId: "meera-arjun" }} className={cls}>
        <Camera className="size-4" /> Try the guest scan
      </Link>
    );
  }
  return <ProdGuestScanButton cls={cls} />;
}

function ProdGuestScanButton({ cls }: { cls: string }) {
  const { data } = useAlbums();
  const ready = (data ?? []).find(
    (a) =>
      (a as { status?: string }).status === "ready" &&
      typeof (a as { publicId?: string }).publicId === "string",
  ) as { publicId: string } | undefined;
  if (!ready) {
    return (
      <Link to="/admin" className={cls}>
        <Camera className="size-4" /> Try the guest scan
      </Link>
    );
  }
  return (
    <Link to="/ar/$albumId" params={{ albumId: ready.publicId }} className={cls}>
      <Camera className="size-4" /> Try the guest scan
    </Link>
  );
}
