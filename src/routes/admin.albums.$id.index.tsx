import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Film, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { AlbumDialog } from "@/components/AlbumDialog";
import { Button } from "@/components/ui/button";
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
import { UploadDropzone } from "@/components/UploadDropzone";
import {
  createAlbumPage,
  fetchAlbum as fetchMockAlbum,
  processPageMarker,
  type Album as MockAlbum,
  type AlbumPage as MockPage,
} from "@/lib/mock-api";
import { prodApi, putToS3 } from "@/lib/api";
import type { AlbumRecord, BuildRecord, PageRecord } from "@/contracts";

export const Route = createFileRoute("/admin/albums/$id/")({
  head: () => ({
    meta: [
      { title: "Album Pages — AR Video Album Studio" },
      {
        name: "description",
        content:
          "Upload photo and video pairs, track marker processing and generate the album QR code.",
      },
    ],
  }),
  component: AlbumDetailPage,
});

type UiPage = {
  id: string;
  title: string;
  photoUrl?: string;
  status: "uploaded" | "processing" | "ready" | "failed" | "draft";
};

function isProd() {
  return prodApi.configured;
}

function AlbumDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [mockAlbum, setMockAlbum] = useState<MockAlbum | null>(null);
  const [prodAlbum, setProdAlbum] = useState<(AlbumRecord & { pages: PageRecord[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<UiPage[]>([]);
  const [build, setBuild] = useState<BuildRecord | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expiry, setExpiry] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isProd()) {
        const a = await prodApi.getAlbum(id);
        setProdAlbum(a);
        setPages(
          [...a.pages]
            .sort(
              (x, y) =>
                Number((x as unknown as { order?: number }).order ?? 0) -
                Number((y as unknown as { order?: number }).order ?? 0),
            )
            .map((p) => ({ id: p.pageId, title: p.title, status: p.status })),
        );
        setExpiry((a as unknown as { expiryDate?: string }).expiryDate?.slice(0, 10) ?? "");
      } else {
        const data = await fetchMockAlbum(id);
        setMockAlbum(data);
        setPages(
          (data?.pages ?? []).map((p: MockPage) => ({
            id: p.id,
            title: p.title,
            photoUrl: p.photoUrl,
            status: p.status,
          })),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load album.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Own preview URLs; revoke on clear/unmount (no stale object URLs).
  useEffect(
    () => () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    },
    [photoPreview],
  );
  useEffect(
    () => () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    },
    [videoPreview],
  );

  function selectPhoto(f: File) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }
  function selectVideo(f: File) {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(f);
    setVideoPreview(URL.createObjectURL(f));
  }
  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoProgress(null);
  }
  function clearVideo() {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null);
    setVideoPreview(null);
    setVideoProgress(null);
  }

  const coupleName = isProd() ? (prodAlbum?.coupleName ?? "") : (mockAlbum?.coupleName ?? "");
  const subtitle = isProd()
    ? `${prodAlbum?.pageCount ?? pages.length} pages · revision ${prodAlbum?.revision ?? 0}`
    : `${mockAlbum?.eventDate ?? ""} · ${mockAlbum?.venue ?? ""}`;
  const albumStatus = isProd() ? (prodAlbum?.status ?? "draft") : (mockAlbum?.status ?? "draft");
  const allReady = pages.length > 0 && pages.every((p) => p.status === "ready");
  const qrReady = isProd()
    ? prodAlbum?.status === "ready" && (prodAlbum?.revision ?? 0) > 0
    : allReady;

  async function addPage() {
    setFormError(null);
    if (!isProd()) {
      if (!photoPreview || !videoPreview) {
        toast.error("Add both a photo and a video");
        return;
      }
      const page = await createAlbumPage(id, {
        title: title.trim() || `Page ${pages.length + 1}`,
        photoUrl: photoPreview,
        videoUrl: videoPreview,
      });
      setPages((p) => [
        ...p,
        { id: page.id, title: page.title, photoUrl: page.photoUrl, status: "uploaded" },
      ]);
      setTitle("");
      clearPhoto();
      clearVideo();
      setPages((p) =>
        p.map((x) => (x.id === page.id ? { ...x, status: "processing" as const } : x)),
      );
      const status = await processPageMarker();
      setPages((p) => p.map((x) => (x.id === page.id ? { ...x, status } : x)));
      toast.success(`${page.title} is ready`);
      return;
    }
    // Production: reserve -> direct S3 PUTs -> finalize.
    if (!photoFile || !videoFile) {
      setFormError("Add both a photo and a video file.");
      return;
    }
    if (pages.length >= 30) {
      setFormError("Album is limited to 30 pages. Split the album before adding more.");
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const session = await prodApi.createUploadSession(id, {
        title: title.trim() || `Page ${pages.length + 1}`,
        photo: { mime: photoFile.type, bytes: photoFile.size },
        video: { mime: videoFile.type, bytes: videoFile.size },
      });
      setPages((p) => [
        ...p,
        {
          id: session.pageId,
          title: title.trim() || `Page ${pages.length + 1}`,
          status: "uploaded",
        },
      ]);
      await putToS3(session.photoUploadUrl, photoFile, setPhotoProgress, abort.signal);
      setPhotoProgress(100);
      await putToS3(session.videoUploadUrl, videoFile, setVideoProgress, abort.signal);
      setVideoProgress(100);
      setPages((p) =>
        p.map((x) => (x.id === session.pageId ? { ...x, status: "processing" as const } : x)),
      );
      const done = await prodApi.completeUpload(id, session.pageId);
      setPages((p) => p.map((x) => (x.id === done.pageId ? { ...x, status: done.status } : x)));
      setTitle("");
      clearPhoto();
      clearVideo();
      toast.success("Page uploaded. Publish to rebuild the AR target.");
      await load();
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") {
        setFormError("Upload cancelled. Retry when ready.");
      } else {
        const msg = (e as { message?: string })?.message ?? "Upload failed.";
        setFormError(msg);
        toast.error(msg);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function publish() {
    if (!isProd()) return;
    setBuildError(null);
    setBusy(true);
    try {
      const b = await prodApi.publish(id);
      setBuild(b);
      // Poll terminal build state (queued -> building -> ready/failed).
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const s = await prodApi.buildStatus(id, b.buildId);
        setBuild(s);
        if (s.status === "ready") {
          toast.success(`Published revision ${s.revision}. QR is live.`);
          await load();
          return;
        }
        if (s.status === "failed") {
          setBuildError(
            typeof (s as unknown as { error?: string }).error === "string"
              ? (s as unknown as { error: string }).error
              : "Marker build failed.",
          );
          await load();
          return;
        }
      }
      toast.message("Still building — check back shortly.");
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Publish failed.";
      setBuildError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removePage(pageId: string) {
    if (!isProd()) {
      setPages((p) => p.filter((x) => x.id !== pageId));
      return;
    }
    try {
      await prodApi.deletePage(id, pageId);
      toast.success("Page deleted.");
      await load();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Delete failed.");
    }
  }

  async function move(pageId: string, dir: -1 | 1) {
    const idx = pages.findIndex((p) => p.id === pageId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= pages.length) return;
    const next = [...pages];
    const [row] = next.splice(idx, 1);
    if (!row) return;
    next.splice(j, 0, row);
    setPages(next);
    if (isProd()) {
      try {
        await prodApi.reorderPages(
          id,
          next.map((p) => p.id),
        );
      } catch (e) {
        toast.error((e as { message?: string })?.message ?? "Reorder failed.");
        await load();
      }
    }
  }
  async function saveExpiry() {
    if (!isProd()) return;
    try {
      const value = expiry ? new Date(`${expiry}T00:00:00Z`).toISOString() : null;
      if (value && new Date(value).getTime() <= Date.now()) {
        toast.error("Expiry must be a future date.");
        return;
      }
      await prodApi.updateAlbum(id, { expiryDate: value });
      toast.success(value ? "Expiry saved. Album auto-deletes on that date." : "Expiry cleared.");
      await load();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Could not save expiry.");
    }
  }

  async function deleteWholeAlbum() {
    if (!isProd()) return;
    try {
      await prodApi.deleteAlbum(id);
      toast.success("Album deleted.");
      navigate({ to: "/admin" });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Could not delete album.");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-10">
        <div className="shimmer h-9 w-64 rounded" />
        <div className="shimmer h-64 rounded-2xl" />
      </div>
    );
  }

  if (!isProd() && !mockAlbum) {
    return <p className="px-5 py-20 text-center text-muted-foreground">Album not found.</p>;
  }
  if (isProd() && !prodAlbum) {
    return <p className="px-5 py-20 text-center text-muted-foreground">Album not found.</p>;
  }

  return (
    <div className="pb-28">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl">{coupleName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {isProd() && prodAlbum && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                  aria-label={`Edit ${coupleName}`}
                >
                  <Pencil className="size-3.5" /> Edit details
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Delete ${coupleName}`}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &ldquo;{coupleName}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the album, its photo/video pages, the published
                        marker and the guest QR link. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void deleteWholeAlbum()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete album
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
          {isProd() && (
            <p className="mt-1 text-xs text-muted-foreground">
              Status: {albumStatus} · {pages.filter((p) => p.status === "ready").length}/
              {pages.length} ready
              {build ? ` · build ${build.buildId.slice(0, 8)} (${build.status})` : ""}
            </p>
          )}
        </motion.div>

        {isProd() && prodAlbum && (
          <AlbumDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            albumId={id}
            initial={{
              coupleName: prodAlbum.coupleName,
              eventDate: prodAlbum.eventDate ?? "",
              venue: prodAlbum.venue ?? "",
              expiryDate:
                (prodAlbum as unknown as { expiryDate?: string }).expiryDate?.slice(0, 10) ?? "",
            }}
          />
        )}

        {buildError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            Publish failed: {buildError}
          </p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <section className="space-y-3">
            <h2 className="text-lg">Album pages</h2>
            <AnimatePresence initial={false}>
              {pages.map((p, i) => (
                <motion.article
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-4 rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)]"
                >
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-secondary">
                    {p.photoUrl ? (
                      <img src={p.photoUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-xs text-muted-foreground">
                        #{i + 1}
                      </span>
                    )}
                    <span className="absolute right-1 bottom-1 rounded-full bg-primary/85 p-1 text-primary-foreground">
                      <Film className="size-3" />
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Marker #{i + 1} · Photo + video pair
                    </p>
                  </div>
                  <StatusBadge status={p.status === "draft" ? "draft" : p.status} />
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => void move(p.id, -1)}
                      aria-label={`Move ${p.title} up`}
                      className="rounded p-1 text-muted-foreground hover:text-primary"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void move(p.id, 1)}
                      aria-label={`Move ${p.title} down`}
                      className="rounded p-1 text-muted-foreground hover:text-primary"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void removePage(p.id)}
                      aria-label={`Delete ${p.title}`}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
            {pages.length === 0 && (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No pages yet — add the first photo and its video.
              </p>
            )}
          </section>

          <section className="h-fit space-y-4 rounded-2xl border bg-card p-5 lg:sticky lg:top-24">
            <h2 className="text-lg">Add a page</h2>
            <label className="block">
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                Page title
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Muhurtham"
                className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-gold"
              />
            </label>
            <UploadDropzone
              type="image"
              label="Photo"
              previewUrl={photoPreview}
              progress={photoProgress}
              onSelect={selectPhoto}
              onClear={clearPhoto}
            />
            <UploadDropzone
              type="video"
              label="Video"
              previewUrl={videoPreview}
              progress={videoProgress}
              onSelect={selectVideo}
              onClear={clearVideo}
            />
            {formError && (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            )}
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => void addPage()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Plus className="size-4" /> {busy ? "Working…" : "Add Page"}
              </motion.button>
              {busy && (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-lg border px-3 py-2.5 text-sm"
                >
                  Cancel
                </button>
              )}
            </div>

            {isProd() && (
              <div className="space-y-3 border-t pt-4">
                <label className="block">
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">
                    Auto-delete on (expiry)
                  </span>
                  <input
                    type="date"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <button
                  onClick={() => void saveExpiry()}
                  className="w-full rounded-lg border px-4 py-2 text-sm"
                >
                  Save expiry
                </button>
                <button
                  onClick={() => void publish()}
                  disabled={busy || pages.length === 0}
                  className="w-full rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
                >
                  {busy ? "Publishing…" : "Publish / rebuild AR target"}
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Publish compiles one combined marker from all photos. Guests keep the last good
                  version until the new one is ready.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <StatusBadge
              status={qrReady ? "ready" : pages.length ? "processing" : "draft"}
              label={
                qrReady
                  ? "Ready to share"
                  : pages.length
                    ? isProd()
                      ? `Status: ${albumStatus}`
                      : "Pages processing"
                    : "Draft album"
              }
            />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {pages.filter((p) => p.status === "ready").length}/{pages.length} ready
            </span>
          </div>
          <motion.button
            whileTap={{ scale: qrReady ? 0.96 : 1 }}
            disabled={!qrReady}
            onClick={() => navigate({ to: "/admin/albums/$id/share", params: { id } })}
            className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            <QrCode className="size-4" /> Generate QR Code
          </motion.button>
        </div>
      </div>

      <Link to="/admin" className="sr-only">
        Back to albums
      </Link>
    </div>
  );
}
