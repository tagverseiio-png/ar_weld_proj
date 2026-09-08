import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImagePlus, Video, X } from "lucide-react";
import { validatePhotoFile, validateVideoFile } from "@/contracts";
import { cn } from "@/lib/utils";

type Props = {
  type: "image" | "video";
  label: string;
  /** Parent-owned preview object URL (revoked by parent on clear/unmount). */
  previewUrl: string | null;
  progress?: number | null;
  error?: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
};

/**
 * Drag-and-drop picker that retains the actual File.
 * Validation mirrors the server contract (JPEG/WebP + MP4, size caps).
 * Upload progress/cancel/retry is owned by the parent form.
 */
export function UploadDropzone({
  type,
  label,
  previewUrl,
  progress,
  error,
  onSelect,
  onClear,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = type === "image" ? "image/jpeg,image/webp" : "video/mp4";
  const Icon = type === "image" ? ImagePlus : Video;
  const message = error ?? localError;

  function take(file?: File | null) {
    if (!file) return;
    const problem = type === "image" ? validatePhotoFile(file) : validateVideoFile(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    onSelect(file);
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <motion.div
        whileHover={{ scale: previewUrl ? 1 : 1.01 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !previewUrl && inputRef.current?.click()}
        className={cn(
          "relative flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed bg-card text-center transition-colors",
          dragging ? "border-gold bg-secondary" : "border-border",
          message ? "border-destructive/60" : "",
        )}
        role="button"
        tabIndex={0}
        aria-label={`${label} upload dropzone`}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !previewUrl) inputRef.current?.click();
        }}
      >
        {previewUrl ? (
          <>
            {type === "image" ? (
              <img src={previewUrl} alt="" className="size-full object-cover" />
            ) : (
              <video
                src={previewUrl}
                className="size-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            )}
            {typeof progress === "number" && (
              <div
                className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30"
                aria-label={`Upload ${progress}%`}
              >
                <div className="h-full bg-gold transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLocalError(null);
                onClear();
              }}
              className="absolute top-2 right-2 rounded-full bg-primary/90 p-1.5 text-primary-foreground"
              aria-label={`Remove ${label}`}
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <div className="px-6">
            <Icon className="mx-auto mb-2 size-6 text-gold" />
            <p className="text-sm text-muted-foreground">Drag a {type} here, or tap to browse</p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {type === "image" ? "JPEG or WebP · max 10 MB" : "MP4 H.264 · 10–30s · ~8 MB target"}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          aria-hidden={false}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </motion.div>
      {message && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
