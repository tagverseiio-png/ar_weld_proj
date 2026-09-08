import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, Link2, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { Album as MockAlbum } from "@/lib/mock-api";
import { guestUrlForAlbum as mockGuestUrl } from "@/lib/mock-api";
import { canonicalOrigin } from "@/lib/config";
import { guestPathForPublicId } from "@/contracts";
import type { AlbumRecord } from "@/contracts";
import { StatusBadge } from "./StatusBadge";

type CardAlbum = MockAlbum | (AlbumRecord & { coverUrl?: string });

function getId(a: CardAlbum): string {
  return (a as MockAlbum).id ?? (a as AlbumRecord).albumId;
}
function getStatus(a: CardAlbum): "draft" | "processing" | "ready" | "uploaded" {
  const s = (a as { status?: string }).status ?? "draft";
  if (s === "failed" || s === "expired") return "draft";
  return s as "draft" | "processing" | "ready";
}

export function AlbumCard({ album, index = 0 }: { album: CardAlbum; index?: number }) {
  const id = getId(album);
  const cover = (album as MockAlbum).coverUrl;
  const publicId = (album as Partial<AlbumRecord>).publicId;

  async function copyLink() {
    try {
      const url = publicId
        ? `${canonicalOrigin() || window.location.origin}${guestPathForPublicId(publicId)}`
        : mockGuestUrl(id);
      await navigator.clipboard.writeText(url);
      toast.success("Guest QR link copied");
    } catch {
      toast.error("Copy failed — open the album to get its link.");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.45, ease: "easeOut" }}
      whileHover={{ y: -6 }}
      className="overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-soft)]"
    >
      <Link
        to="/admin/albums/$id"
        params={{ id }}
        className="block aspect-[4/3] overflow-hidden bg-secondary"
      >
        {cover ? (
          <motion.img
            src={cover}
            alt={album.coupleName}
            loading="lazy"
            width={800}
            height={600}
            className="size-full object-cover"
            whileHover={{ scale: 1.06 }}
            transition={{ duration: 0.5 }}
          />
        ) : (
          <span className="grid size-full place-items-center text-secondary-foreground">
            <HeartHandshake className="size-8 text-gold" />
          </span>
        )}
      </Link>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg leading-tight">{album.coupleName}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {(album as MockAlbum).eventDate ?? ""}
            </p>
          </div>
          <StatusBadge status={getStatus(album)} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" /> {(album as MockAlbum).venue ?? ""}
        </p>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => void copyLink()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gold-soft bg-secondary px-3 py-2 text-sm font-medium text-primary"
        >
          <Link2 className="size-4" /> Copy QR Link
        </motion.button>
      </div>
    </motion.div>
  );
}
