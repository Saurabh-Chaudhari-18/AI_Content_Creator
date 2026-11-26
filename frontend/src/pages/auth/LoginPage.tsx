import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // Sent here from the staff console: say so, or the redirect looks like a broken link.
  const toStaff = from.startsWith("/admin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      const isStaff = user.platform_role === "super_admin";
      if (toStaff && !isStaff) {
        toast.error("This login is not platform staff, so it cannot open the staff console. You are in your workspace instead.");
        navigate("/", { replace: true });
        return;
      }
      // Staff land in their console unless they were heading somewhere else.
      navigate(isStaff && from === "/" ? "/admin" : from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold">{toStaff ? "Sign in to the staff console" : "Welcome back"}</h2>
      <p className="text-muted-foreground">
        {toStaff
          ? "The console needs a platform staff login. After you sign in you go straight back to it."
          : "Sign in to your workspace."}
      </p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-[13px] text-accent-foreground underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
        </div>
        <Button type="submit" size="lg" className="mt-1 h-12 text-[15px]" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {!toStaff && <p className="text-center text-muted-foreground">
        New here?{" "}
        <Link to="/register" className="font-semibold text-accent-foreground underline-offset-4 hover:underline">
          Create a free workspace
        </Link>
      </p>}
      <p className="mt-auto text-xs text-muted-foreground">
        Your social accounts’ login keys are stored encrypted and never shown in the browser.
      </p>
    </AuthLayout>
  );
}
