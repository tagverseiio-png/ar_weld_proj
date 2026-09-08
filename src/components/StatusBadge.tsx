import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "draft" | "processing" | "ready" | "uploaded" | "failed" | "expired";

const styles: Record<Status, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
  uploaded: {
    label: "Uploaded",
    className: "bg-secondary text-secondary-foreground border-gold-soft",
  },
  processing: {
    label: "Processing marker",
    className: "bg-warning/15 text-warning border-warning/40",
  },
  ready: {
    label: "Ready",
    className: "bg-success/12 text-success border-success/35",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/40",
  },
  expired: {
    label: "Expired",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  const s = styles[status];
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase",
        s.className,
        className,
      )}
    >
      {status === "processing" && <Loader2 className="size-3 animate-spin" />}
      {label ?? s.label}
    </motion.span>
  );
}
