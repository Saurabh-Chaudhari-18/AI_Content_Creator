import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileCheck, ShieldCheck, Stamp, Undo2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type Post } from "@/lib/api";
import { deadlineLabel, useReminders, type Reminder } from "@/lib/approvals";
import { formatDateTime } from "@/lib/format";
import { keys, useMembers, type ApprovalLog } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { focusPublishPanel } from "./PublishPanel";
import { ApprovalCertificate, ApprovalSeal, shortHash } from "./Seal";

const ACTION_ORDER: Record<string, number> = { submitted: 0, reassigned: 1, rejected: 2, approved: 2, invalidated: 3 };

/** Statuses in which the latest approval still stands. */
const APPROVAL_HOLDS = ["approved", "scheduled", "publishing", "published", "partially_published", "failed"];

export function usePostHistory(postId: string | undefined) {
  return useQuery({
    queryKey: keys.history(postId),
    queryFn: () => api<ApprovalLog[]>(`/posts/${postId}/history`),
    enabled: !!postId,
  });
}

function Entry({ log, who, currentHash }: { log: ApprovalLog; who: string; currentHash: string | null | undefined }) {
  const hash = log.content_hash_at_action;
  // "on Priya's behalf": someone other than the assigned reviewer decided (D3).
  const onBehalf = log.acted_by_assignee === false && log.assigned_name ? ` on ${log.assigned_name}’s behalf` : "";
  const to = log.assigned_name ? ` to ${log.assigned_name}` : "";
  const look = {
    submitted: { icon: FileCheck, ring: "border-primary/40 bg-info-soft text-info", text: `${who} sent it for approval${to}` },
    approved: { icon: ShieldCheck, ring: "border-success-border bg-success-soft text-success", text: `${who} approved it${onBehalf}` },
    rejected: { icon: Undo2, ring: "border-warning-border bg-warning-soft text-warning", text: `${who} asked for changes${onBehalf}` },
    invalidated: { icon: Undo2, ring: "border-dashed bg-surface-subtle text-muted-foreground", text: "Back to draft after an edit" },
    reassigned: {
      icon: Users,
      ring: "border-dashed bg-surface-subtle text-muted-foreground",
      text: log.assigned_name ? `Reviewer changed to ${log.assigned_name}` : "Reviewer changed to any manager",
    },
  }[log.action] ?? { icon: FileCheck, ring: "bg-surface-subtle text-muted-foreground", text: log.action };
  const isNote = log.action === "reassigned";
  const Icon = look.icon;
  return (
    <li className="relative flex list-none gap-4">
      <span className={cn("relative z-10 grid size-6 flex-none place-items-center rounded-full border", look.ring)}>
        <Icon className="size-3" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="m-0 text-sm">{look.text}</p>
          <time dateTime={log.created_at} className="flex-none font-mono text-xs text-muted-foreground">
            {formatDateTime(log.created_at)}
          </time>
        </div>
        {log.rejection_reason && isNote && <p className="m-0 mt-1 text-xs text-muted-foreground">{log.rejection_reason}</p>}
        {log.rejection_reason && !isNote && (
          <blockquote className="m-0 mt-2 border-l-2 border-warning-border pl-3 text-sm leading-5 text-secondary-foreground">
            {log.rejection_reason}
          </blockquote>
        )}
        {log.action === "submitted" && log.due_at && (
          <p className="m-0 mt-1 text-xs text-muted-foreground">Needed by {deadlineLabel(log.due_at)}</p>
        )}
        {hash && log.action !== "rejected" && !isNote && (
          <p
            className={cn(
              "m-0 mt-1 flex items-center gap-1 font-mono text-xs",
              log.action === "approved" ? "text-success" : log.action === "submitted" ? "text-info" : "text-muted-foreground",
            )}
          >
            <Stamp className="size-3" aria-hidden="true" />
            <span className="num">{shortHash(hash)}</span>
            {log.action === "approved" && hash === currentHash && <span className="font-sans text-muted-foreground">· matches this version</span>}
          </p>
        )}
      </div>
    </li>
  );
}

const CHANNEL_TEXT: Record<string, string> = { whatsapp: "on WhatsApp", email: "by email", copy: "(message copied)" };

/** A deadline reminder: automatic (the system) or a person's nudge. */
function ReminderEntry({ r }: { r: Reminder }) {
  const who = r.recipient_name ?? "the reviewer";
  const text =
    r.stage === "manual_nudge"
      ? `${r.created_by_name ?? "Someone"} reminded ${who} ${CHANNEL_TEXT[r.channel] ?? ""}`.trim()
      : r.stage === "due_soon"
        ? `Reminder: the deadline is near`
        : r.stage === "overdue"
          ? "The deadline passed. The reviewer was reminded"
          : "Still waiting after the deadline. Every manager was told";
  return (
    <li className="relative flex list-none gap-4">
      <span
        className={cn(
          "relative z-10 grid size-6 flex-none place-items-center rounded-full border",
          r.stage === "escalated" || r.stage === "overdue" ? "border-danger-border bg-danger-soft text-danger" : "border-dashed bg-surface-subtle text-muted-foreground",
        )}
      >
        <BellRing className="size-3" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">{text}</p>
        <time dateTime={r.created_at} className="flex-none font-mono text-xs text-muted-foreground">
          {formatDateTime(r.created_at)}
        </time>
      </div>
    </li>
  );
}

/** Who approved what, when — with the seal of the exact content that was reviewed. */
export function ApprovalRecord({
  post,
}: {
  post: Post;
  brandName?: string;
  imageUrl?: string;
}) {
  const history = usePostHistory(post.id);
  const reminders = useReminders(post.id);
  const members = useMembers();
  const [certOpen, setCertOpen] = useState(false);

  // Stamp the seal when the post becomes approved while this screen is open.
  const prevStatus = useRef(post.status);
  const [stamp, setStamp] = useState(false);
  useEffect(() => {
    if (prevStatus.current === "pending_approval" && post.status === "approved") setStamp(true);
    prevStatus.current = post.status;
  }, [post.status]);

  const logs = history.data ?? []; // newest first
  const lastApproval = logs.find((h) => h.action === "approved");
  const sealed = !!lastApproval?.content_hash_at_action && APPROVAL_HOLDS.includes(post.status);
  const waiting = post.status === "pending_approval" && !!post.content_hash;

  if (!logs.length && !waiting) return null;

  const member = (userId: string | null | undefined) => (userId ? members.data?.find((m) => m.user_id === userId) : undefined);
  /** A team member, a client acting through a link, or the system (fall-back). */
  const nameOf = (log: ApprovalLog) => {
    if (log.user_id) return member(log.user_id)?.full_name ?? "Someone";
    if (log.approval_link_id) return `${log.actor_name ?? "The client"} (client, via link)`;
    return log.actor_name ?? "System";
  };
  // One timeline: approval history and reminders, oldest first.
  type Item = { at: string; order: number; node: React.ReactNode };
  const items: Item[] = [
    ...logs.map((log) => ({
      at: log.created_at,
      order: ACTION_ORDER[log.action] ?? 3,
      node: <Entry key={log.id} log={log} who={nameOf(log)} currentHash={post.content_hash} />,
    })),
    ...(reminders.data ?? []).map((r) => ({ at: r.created_at, order: 1, node: <ReminderEntry key={r.id} r={r} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  return (
    <section aria-labelledby="record-h" className="relative rounded-[var(--radius-tile)] border bg-card">
      <div className={cn("flex h-16 flex-col justify-center gap-1 border-b pl-5", sealed || waiting ? "pr-32" : "pr-5")}>
        <h2 id="record-h" className="m-0 text-sm font-medium">Approval record</h2>
        <p className="m-0 text-xs text-muted-foreground">Every step is kept, with the seal of what was reviewed</p>
      </div>

      {sealed && (
        <ApprovalSeal
          hash={lastApproval.content_hash_at_action!}
          version={post.version_number}
          state="approved"
          stamp={stamp}
          className="absolute -top-7 right-4 size-[104px]"
        />
      )}
      {!sealed && waiting && (
        <ApprovalSeal hash={post.content_hash!} version={post.version_number} state="waiting" className="absolute -top-7 right-4 size-[104px]" />
      )}

      <ol className="relative m-0 flex flex-col gap-5 p-5">
        <span aria-hidden="true" className="absolute top-8 bottom-8 left-[32px] w-px bg-border" />
        {items.map((i) => i.node)}
        {post.status === "pending_approval" && (
          <li className="relative flex list-none items-center gap-4">
            <span aria-hidden="true" className="relative z-10 grid size-6 flex-none place-items-center rounded-full border border-dashed bg-card">
              <span className="size-1.5 rounded-full bg-amber-400" />
            </span>
            <p className="m-0 text-sm text-muted-foreground">
              {post.assigned_name ? `Waiting for ${post.assigned_name}. Any manager can approve.` : "Waiting for an owner or manager to approve"}
            </p>
          </li>
        )}
      </ol>

      {sealed && (
        <div className="border-t px-5 py-4">
          <Button variant="outline" size="sm" onClick={() => setCertOpen(true)}>
            <Stamp aria-hidden="true" /> View approval certificate
          </Button>
          <ApprovalCertificate open={certOpen} onOpenChange={setCertOpen} postId={post.id} />
        </div>
      )}
    </section>
  );
}

/** Buttons for the pending-approval state. */
export function ApprovalActions({
  post,
  canApprove,
  canManage,
  approveBlockedReason,
  size = "default",
}: {
  post: Post;
  canApprove: boolean;
  canManage: boolean;
  approveBlockedReason: string | null;
  /** "lg" in the Approval Studio card, where these are the page's main buttons. */
  size?: "default" | "lg";
}) {
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.post(post.id) });
    qc.invalidateQueries({ queryKey: keys.history(post.id) });
    qc.invalidateQueries({ queryKey: ["ws-posts"] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

  const approve = useMutation({
    mutationFn: () => api<Post>(`/posts/${post.id}/approve`, { method: "POST" }),
    onSuccess: () => {
      // The scheduling panel appears once the post refreshes; the action takes the user straight to it.
      toast.success("Approved. It’s ready to schedule.", {
        action: { label: "Schedule now", onClick: () => focusPublishPanel() },
        duration: 10_000,
      });
      refresh();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: () => api<Post>(`/posts/${post.id}/reject`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      toast.success("Sent back with your comments.");
      setRejectOpen(false);
      setReason("");
      refresh();
    },
    onError,
  });
  const withdraw = useMutation({
    mutationFn: () => api<Post>(`/posts/${post.id}/withdraw`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Back to draft. You can edit it now.");
      refresh();
    },
    onError,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!canApprove && approveBlockedReason && <span className="text-[13px] text-muted-foreground">{approveBlockedReason}</span>}
      {canManage && (
        <Button variant="outline" size={size} onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
          <Undo2 aria-hidden="true" /> Withdraw to edit
        </Button>
      )}
      {canApprove && (
        <>
          <Button variant="outline" size={size} onClick={() => setRejectOpen(true)}>
            Request changes
          </Button>
          <Button className="btn-depth" size={size} onClick={() => approve.mutate()} disabled={approve.isPending}>
            <ShieldCheck aria-hidden="true" /> {approve.isPending ? "Approving…" : "Approve"}
          </Button>
        </>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What should change?</DialogTitle>
            <DialogDescription>The author sees this and the post goes back to draft.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-reason">Your comments</Label>
            <Textarea id="reject-reason" rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => reject.mutate()} disabled={!reason.trim() || reject.isPending}>
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
