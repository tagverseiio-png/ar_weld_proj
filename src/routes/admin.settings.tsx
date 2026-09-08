import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { STUDIO_CITY, STUDIO_NAME } from "@/lib/mock-api";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Studio Settings — AR Video Album" },
      {
        name: "description",
        content: "Studio branding and playback defaults for AR wedding albums.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Studio Settings — AR Video Album" },
      {
        property: "og:description",
        content: "Studio branding and playback defaults.",
      },
    ],
  }),
  component: SettingsPage,
});

// Mock settings — later: GET/PUT /studio/settings
const fields = [
  { label: "Studio name", value: STUDIO_NAME },
  { label: "City", value: STUDIO_CITY },
  { label: "Contact email", value: "hello@marikkanustudios.in" },
  { label: "Default video quality", value: "1080p" },
];

function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Branding shown to guests when they scan an album.
      </p>
      <div className="mt-8 space-y-4">
        {fields.map((f, i) => (
          <motion.label
            key={f.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="block rounded-xl border bg-card p-4"
          >
            <span className="text-xs tracking-wide text-muted-foreground uppercase">{f.label}</span>
            <input
              defaultValue={f.value}
              className="mt-1.5 w-full bg-transparent text-base outline-none"
            />
          </motion.label>
        ))}
      </div>
      <motion.button
        whileTap={{ scale: 0.96 }}
        className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Save changes
      </motion.button>
    </div>
  );
}
