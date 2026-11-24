/**
 * "Stop these reminders": /email/stop#<token>, from the link at the bottom
 * of a reminder email to a client. No account. The token stays in the URL
 * fragment (never sent to a server by the browser) and is posted in a body.
 * A button, not an automatic action, so a mail scanner opening the link
 * changes nothing. Plan: docs/approval_reminders_certificate_plan.md §10.
 */
import { BellOff, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Schemas } from "@/lib/api";
import { usePublicPageChrome } from "@/lib/publicPage";

type Stopped = Schemas["StopResponse"];

export function EmailStopPage() {
  usePublicPageChrome("Stop reminder emails");
  const token = useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, "")), []);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Stopped | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/email/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (res.ok) setDone((await res.json()) as Stopped);
      else if (res.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else setError("This link is not valid. You can also reply to the email and ask the agency to stop.");
    } catch {
      setError("Can’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-16 pb-20">
        <section className="flex flex-col items-center gap-3 rounded-[var(--radius-tile)] border bg-card px-6 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <BellOff className="size-6" aria-hidden="true" />
          </span>
          {done ? (
            <>
              <h1 className="m-0 text-xl font-medium">Reminders stopped</h1>
              <p className="m-0 text-sm text-muted-foreground">
                You won’t get reminder emails about {done.brand_name} posts any more. {done.agency_name} can still send you posts to
                review themselves.
              </p>
            </>
          ) : (
            <>
              <h1 className="m-0 text-xl font-medium">Stop reminder emails?</h1>
              <p className="m-0 text-sm text-muted-foreground">
                You’ll no longer get automatic reminders about posts waiting for your approval. The agency can still contact you
                directly.
              </p>
              {error && (
                <p className="m-0 flex items-start gap-2 text-left text-sm text-warning" role="alert">
                  <CircleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" /> {error}
                </p>
              )}
              <Button className="mt-2 h-11" onClick={stop} disabled={busy || !token}>
                {busy ? "Stopping…" : "Stop reminders"}
              </Button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
