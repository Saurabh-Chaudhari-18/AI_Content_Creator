import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { AuthLayout } from "./AuthLayout";

// Mirrors backend RegisterRequest: 8+ characters, at most 72 bytes (bcrypt).
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (new TextEncoder().encode(pw).length > 72) return "That password is too long (72 bytes at most).";
  return null;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pwHint = password ? passwordProblem(password) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await register(fullName.trim(), email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">Create your workspace</h2>
      <p className="text-muted-foreground">Free to start. You can invite your team later.</p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            maxLength={255}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Work email</Label>
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
            autoComplete="new-password"
            required
            aria-describedby="pw-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
          <p id="pw-hint" className={pwHint ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {pwHint ?? "At least 8 characters."}
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          className="mt-1 h-12 text-[15px]"
          disabled={busy || !fullName.trim() || !email || !password}
        >
          {busy ? "Creating…" : "Create workspace"}
        </Button>
      </form>
      <p className="text-center text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-accent-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
