import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { handleAuthCallback } from "@/lib/auth";

export const Route = createFileRoute("/admin/callback")({
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      setError("Missing authorization code.");
      return;
    }
    handleAuthCallback(code)
      .then(() => navigate({ to: "/admin" }))
      .catch((e) => setError(e instanceof Error ? e.message : "Sign-in failed."));
  }, [navigate]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl">{error ? "Sign-in failed" : "Signing you in…"}</h1>
      {error ? (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      ) : (
        <div className="shimmer mt-6 h-2 w-48 rounded" />
      )}
    </div>
  );
}
