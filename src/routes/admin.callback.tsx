import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { handleAuthCallback, isSignedIn } from "@/lib/auth";

export const Route = createFileRoute("/admin/callback")({
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Revisits (back button, double mount) have no fresh code to exchange.
    if (isSignedIn()) {
      navigate({ to: "/admin" });
      return;
    }
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      setError("Missing authorization code. Start again from sign-in.");
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
        <>
          <p className="mt-2 text-sm text-destructive">{error}</p>
          <Link
            to="/admin"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <div className="shimmer mt-6 h-2 w-48 rounded" />
      )}
    </div>
  );
}
