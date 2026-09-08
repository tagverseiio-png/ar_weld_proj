import { motion } from "framer-motion";

/** Pulsing corner guide shown over the (mock) camera viewfinder. */
export function AnimatedCameraFrame() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.035, 1], opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="relative aspect-[3/4] w-[72%] max-w-sm"
      >
        {[
          "top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl",
          "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl",
          "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
          "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
        ].map((c) => (
          <span key={c} className={`absolute size-14 border-gold ${c}`} />
        ))}
        <motion.span
          animate={{ top: ["6%", "92%", "6%"] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-x-6 h-px bg-gold/70 shadow-[0_0_14px_2px_var(--gold)]"
        />
      </motion.div>
    </div>
  );
}
