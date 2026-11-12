import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, type Schemas } from "@/lib/api";

import { AuthLayout } from "./AuthLayout";

/** Redeems a one-time link from the staff console: a new login picks its password, or a forgotten one is replaced. */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (new TextEncoder().encode(password).length > 72) return setError("That password is too long. Use at most 72 bytes.");
    if (password !== confirm) return setError("The two passwords are different. Type the same one twice.");
    setBusy(true);
    try {
      await api<Schemas["MessageResponse"]>("/auth/set-password", { method: "POST", body: { token, password }, noRefresh: true });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <h2 className="text-2xl font-semibold">This link is incomplete</h2>
        <p className="text-muted-foreground">Open the full link you were sent, or ask the person who sent it for a new one.</p>
        <Link to="/login" className="font-semibold text-accent-foreground underline-offset-4 hover:underline">Go to sign in</Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <h2 className="text-2xl font-semibold">Your password is set</h2>
        <p className="text-muted-foreground">Sign in with your email and the password you just chose. Any other sessions were signed out.</p>
        <Button asChild size="lg" className="h-12 text-[15px]"><Link to="/login">Sign in</Link></Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold">Choose your password</h2>
      <p className="text-muted-foreground">This link works once. After this you sign in with your email and this password.</p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">Type it again</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
        </div>
        <Button type="submit" size="lg" className="mt-1 h-12 text-[15px]" disabled={busy || !password || !confirm}>
          {busy ? "Saving…" : "Set password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
