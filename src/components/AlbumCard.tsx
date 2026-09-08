import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, Link2, MapPin, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Album as MockAlbum } from "@/lib/mock-api";
import { guestUrlForAlbum as mockGuestUrl } from "@/lib/mock-api";
import { canonicalOrigin } from "@/lib/config";
import { guestPathForPublicId } from "@/contracts";
import type { AlbumRecord } from "@/contracts";
import { prodApi } from "@/lib/api";
import { useDeleteAlbum } from "@/hooks/useAlbums";
import { AlbumDialog } from "./AlbumDialog";
import { StatusBadge } from "./StatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

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
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useDeleteAlbum();

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

  async function confirmDelete() {
    if (!prodApi.configured) {
      toast.message("Prototype mode — albums are mocked locally.");
      return;
    }
    setDeleting(true);
    try {
      await del.mutateAsync(id);
      toast.success(`"${album.coupleName}" deleted.`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Could not delete album.");
    } finally {
      setDeleting(false);
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
        {/* CRUD: edit + delete live beside the QR action. */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setEditOpen(true)}
            aria-label={`Edit ${album.coupleName}`}
          >
            <Pencil className="size-3.5" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-destructive hover:text-destructive"
                aria-label={`Delete ${album.coupleName}`}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{album.coupleName}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the album, its photo/video pages, the published marker
                  and the guest QR link. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? "Deleting…" : "Delete album"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <AlbumDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        albumId={prodApi.configured ? id : undefined}
        initial={{
          coupleName: album.coupleName,
          eventDate: (album as MockAlbum).eventDate ?? "",
          venue: (album as MockAlbum).venue ?? "",
        }}
      />
    </motion.div>
  );
}
