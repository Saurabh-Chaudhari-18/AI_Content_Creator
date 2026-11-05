import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { TileTitle } from "@/components/common";
import { Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type Post } from "@/lib/api";
import { APPROVAL_ACTION, formatDateTime } from "@/lib/format";
import { keys, useMembers, type ApprovalLog } from "@/lib/queries";

/** Who approved what, when — the "Approval evidence" tile. */
export function ApprovalHistory({ post }: { post: Post }) {
  const history = useQuery({
    queryKey: keys.history(post.id),
    queryFn: () => api<ApprovalLog[]>(`/posts/${post.id}/history`),
  });
  const members = useMembers();
  const nameOf = (id: string) => members.data?.find((m) => m.user_id === id)?.full_name ?? "Someone";

  const lastApproval = history.data?.find((h) => h.action === "approved");
  const approvalStillValid = lastApproval && ["approved", "scheduled", "publishing", "published", "partially_published", "failed"].includes(post.status);
  // History is newest-first. A draft whose latest event is a rejection must show
  // the reviewer's comments — otherwise the author can't see what to fix.
  const latest = history.data?.[0];
  const changesRequested = post.status === "draft" && latest?.action === "rejected";

  if (post.status === "draft" && !changesRequested) {
    return null; // nothing useful to say about a fresh draft
  }

  if (changesRequested) {
    return (
      <Tile tone="warning" aria-labelledby="approval-h">
        <TileTitle id="approval-h">Changes requested</TileTitle>
        <p className="m-0">
          <strong>{nameOf(latest.user_id)}</strong> asked for changes on {formatDateTime(latest.created_at)}:
        </p>
        {latest.rejection_reason && <blockquote className="m-0 border-l-2 border-current pl-3 italic">{latest.rejection_reason}</blockquote>}
        <p className="m-0 text-[13px]">Edit the post, save, then send it for approval again.</p>
      </Tile>
    );
  }

  return (
    <Tile tone={approvalStillValid ? "info" : "default"} aria-labelledby="approval-h">
      <TileTitle id="approval-h">Who approved this?</TileTitle>
      {approvalStillValid ? (
        <p className="m-0">
          <strong>{nameOf(lastApproval.user_id)}</strong> approved this exact version on {formatDateTime(lastApproval.created_at)}.
          If anyone changes it, it needs approval again.
        </p>
      ) : (
        <p className="m-0 text-muted-foreground">Not approved yet.</p>
      )}
      {approvalStillValid && lastApproval.content_hash_at_action && (
        <p className="m-0 text-xs">
          Proof code <span className="font-mono">{lastApproval.content_hash_at_action.slice(0, 4)} {lastApproval.content_hash_at_action.slice(4, 8)} … {lastApproval.content_hash_at_action.slice(-4)}</span>
        </p>
      )}
      {(history.data?.length ?? 0) > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium">Full history ({history.data!.length})</summary>
          <ol className="mt-2 flex flex-col gap-2 pl-0">
            {history.data!.map((h) => (
              <li key={h.id} className="list-none">
                <span className="font-medium">{APPROVAL_ACTION[h.action] ?? h.action}</span> · {nameOf(h.user_id)} ·{" "}
                <span className="opacity-80">{formatDateTime(h.created_at)}</span>
                {h.rejection_reason && <span className="block opacity-80">“{h.rejection_reason}”</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Tile>
  );
}

/** Buttons for the pending-approval state. */
export function ApprovalActions({
  post,
  canApprove,
  canManage,
  approveBlockedReason,
}: {
  post: Post;
  canApprove: boolean;
  canManage: boolean;
  approveBlockedReason: string | null;
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
      toast.success("Approved. It’s ready to schedule.");
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
      {canApprove && (
        <>
          <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button variant="outline" onClick={() => setRejectOpen(true)}>
            Request changes
          </Button>
        </>
      )}
      {!canApprove && approveBlockedReason && <span className="text-[13px] text-muted-foreground">{approveBlockedReason}</span>}
      {canManage && (
        <Button variant="ghost" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
          Withdraw to edit
        </Button>
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
