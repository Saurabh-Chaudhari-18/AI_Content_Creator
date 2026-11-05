import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { JobBadge, TileTitle } from "@/components/common";
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
import { api, ApiError, type Post, type Schemas } from "@/lib/api";
import { formatDateTime, platformName, timeZoneLabel, toLocalInputValue, viewerTimeZone } from "@/lib/format";
import { keys, useAccounts, type Job, type Validation } from "@/lib/queries";

function tomorrowAt10(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInputValue(d);
}

/** "Where should it go?" — accounts, live pre-publish check, schedule / post now. */
export function PublishPanel({ post }: { post: Post }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [when, setWhen] = useState(tomorrowAt10);

  const active = useMemo(() => (accounts.data ?? []).filter((a) => a.is_active), [accounts.data]);
  // Default: every active account is ticked.
  const chosen = selected ?? active.map((a) => a.id);

  const check = useQuery({
    queryKey: ["validate", post.id, post.version_number, [...chosen].sort().join(",")],
    queryFn: () => api<Validation>(`/posts/${post.id}/validate`, { method: "POST", body: { social_account_ids: chosen } }),
    enabled: chosen.length > 0,
  });
  const resultFor = (id: string) => check.data?.results.find((r) => r.social_account_id === id);
  const blocked = !check.data?.ok;

  const done = (msg: string) => {
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
    onSuccess: () => done("Sending now. Results appear below in a few seconds."),
    onError,
  });

  if (accounts.isSuccess && active.length === 0) {
    return (
      <Tile aria-labelledby="where-h">
        <TileTitle id="where-h">Where should it go?</TileTitle>
        <p className="m-0 text-muted-foreground">No social accounts are connected yet.</p>
        <Link to="/accounts" className="font-semibold text-accent-foreground">
          Connect an account
        </Link>
      </Tile>
    );
  }

  const inPast = new Date(when).getTime() <= Date.now();

  return (
    <Tile aria-labelledby="where-h">
      <TileTitle id="where-h">Where should it go?</TileTitle>
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="sr-only">Accounts</legend>
        {active.map((a) => {
          const r = resultFor(a.id);
          const on = chosen.includes(a.id);
          return (
            <div key={a.id} className="border-b py-2 last:border-b-0">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-[18px] accent-[var(--primary)]"
                  checked={on}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...chosen, a.id] : chosen.filter((id) => id !== a.id))
                  }
                />
                <span className="flex-1">
                  {platformName(a.platform)} · {a.account_name}
                </span>
                {on && r && (
                  <span className={`flex items-center gap-1 text-xs font-semibold ${r.ok ? (r.warnings.length ? "text-warning" : "text-success") : "text-danger"}`}>
                    {r.ok ? r.warnings.length ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
                    {r.ok ? (r.warnings.length ? "Check note" : "Looks good") : "Needs a fix"}
                  </span>
                )}
              </label>
              {on && r && (r.errors.length > 0 || r.warnings.filter((w) => !w.includes("must be approved")).length > 0) && (
                <ul className="m-0 mb-1 ml-8 flex list-disc flex-col gap-0.5 pl-4 text-[13px]">
                  {r.errors.map((e) => (
                    <li key={e} className="text-danger">{e}</li>
                  ))}
                  {r.warnings.filter((w) => !w.includes("must be approved")).map((w) => (
                    <li key={w} className="text-warning">{w}</li>
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
      </div>

      <Button
        size="lg"
        className="mt-1 h-11"
        disabled={chosen.length === 0 || blocked || inPast || schedule.isPending}
        onClick={() => schedule.mutate()}
      >
        {schedule.isPending ? "Scheduling…" : "Schedule post"}
      </Button>
      <Button
        variant="outline"
        disabled={chosen.length === 0 || blocked || publishNow.isPending}
        onClick={() => publishNow.mutate()}
      >
        {publishNow.isPending ? "Sending…" : "Post right now"}
      </Button>
      {inPast && <span className="text-xs text-danger">Pick a time in the future.</span>}
      {chosen.length > 0 && blocked && check.isSuccess && (
        <span className="text-xs text-danger">Fix the problems above, or untick that account.</span>
      )}
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
