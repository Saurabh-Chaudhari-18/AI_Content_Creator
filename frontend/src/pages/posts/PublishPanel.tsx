import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { JobBadge, TileTitle } from "@/components/common";
import { BrandTile } from "@/components/PostThumb";
import { Tile } from "@/components/Tile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, type Brand, type Post, type Schemas, type SocialAccount } from "@/lib/api";
import { formatDateTime, platformName, timeZoneLabel, toLocalInputValue, viewerTimeZone } from "@/lib/format";
import { keys, useAccounts, type Job, type Validation } from "@/lib/queries";
import { cn } from "@/lib/utils";

function tomorrowAt10(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInputValue(d);
}

/** The id the "Schedule" buttons scroll to. */
export const PUBLISH_PANEL_ID = "publish-panel";

/** Bring the scheduling panel into view and put the cursor in "When?". */
export function focusPublishPanel(): void {
  const panel = document.getElementById(PUBLISH_PANEL_ID);
  if (!panel) return;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => document.getElementById("when")?.focus({ preventScroll: true }), 350);
}

// ── Which accounts a brand last posted to (this browser only) ──────────
// Accounts belong to the workspace, not to a brand, so nothing is ticked
// until the user picks; after that we remember their pick for this brand.
const LAST_USED_KEY = (brandId: string) => `omnipost:last-accounts:${brandId}`;

function lastUsedAccounts(brandId: string | undefined): string[] {
  if (!brandId) return [];
  try {
    const raw = localStorage.getItem(LAST_USED_KEY(brandId));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberAccounts(brandId: string | undefined, ids: string[]): void {
  if (!brandId) return;
  try {
    localStorage.setItem(LAST_USED_KEY(brandId), JSON.stringify(ids));
  } catch {
    /* storage blocked: nothing is remembered, nothing breaks */
  }
}

/** Does this account's name look like the brand's? A soft hint against posting to another client's page. */
function looksLikeBrand(brandName: string | undefined, accountName: string): boolean {
  if (!brandName) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const acc = norm(accountName);
  const brand = norm(brandName);
  const words = brandName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!acc || !brand) return true;
  return acc.includes(brand) || brand.includes(acc) || words.some((w) => acc.includes(w));
}

// ── Turning check messages into a next step ────────────────────────────
type FixTarget = "photos" | "caption";
type Fix =
  | { kind: FixTarget; label: string }
  | { kind: "link"; label: string; to: string }
  | { kind: "untick"; label: string };
type Note = { text: string; fix?: Fix; tone: "error" | "warning" };

/** Plain words and the one thing to do about each message from the pre-publish check. */
function explain(message: string, platform: string, tone: Note["tone"]): Note {
  const name = platformName(platform);
  const m = message.toLowerCase();
  if (m.includes("requires at least one image"))
    return { tone, text: `${name} needs a photo to post.`, fix: { kind: "photos", label: "Add a photo" } };
  if (m.includes("single image per"))
    return { tone, text: `${name} can post only one photo for now.`, fix: { kind: "photos", label: "Edit photos" } };
  if (m.includes("isn't included in your plan") || m.includes("isn’t included in your plan"))
    return { tone, text: `Your plan doesn’t include posting to ${name}.`, fix: { kind: "link", label: "See your plan", to: "/settings#plan" } };
  if (m.includes("temporarily unavailable"))
    return { tone, text: `Posting to ${name} is paused on our side for a while.`, fix: { kind: "untick", label: "Leave it out for now" } };
  if (m.includes("is disconnected"))
    return { tone, text: "This account is disconnected.", fix: { kind: "link", label: "Reconnect", to: "/accounts" } };
  if (m.includes("token expires soon"))
    return { tone, text: "This account needs reconnecting soon, or posts to it will fail.", fix: { kind: "link", label: "Reconnect", to: "/accounts" } };
  if (m.includes("post text is empty"))
    return { tone, text: "There’s no text to post.", fix: { kind: "caption", label: "Write a caption" } };
  const tooLong = message.match(/Text is ([\d,]+) characters; the \w+ limit is ([\d,]+)/i);
  if (tooLong)
    return { tone, text: `Too long for ${name}: ${tooLong[1]} of ${tooLong[2]} characters.`, fix: { kind: "caption", label: "Shorten the caption" } };
  if (m.includes("publishes text only"))
    return { tone, text: `${name} posts the text only; photos are left out.` };
  return { tone, text: message };
}

function FixButton({ fix, onFix, onUntick }: { fix: Fix; onFix: (target: FixTarget) => void; onUntick: () => void }) {
  const cls = "inline-flex min-h-8 items-center font-semibold text-accent-foreground underline-offset-4 hover:underline";
  if (fix.kind === "link")
    return (
      <Link to={fix.to} className={cls}>
        {fix.label}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={() => (fix.kind === "untick" ? onUntick() : onFix(fix.kind))}>
      {fix.label}
    </button>
  );
}

/** "Where should it go?" — accounts, live pre-publish check, schedule / post now. */
export function PublishPanel({
  post,
  brand,
  onFix,
  initialWhen,
}: {
  post: Post;
  brand: Brand | undefined;
  /** Take the user to the part of the post a check complains about. */
  onFix: (target: FixTarget) => void;
  /** Pre-filled "When?" (datetime-local value), e.g. from a calendar day. */
  initialWhen?: string;
}) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [when, setWhen] = useState(() => initialWhen ?? tomorrowAt10());

  const active = useMemo(() => (accounts.data ?? []).filter((a) => a.is_active), [accounts.data]);
  const activeIds = useMemo(() => active.map((a) => a.id), [active]);
  // Nothing is ticked by default: accounts belong to the whole workspace, so
  // ticking everything would post one client's work to another's page.
  // The pages this brand used last time (in this browser) are the only default.
  const chosen = selected ?? lastUsedAccounts(brand?.id).filter((id) => activeIds.includes(id));
  const setChosen = (ids: string[]) => setSelected(ids);

  // Check every active account at once, so ticking one shows its result immediately.
  const check = useQuery({
    queryKey: ["validate", post.id, post.version_number, post.updated_at, [...activeIds].sort().join(",")],
    queryFn: () => api<Validation>(`/posts/${post.id}/validate`, { method: "POST", body: { social_account_ids: activeIds } }),
    enabled: activeIds.length > 0,
  });
  const resultFor = (id: string) => check.data?.results.find((r) => r.social_account_id === id);
  const chosenOk = chosen.length > 0 && check.isSuccess && chosen.every((id) => resultFor(id)?.ok);

  const done = (msg: string) => {
    rememberAccounts(brand?.id, chosen);
    toast.success(msg);
    qc.invalidateQueries({ queryKey: keys.post(post.id) });
    qc.invalidateQueries({ queryKey: keys.jobs(post.id) });
    qc.invalidateQueries({ queryKey: ["ws-posts"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

  const schedule = useMutation({
    mutationFn: () =>
      api<Schemas["ScheduleResponse"]>(`/posts/${post.id}/schedule`, {
        method: "POST",
        body: { scheduled_at: new Date(when).toISOString(), timezone: viewerTimeZone(), social_account_ids: chosen },
      }),
    onSuccess: () => done("Scheduled. We’ll post it at the time you picked."),
    onError,
  });
  const publishNow = useMutation({
    mutationFn: () =>
      api<Schemas["ScheduleResponse"]>(`/posts/${post.id}/publish-now`, { method: "POST", body: { social_account_ids: chosen } }),
    onSuccess: () => {
      setConfirmNow(false);
      done("Sending now. Results appear below in a few seconds.");
    },
    onError,
  });
  // Posting is public and can't be undone: ask first, and never let both
  // buttons fire at once.
  const [confirmNow, setConfirmNow] = useState(false);
  const sending = schedule.isPending || publishNow.isPending;
  const brandName = brand?.name ?? "this brand";

  if (accounts.isSuccess && active.length === 0) {
    return (
      <Tile id={PUBLISH_PANEL_ID} aria-labelledby="where-h" className="scroll-mt-24">
        <TileTitle id="where-h">Where should it go?</TileTitle>
        <p className="m-0 text-muted-foreground">No social accounts are connected yet, so there’s nowhere to post it.</p>
        <Button asChild className="self-start">
          <Link to="/accounts">Connect an account</Link>
        </Button>
      </Tile>
    );
  }

  const whenMs = new Date(when).getTime();
  // An emptied date field is "no time", not a valid one.
  const inPast = !Number.isFinite(whenMs) || whenMs <= Date.now();
  const chosenAccounts = active.filter((a) => chosen.includes(a.id));
  const accountLabel = (a: SocialAccount) => `${platformName(a.platform)} · ${a.account_name}`;
  const untick = (id: string) => setChosen(chosen.filter((x) => x !== id));

  // The one reason the buttons are off, said once, next to them.
  const reason =
    chosen.length === 0
      ? `Tick the pages this post should go to. Only pick ${brandName}’s pages.`
      : check.isLoading
        ? "Checking the post against each page…"
        : !chosenOk
          ? "Fix the notes above, or leave that page out."
          : null;

  return (
    <Tile id={PUBLISH_PANEL_ID} aria-labelledby="where-h" className="scroll-mt-24">
      <div className="flex flex-col gap-1">
        <TileTitle id="where-h">Where should it go?</TileTitle>
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted-foreground">
          <BrandTile brand={brand} className="size-5 rounded-[5px] text-[10px]" />
          <span>
            Posting for <span className="font-semibold text-foreground">{brandName}</span>
          </span>
        </p>
      </div>
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="sr-only">Pages to post to</legend>
        {active.map((a) => {
          const r = resultFor(a.id);
          const on = chosen.includes(a.id);
          const notes: Note[] = r
            ? [
                ...r.errors.map((e) => explain(e, a.platform, "error")),
                ...r.warnings.filter((w) => !w.includes("must be approved")).map((w) => explain(w, a.platform, "warning")),
              ]
            : [];
          if (on && !looksLikeBrand(brand?.name, a.account_name))
            notes.push({ tone: "warning", text: `Check this is ${brandName}’s page — the name doesn’t match.`, fix: { kind: "untick", label: "Leave it out" } });
          return (
            <div key={a.id} className="border-b py-2 last:border-b-0">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-[18px] accent-[var(--primary)]"
                  checked={on}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, a.id] : chosen.filter((id) => id !== a.id))}
                />
                <span className="flex-1">{accountLabel(a)}</span>
                {on && r && (
                  <span className={cn("flex items-center gap-1 text-xs font-semibold", r.ok ? (notes.length ? "text-warning" : "text-success") : "text-danger")}>
                    {r.ok ? notes.length ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
                    {r.ok ? (notes.length ? "Ready, with a note" : "Ready") : "Can’t post yet"}
                  </span>
                )}
              </label>
              {on && notes.length > 0 && (
                <ul className="m-0 mb-1 ml-8 flex flex-col gap-1 p-0 text-[13px]">
                  {notes.map((n) => (
                    <li key={n.text} className="flex list-none flex-wrap items-center gap-x-3">
                      <span className={n.tone === "error" ? "text-danger" : "text-warning"}>{n.text}</span>
                      {n.fix && <FixButton fix={n.fix} onFix={onFix} onUntick={() => untick(a.id)} />}
                      {n.tone === "error" && n.fix?.kind !== "untick" && (
                        <button type="button" className="inline-flex min-h-8 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => untick(a.id)}>
                          Leave it out
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="when">When?</Label>
        <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11" />
        <span className="text-xs text-muted-foreground">Your time zone: {timeZoneLabel()}</span>
        {inPast && <span className="text-xs text-danger">Pick a time in the future.</span>}
      </div>

      {chosenAccounts.length > 0 && (
        <p className="m-0 rounded-lg bg-muted px-3 py-2 text-[13px]">
          <span className="font-semibold">{brandName}</span> → {chosenAccounts.map(accountLabel).join(", ")}
        </p>
      )}

      <Button size="lg" className="mt-1 h-11" disabled={!chosenOk || inPast || sending} onClick={() => schedule.mutate()}>
        {schedule.isPending ? "Scheduling…" : "Schedule post"}
      </Button>
      <Button variant="outline" disabled={!chosenOk || sending} onClick={() => setConfirmNow(true)}>
        {publishNow.isPending ? "Sending…" : "Post right now"}
      </Button>
      {reason && <span className={cn("text-xs", chosen.length > 0 && !check.isLoading ? "text-danger" : "text-muted-foreground")}>{reason}</span>}

      <AlertDialog open={confirmNow} onOpenChange={(open) => !publishNow.isPending && setConfirmNow(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post {brandName}’s post now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>
                  This goes out publicly right away for <strong className="text-foreground">{brandName}</strong> on:
                </span>
                <ul className="m-0 list-disc pl-5">
                  {chosenAccounts.map((a) => (
                    <li key={a.id}>{accountLabel(a)}</li>
                  ))}
                </ul>
                <span>It can’t be taken back from here.</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishNow.isPending}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={publishNow.isPending}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the request settles
                publishNow.mutate();
              }}
            >
              {publishNow.isPending ? "Sending…" : "Post now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tile>
  );
}

/** Publish jobs: one row per account, polled while anything is still moving. */
export function JobsPanel({ post }: { post: Post }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const jobs = useQuery({
    queryKey: keys.jobs(post.id),
    queryFn: () => api<Job[]>(`/posts/${post.id}/jobs`),
    // Poll only while a job is due within two minutes or already sending.
    refetchInterval: (q) => {
      const moving = (q.state.data ?? []).some((j) => j.status === "queued" || j.status === "processing");
      const dueSoon = !!post.scheduled_at && new Date(post.scheduled_at).getTime() - Date.now() < 120_000;
      return moving && (dueSoon || post.status === "publishing") ? 5000 : false;
    },
  });
  const cancel = useMutation({
    mutationFn: () => api(`/posts/${post.id}/schedule`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Schedule cancelled. The post is still approved.");
      qc.invalidateQueries({ queryKey: keys.post(post.id) });
      qc.invalidateQueries({ queryKey: keys.jobs(post.id) });
      qc.invalidateQueries({ queryKey: ["ws-posts"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn’t cancel."),
  });

  const retry = useMutation({
    mutationFn: (body: Schemas["RetryRequest"]) =>
      api<Schemas["ScheduleResponse"]>(`/posts/${post.id}/retry`, { method: "POST", body }),
    onSuccess: () => {
      toast.success("Sending again. Results appear here in a few seconds.");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: keys.post(post.id) });
      qc.invalidateQueries({ queryKey: keys.jobs(post.id) });
      qc.invalidateQueries({ queryKey: ["ws-posts"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn’t retry."),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const accountName = (id: string) => {
    const a = accounts.data?.find((x) => x.id === id);
    return a ? `${platformName(a.platform)} · ${a.account_name}` : "Disconnected account";
  };
  const list = jobs.data ?? [];
  const canRetry = post.status === "failed" || post.status === "partially_published";
  const failedJobs = list.filter((j) => j.status === "failed");
  const unknownJobs = list.filter((j) => j.status === "needs_review");

  return (
    <Tile aria-labelledby="jobs-h">
      <TileTitle id="jobs-h">{post.status === "scheduled" ? "Scheduled" : "Publishing"}</TileTitle>
      {post.status === "scheduled" && post.scheduled_at && (
        <p className="m-0">
          Goes out <strong>{formatDateTime(post.scheduled_at)}</strong>.
        </p>
      )}
      {list.length === 0 ? (
        <p className="m-0 text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <ul className="m-0 flex flex-col gap-3 p-0">
          {list.map((j) => {
            const url = (j.result as { url?: string } | null)?.url;
            return (
              <li key={j.id} className="flex list-none flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{accountName(j.social_account_id)}</span>
                  <JobBadge status={j.status} />
                </div>
                {j.error_message && <span className="text-[13px] text-danger">{j.error_message}</span>}
                {j.status === "needs_review" && (
                  <span className="text-[13px] text-warning">We couldn’t confirm the result. Check the page before posting again — this avoids double posts.</span>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-foreground">
                    View post <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
                {j.processed_at && <span className="text-xs text-muted-foreground">{formatDateTime(j.processed_at)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {post.status === "scheduled" && (
        <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          Cancel schedule
        </Button>
      )}

      {/* Retry: definite failures in one click; unknown outcomes only after the user checked. */}
      {canRetry && failedJobs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Button
            onClick={() => retry.mutate({ job_ids: failedJobs.map((j) => j.id), confirm_not_posted: false })}
            disabled={retry.isPending}
          >
            {retry.isPending ? "Sending…" : failedJobs.length === 1 ? "Try again" : `Try again (${failedJobs.length})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Only the failed {failedJobs.length === 1 ? "account is" : "accounts are"} sent again. Accounts that already posted are never sent twice.
          </span>
        </div>
      )}
      {canRetry && unknownJobs.length > 0 && (
        <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={retry.isPending}>
          I checked — it isn’t on the page
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send it again?</AlertDialogTitle>
            <AlertDialogDescription>
              We couldn’t confirm whether this went out on {unknownJobs.map((j) => accountName(j.social_account_id)).join(", ")}.
              Only continue if you opened the page and the post is <strong>not</strong> there — otherwise it will appear twice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => retry.mutate({ job_ids: unknownJobs.map((j) => j.id), confirm_not_posted: true })}
            >
              It’s not there — send again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tile>
  );
}
