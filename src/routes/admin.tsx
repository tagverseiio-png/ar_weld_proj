import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Images, LogOut, Settings, Upload } from "lucide-react";
import { STUDIO_CITY, STUDIO_NAME } from "@/lib/mock-api";
import { login, logout, useAuthState } from "@/lib/auth";
import { prodApi } from "@/lib/api";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const nav = [
  { to: "/admin", label: "Albums", icon: Images, exact: true },
  { to: "/admin/upload", label: "Upload", icon: Upload },
  { to: "/admin/settings", label: "Settings", icon: Settings },
] as const;

function AdminLayout() {
  const { signedIn, email } = useAuthState();
  const navigate = useNavigate();

  // Single-studio gate: every admin mutation is server-enforced (Cognito JWT
  // authorizer). The UI gate below is UX only — never a security boundary.
  if (!signedIn) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] tracking-[0.35em] text-primary uppercase">
          {STUDIO_NAME} · {STUDIO_CITY}
        </p>
        <h1 className="mt-4 text-3xl">Studio sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {prodApi.configured
            ? "Sign in with the studio administrator account to manage albums."
            : "Local prototype mode — sign in creates a mock studio session (no AWS)."}
        </p>
        <button
          onClick={() => login()}
          className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Sign in as studio admin
        </button>
        {email && <p className="mt-3 text-xs text-muted-foreground">{email}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="leading-tight">
            <span className="text-lg text-display">{STUDIO_NAME}</span>
            <span className="ml-2 text-[10px] tracking-[0.25em] text-muted-foreground uppercase">
              {STUDIO_CITY}
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map(({ to, label, icon: Icon, ...rest }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: "exact" in rest }}
                activeProps={{ className: "bg-secondary text-primary" }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <Icon className="size-4" /> {label}
              </Link>
            ))}
            <button
              onClick={() => {
                logout();
                navigate({ to: "/" });
              }}
              className="ml-1 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-primary"
              aria-label="Sign out"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
