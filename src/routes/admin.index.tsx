import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { HeartHandshake, Plus } from "lucide-react";
import { AlbumCard } from "@/components/AlbumCard";
import { AlbumDialog } from "@/components/AlbumDialog";
import { useAlbums } from "@/hooks/useAlbums";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Albums — AR Video Album Studio" },
      {
        name: "description",
        content: "Manage wedding AR albums, upload photo-video pairs and share QR codes.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AlbumsPage,
});

function AlbumsPage() {
  const { data: albums, isLoading, isError } = useAlbums();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl">Albums</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every printed album and the memories hidden inside it.
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Plus className="size-4" /> New album
        </motion.button>
      </motion.div>

      <AlbumDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(albumId) => navigate({ to: "/admin/albums/$id", params: { id: albumId } })}
      />

      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border bg-card">
              <div className="shimmer aspect-[4/3]" />
              <div className="space-y-3 p-4">
                <div className="shimmer h-5 w-2/3 rounded" />
                <div className="shimmer h-3 w-1/2 rounded" />
                <div className="shimmer h-9 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          Couldn&apos;t load albums. Check your connection and sign-in, then retry.
        </p>
      ) : !albums || albums.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a, i) => (
            // AlbumCard accepts both mock and production shapes.
            <AlbumCard
              key={
                (a as { id?: string; albumId?: string }).id ??
                (a as { albumId?: string }).albumId ??
                i
              }
              album={a as never}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-dashed bg-card py-20 text-center"
    >
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-secondary">
        <HeartHandshake className="size-7 text-gold" />
      </div>
      <h2 className="mt-5 text-2xl">No albums yet</h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
        Start with a couple, add their photos and the videos behind them.
      </p>
      <button
        onClick={onCreate}
        className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Create your first album
      </button>
    </motion.div>
  );
}
