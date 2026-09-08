import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";

/** Renders a QR image for a guest link, generated locally in the browser. */
export function QrCard({ url, size = 240 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    setFailed(false);
    QRCode.toDataURL(url, {
      width: size * 2,
      margin: 1,
      color: { dark: "#4a1220", light: "#fffdf8" },
    }).then(setSrc, () => setFailed(true));
  }, [url, size]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className="rounded-2xl border-2 border-gold bg-card p-5 shadow-[var(--shadow-gold)]"
    >
      {failed ? (
        <p role="alert" className="text-sm text-destructive" style={{ width: size }}>
          Couldn&apos;t render this QR code. Copy the link below instead.
        </p>
      ) : src ? (
        <img src={src} alt={`QR code for ${url}`} width={size} height={size} />
      ) : (
        <div className="shimmer rounded-xl" style={{ width: size, height: size }} />
      )}
    </motion.div>
  );
}

export async function downloadQr(url: string, filename: string) {
  try {
    const data = await QRCode.toDataURL(url, { width: 1024, margin: 2 });
    const a = document.createElement("a");
    a.href = data;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    throw new Error("QR download failed. Screenshot the code or copy the link.");
  }
}
