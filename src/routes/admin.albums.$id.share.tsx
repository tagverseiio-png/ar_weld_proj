import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Download, Eye, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { downloadQr, QrCard } from "@/components/QrCard";
import {
  fetchAlbum as fetchMockAlbum,
  guestUrlForAlbum as mockGuestUrl,
  type Album as MockAlbum,
} from "@/lib/mock-api";
import { prodApi } from "@/lib/api";
import { canonicalOrigin } from "@/lib/config";
import { guestPathForPublicId } from "@/contracts";
import type { AlbumRecord } from "@/contracts";

export const Route = createFileRoute("/admin/albums/$id/share")({
  head: () => ({
    meta: [
      { title: "Share Album QR — AR Video Album Studio" },
      {
        description:
          "Download the album QR code, copy the guest link and preview the scanning experience.",
      },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const { id } = Route.useParams();
  const [mockAlbum, setMockAlbum] = useState<MockAlbum | null>(null);
  const [prodAlbum, setProdAlbum] = useState<AlbumRecord | null>(null);
  const [url, setUrl] = useState("");
  const [urlWarning, setUrlWarning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (prodApi.configured) {
        try {
          const a = await prodApi.getAlbum(id);
          if (!alive) return;
          setProdAlbum(a);
          const canonical = canonicalOrigin();
          const publicId = (a as unknown as { publicId?: string }).publicId;
          if (!publicId) {
            setUrlWarning("Album has no public link yet — publish it first.");
            return;
          }
          if (!canonical) {
            // Preview domain: show a preview-only link, block printable QR.
            setUrl(`${window.location.origin}${guestPathForPublicId(publicId)}`);
            setUrlWarning(
              "You're on a preview domain. Print QR codes only from the canonical production URL.",
            );
            return;
          }
          if (a.status !== "ready" || (a.revision ?? 0) === 0) {
            setUrl(`${canonical}${guestPathForPublicId(publicId)}`);
            setUrlWarning(
              "Album isn't published yet — this link will show Not ready until you publish.",
            );
            return;
          }
          setUrl(`${canonical}${guestPathForPublicId(publicId)}`);
        } catch (e) {
          if (alive)
            setUrlWarning((e as { message?: string })?.message ?? "Could not load share link.");
        }
        return;
      }
      const m = await fetchMockAlbum(id);
      if (!alive) return;
      setMockAlbum(m);
      setUrl(mockGuestUrl(id));
    }
    void run();
    return () => {
      alive = false;
    };
  }, [id]);

  const coupleName = prodAlbum?.coupleName ?? mockAlbum?.coupleName ?? "Loading…";
  const guestParam = prodApi.configured
    ? ((prodAlbum as unknown as { publicId?: string } | null)?.publicId ?? id)
    : id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Guest link copied");
    } catch {
      toast.error("Copy failed — long-press the link to copy it.");
    }
  }

  async function download() {
    if (urlWarning && !url) return;
    try {
      await downloadQr(url, `${guestParam}-qr.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QR download failed.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link
        to="/admin/albums/$id"
        params={{ id }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" /> Back to album
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 text-center"
      >
        <h1 className="text-3xl">Share the album</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {coupleName} · guests scan this to watch the memories
        </p>
      </motion.div>

      <div className="mt-8 flex flex-col items-center">
        {url ? <QrCard url={url} /> : <div className="shimmer size-60 rounded-2xl" />}
        <p className="mt-4 max-w-full truncate text-xs text-muted-foreground">{url}</p>
        {urlWarning && (
          <p
            role={url ? "note" : "alert"}
            className="mt-2 max-w-md text-center text-xs text-amber-600"
          >
            {urlWarning}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => void download()}
            disabled={!url}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            <Download className="size-4" /> Download QR
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => void copy()}
            disabled={!url}
            className="flex items-center gap-2 rounded-lg border border-gold-soft bg-secondary px-4 py-2.5 text-sm font-medium text-primary disabled:opacity-40"
          >
            <Copy className="size-4" /> Copy Link
          </motion.button>
          <Link
            to="/ar/$albumId"
            params={{ albumId: guestParam }}
            className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            <Eye className="size-4" /> Preview as Guest
          </Link>
        </div>

        {prodApi.configured && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={() =>
                prodApi
                  .rotateQr(id)
                  .then(() => window.location.reload())
                  .catch((e) =>
                    toast.error((e as { message?: string })?.message ?? "Rotate failed."),
                  )
              }
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-xs text-muted-foreground"
            >
              <RefreshCw className="size-3.5" /> Rotate link (invalidates old QR)
            </button>
            <button
              onClick={() =>
                prodApi
                  .revokeQr(id)
                  .then(() => toast.success("Guest link revoked."))
                  .catch((e) =>
                    toast.error((e as { message?: string })?.message ?? "Revoke failed."),
                  )
              }
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-xs text-destructive"
            >
              <ShieldOff className="size-3.5" /> Revoke link
            </button>
          </div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mt-12 rounded-2xl border bg-card p-6"
      >
        <h2 className="text-lg">Where to stick it</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Print at 35mm and place the sticker on the inside back cover.
        </p>
        <div className="mt-5 flex justify-center">
          <div className="relative aspect-[4/3] w-full max-w-sm rounded-lg border-2 border-gold-soft bg-background p-4 shadow-[var(--shadow-soft)]">
            <div className="h-full w-full rounded bg-secondary" />
            <div className="absolute right-6 bottom-6 grid size-14 place-items-center rounded border-2 border-gold bg-card text-[9px] tracking-wider text-muted-foreground uppercase">
              QR
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
