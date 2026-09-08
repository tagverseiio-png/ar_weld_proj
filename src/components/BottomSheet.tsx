import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => info.offset.y > 110 && onClose()}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t-2 border-gold bg-card p-5 pb-8 shadow-[var(--shadow-soft)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border" />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
