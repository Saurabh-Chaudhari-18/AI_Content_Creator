/**
 * The client's approval page: /a#<token>. No account, no cookies.
 *
 * The token lives in the URL fragment, which the browser never sends to a
 * server; this page posts it in a request body instead. Light theme, built
 * for a phone first. Plan: docs/client_approval_link_plan.md §6.
 */
import { Check, CircleAlert, Clock, MessageSquareText, ShieldCheck, TimerOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Schemas } from "@/lib/api";
import { deadlineLabel } from "@/lib/approvals";
import { cn } from "@/lib/utils";

type View = Schemas["PublicViewResponse"];
type Receipt = Schemas["PublicReceipt"];
type Failure = { code: string; detail: string };

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: Failure }> {
  try {
    const res = await fetch(`/api/v1/public/approval/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : res.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : Array.isArray(data?.detail)
            ? String(data.detail[0]?.msg ?? "Please check your answer.").replace(/^Value error, /, "")
            : "Something went wrong. Please try again.";
    return { ok: false, status: res.status, error: { code: data?.code ?? String(res.status), detail } };
  } catch {
    return { ok: false, status: 0, error: { code: "offline", detail: "Can’t reach the server. Check your connection and try again." } };
  }
}

/** Clients aren't app users: always the light theme, never indexed. */
function usePublicPageChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    // After the app's theme effect has run on first paint.
    const t = window.setTimeout(() => root.classList.remove("dark"), 0);
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const title = document.title;
    document.title = "Review a post";
    return () => {
      window.clearTimeout(t);
      meta.remove();
      document.title = title;
      if (wasDark) root.classList.add("dark");
    };
  }, []);
}

function useCountdown(expiresAt: string | undefined, serverNow: string | undefined) {
  // Offset between the server's clock and this phone's, so a wrong phone clock doesn't matter.
  const offset = useMemo(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0), [serverNow]);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, offset]);
  if (!expiresAt) return { ms: Infinity, text: "", warn: false };
  const total = new Date(expiresAt).getTime();
  const ms = total - now;
  const min = Math.ceil(ms / 60_000);
  const text =
    ms <= 0
      ? "Expired"
      : min < 60
        ? `Expires in ${min} minute${min === 1 ? "" : "s"}`
        : min < 48 * 60
          ? `Expires in ${Math.round(min / 60)} hour${Math.round(min / 60) === 1 ? "" : "s"}`
          : `Expires in ${Math.round(min / 1440)} days`;
  return { ms, text, warn: ms > 0 && min <= 60 };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-40">{children}</main>
    </div>
  );
}

function Notice({ icon: Icon, title, children, tone = "neutral" }: { icon: typeof Check; title: string; children?: React.ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-tile)] border bg-card px-6 py-10 text-center",
        tone === "success" && "border-success-border",
        tone === "warning" && "border-warning-border",
      )}
    >
      <span
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h1 className="m-0 text-xl font-medium">{title}</h1>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </section>
  );
}

function ReceiptCard({ receipt, agency }: { receipt: Receipt; agency: string }) {
  const approved = receipt.decision === "approved";
  return (
    <Notice icon={approved ? ShieldCheck : MessageSquareText} tone={approved ? "success" : "warning"} title={approved ? "Approved. Thank you!" : "Changes requested"}>
      <p className="m-0">
        {approved ? `${agency} can now publish this post.` : `${agency} has your note and will send you the updated post.`}
      </p>
      <dl className="m-0 mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-sm">
        <dt className="text-muted-foreground">By</dt>
        <dd className="m-0 text-foreground">{receipt.name}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd className="m-0 text-foreground">{deadlineLabel(receipt.decided_at)}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="m-0 text-foreground">{receipt.version}</dd>
        <dt className="text-muted-foreground">Fingerprint</dt>
        <dd className="m-0 font-mono text-foreground">{receipt.fingerprint}</dd>
      </dl>
      <p className="m-0 mt-3 text-xs">Keep this screen if you need proof of what you {approved ? "approved" : "reviewed"}.</p>
    </Notice>
  );
}

export function ClientApprovalPage() {
  usePublicPageChrome();
  const token = useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, "")), []);
  const [view, setView] = useState<View | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<string>("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setFailure({ code: "not_valid", detail: "This link is not valid. Ask the agency for a new one." });
      setLoading(false);
      return;
    }
    const res = await post<View>("view", { token });
    setLoading(false);
    if (!res.ok) {
      setFailure(res.error);
      return;
    }
    setView(res.data);
    setPlatform((p) => p || res.data.platforms?.[0]?.platform || "");
    setName((n) => n || res.data.recipient_name);
    if (res.data.receipt) setReceipt(res.data.receipt);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const countdown = useCountdown(view?.state === "open" ? view.expires_at : undefined, view?.server_now);
  const expiredNow = view?.state === "open" && countdown.ms <= 0;

  async function decide(decision: "approve" | "request_changes") {
    setSending(true);
    setSendError(null);
    const res = await post<Receipt>("decide", { token, decision, name: name.trim(), note: decision === "request_changes" ? note.trim() : null });
    setSending(false);
    if (res.ok) {
      setReceipt(res.data);
      return;
    }
    if (["expired", "already_reviewed", "changed", "already_decided", "not_valid", "unavailable"].includes(res.error.code)) {
      // The situation changed under the client: show the matching screen.
      setLoading(true);
      setView(null);
      await load();
      setSendError(null);
      return;
    }
    setSendError(res.error.detail);
  }

  if (loading) {
    return (
      <Shell>
        <p className="py-20 text-center text-sm text-muted-foreground" role="status">
          Loading the post…
        </p>
      </Shell>
    );
  }
  if (failure || !view) {
    const unavailable = failure?.code === "unavailable";
    return (
      <Shell>
        <Notice icon={CircleAlert} title={unavailable ? "Temporarily unavailable" : "This link doesn’t work"}>
          {failure?.detail ?? "This link is not valid. Ask the agency for a new one."}
        </Notice>
      </Shell>
    );
  }

  const header = (
    <header className="flex items-center gap-3">
      {view.brand_logo_url ? (
        <img src={view.brand_logo_url} alt="" className="size-11 rounded-xl object-cover" />
      ) : (
        <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
          {view.brand_name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="m-0 truncate text-base font-medium">{view.brand_name}</p>
        <p className="m-0 truncate text-xs text-muted-foreground">From {view.agency_name}</p>
      </div>
    </header>
  );

  if (receipt) {
    return (
      <Shell>
        {header}
        <ReceiptCard receipt={receipt} agency={view.agency_name} />
      </Shell>
    );
  }
  if (view.state === "already_reviewed") {
    return (
      <Shell>
        {header}
        <Notice icon={Check} title="Already reviewed">
          This post has already been reviewed. There’s nothing more you need to do.
        </Notice>
      </Shell>
    );
  }
  if (view.state === "changed") {
    return (
      <Shell>
        {header}
        <Notice icon={CircleAlert} tone="warning" title="This post has changed">
          {view.message}
        </Notice>
      </Shell>
    );
  }
  if (view.state === "expired" || expiredNow) {
    return (
      <Shell>
        {header}
        <Notice icon={TimerOff} tone="warning" title="This link has expired">
          It expired at {deadlineLabel(view.expires_at)}. Ask {view.agency_name} for a new one.
        </Notice>
      </Shell>
    );
  }

  const current = view.platforms.find((p) => p.platform === platform) ?? view.platforms[0];
  return (
    <Shell>
      {header}

      <section className="flex flex-col gap-2">
        <h1 className="m-0 text-xl leading-7 font-medium">
          Hi {view.recipient_name.split(" ")[0]}, please review this post
        </h1>
        <p className="m-0 text-sm text-muted-foreground">
          {view.agency_name} asked for your approval · Version {view.version}
        </p>
        <p
          className={cn(
            "m-0 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            countdown.warn ? "border-warning-border bg-warning-soft text-warning" : "bg-card text-secondary-foreground",
          )}
          role="timer"
          aria-live="off"
        >
          <Clock className="size-3.5" aria-hidden="true" /> {countdown.text} · by {deadlineLabel(view.expires_at)}
        </p>
      </section>

      {view.platforms.length > 1 && (
        <div role="tablist" aria-label="Platform" className="flex gap-1 rounded-lg border bg-card p-1">
          {view.platforms.map((p) => (
            <button
              key={p.platform}
              role="tab"
              type="button"
              aria-selected={p.platform === current?.platform}
              onClick={() => setPlatform(p.platform)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                p.platform === current?.platform ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover",
              )}
            >
              {PLATFORM_LABEL[p.platform] ?? p.platform}
            </button>
          ))}
        </div>
      )}

      <article className="overflow-hidden rounded-[var(--radius-tile)] border bg-card" aria-label={`${PLATFORM_LABEL[current?.platform ?? ""] ?? "Post"} preview`}>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
            {view.brand_name.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm font-medium">{view.brand_name}</span>
          {current && <span className="ml-auto text-xs text-muted-foreground">{PLATFORM_LABEL[current.platform] ?? current.platform}</span>}
        </div>
        {view.media.length > 0 && (
          <div className="flex snap-x snap-mandatory overflow-x-auto bg-muted" aria-label={`${view.media.length} media item${view.media.length === 1 ? "" : "s"}`}>
            {view.media.map((m, i) =>
              m.media_type === "video" ? (
                <video key={i} src={m.url} controls playsInline className="aspect-square w-full flex-none snap-center object-contain" />
              ) : (
                <img key={i} src={m.url} alt={m.alt_text ?? ""} className="aspect-square w-full flex-none snap-center object-cover" />
              ),
            )}
          </div>
        )}
        <p className="m-0 px-4 py-3 text-[15px] leading-6 break-words whitespace-pre-wrap">{current?.text}</p>
      </article>

      {/* ── Decision bar ─────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-3">
          {mode === "changes" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-note">What should change?</Label>
              <Textarea id="client-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="client-name" className="flex-none text-xs text-muted-foreground">
              Your name
            </Label>
            <Input id="client-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          {sendError && (
            <p className="m-0 text-sm text-danger" role="alert">
              {sendError}
            </p>
          )}
          {mode === "changes" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setMode("idle")} disabled={sending}>
                Back
              </Button>
              <Button onClick={() => decide("request_changes")} disabled={sending || !note.trim() || !name.trim()}>
                {sending ? "Sending…" : "Send changes"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setMode("changes")} disabled={sending}>
                Request changes
              </Button>
              <Button className="btn-depth" onClick={() => decide("approve")} disabled={sending || !name.trim()}>
                <ShieldCheck aria-hidden="true" /> {sending ? "Approving…" : "Approve"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
