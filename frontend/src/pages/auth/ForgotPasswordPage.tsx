import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, type Schemas } from "@/lib/api";

import { AuthLayout } from "./AuthLayout";

/** Asks for a one-time "set a new password" link by email. The answer is the
 * same whether or not the address has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<Schemas["MessageResponse"]>("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
        noRefresh: true,
      });
      setSent(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold">Forgot your password?</h2>
        <p className="text-muted-foreground">Enter your email and we’ll send you a link to choose a new one.</p>
      </div>
      {sent ? (
        <Alert>
          <AlertDescription>
            {sent} The link works once. Check your spam folder if you don’t see it.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 h-12 text-[15px]" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Email me a link"}
          </Button>
        </form>
      )}
      <p className="text-center text-muted-foreground">
        <Link to="/login" className="font-semibold text-accent-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
