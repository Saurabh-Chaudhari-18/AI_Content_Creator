import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold">Welcome back</h2>
      <p className="text-muted-foreground">Sign in to your workspace.</p>
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
          <Label htmlFor="password">Password</Label>
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
      <p className="text-center text-muted-foreground">
        New here?{" "}
        <Link to="/register" className="font-semibold text-accent-foreground underline-offset-4 hover:underline">
          Create a free workspace
        </Link>
      </p>
      <p className="mt-auto text-xs text-muted-foreground">
        Your social accounts’ login keys are stored encrypted and never shown in the browser.
      </p>
    </AuthLayout>
  );
}
