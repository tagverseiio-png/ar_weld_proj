import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useAlbums } from "@/hooks/useAlbums";

export const Route = createFileRoute("/admin/upload")({
  head: () => ({
    meta: [
      { title: "Upload — AR Video Album Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UploadPicker,
});

function UploadPicker() {
  const { data: albums, isLoading } = useAlbums();

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-3xl">Upload</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the album you want to add pages to.
      </p>
      <div className="mt-8 space-y-3">
        {(albums ?? []).map((a) => {
          const id =
            (a as { id?: string; albumId?: string }).id ??
            (a as { albumId?: string }).albumId ??
            "";
          const cover = (a as { coverUrl?: string }).coverUrl;
          const pageCount =
            (a as { pages?: unknown[]; pageCount?: number }).pages?.length ??
            (a as { pageCount?: number }).pageCount ??
            0;
          const status = ((a as { status?: string }).status ?? "draft") as
            "draft" | "processing" | "ready";
          return (
            <motion.div key={id} whileHover={{ x: 4 }}>
              <Link
                to="/admin/albums/$id"
                params={{ id }}
                className="flex items-center gap-4 rounded-xl border bg-card p-4"
              >
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    className="size-14 rounded-lg object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-secondary text-xs text-muted-foreground">
                    AR
                  </span>
                )}
                <div className="flex-1">
                  <p className="font-medium">{a.coupleName}</p>
                  <p className="text-xs text-muted-foreground">{pageCount} pages</p>
                </div>
                <StatusBadge
                  status={
                    status === "draft" || status === "processing" || status === "ready"
                      ? status
                      : "draft"
                  }
                />
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </motion.div>
          );
        })}
        {isLoading && [0, 1, 2].map((i) => <div key={i} className="shimmer h-20 rounded-xl" />)}
      </div>
    </div>
  );
}
