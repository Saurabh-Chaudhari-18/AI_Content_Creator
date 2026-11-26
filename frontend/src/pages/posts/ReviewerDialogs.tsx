/**
 * "Who should approve this?" — the reviewer picker (managers + saved client
 * contacts), the share step for client links (WhatsApp / email / copy), and
 * the Client links panel on a pending post.
 * Plan: docs/client_approval_link_plan.md §5.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Copy, Link2, Mail, MessageCircle, RotateCw, Send, UserRound, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError, type Post } from "@/lib/api";
import {
  approvalKeys,
  browserZone,
  deadlineLabel,
  deadlineKeys,
  describeMinutes,
  duePresets,
  dueState,
  reminderMailto,
  reminderMessage,
  useDeadlineOptions,
  LINK_STATUS,
  mailtoHref,
  shareMessage,
  timeLeft,
  useApprovalLinks,
  useApprovers,
  useLinkOptions,
  whatsappHref,
  type ApprovalLinkRow,
  type NewLink,
  type ReviewerPick,
  type SubmitResult,
} from "@/lib/approvals";
import { TONE_CLASS, TONE_DOT, ROLE_LABEL } from "@/lib/format";
import { keys, useMyRole } from "@/lib/queries";
import { cn } from "@/lib/utils";

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

function useRefreshPost(postId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.post(postId) });
    qc.invalidateQueries({ queryKey: keys.history(postId) });
    qc.invalidateQueries({ queryKey: approvalKeys.links(postId) });
    qc.invalidateQueries({ queryKey: approvalKeys.approvers(postId) });
    qc.invalidateQueries({ queryKey: ["ws-posts"] });
  };
}

// ── Expiry picker ──────────────────────────────────────────────────────
function ExpirySelect({ value, onChange }: { value: number | undefined; onChange: (m: number) => void }) {
  const options = useLinkOptions();
  // Nothing chosen = the workspace default (the API applies the same default).
  const shown = value ?? options.data?.default_minutes;
  const choices = useMemo(() => {
    const set = new Set(options.data?.presets ?? []);
    if (options.data) set.add(options.data.default_minutes);
    return [...set].filter((m) => !options.data || m <= options.data.max_for_you).sort((a, b) => a - b);
  }, [options.data]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="link-expiry">Link expires in</Label>
      <Select key={shown === undefined ? "loading" : "ready"} value={shown ? String(shown) : undefined} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id="link-expiry" className="w-full sm:w-56">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {describeMinutes(m)}
              {options.data?.default_minutes === m ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── "Needed by" (approval deadline) ────────────────────────────────────
/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type DueChoice = { key: string; custom: string };

/** The deadline the choice stands for, or null for "the default" (the API applies it). */
function resolveDue(choice: DueChoice, presets: { key: string; at: Date }[]): Date | null {
  if (choice.key === "default") return null;
  if (choice.key === "custom") return choice.custom ? new Date(choice.custom) : null;
  return presets.find((p) => p.key === choice.key)?.at ?? null;
}

function NeededBySelect({
  brandId,
  choice,
  onChange,
  forClient,
  linkMinutes,
}: {
  brandId: string;
  choice: DueChoice;
  onChange: (c: DueChoice) => void;
  forClient: boolean;
  linkMinutes?: number;
}) {
  const options = useDeadlineOptions(brandId);
  const linkOptions = useLinkOptions();
  const data = options.data;
  // Recomputed per render: "Today, 6 pm" must not go stale while the dialog is open.
  const presets = data ? duePresets(data) : [];
  if (!data?.enabled) return null;

  const due = resolveDue(choice, presets) ?? new Date(Date.now() + data.default_hours * 3_600_000);
  const minutes = linkMinutes ?? linkOptions.data?.default_minutes;
  const linkEnds = forClient && minutes !== undefined ? Date.now() + minutes * 60_000 : null;
  const now = new Date();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="needed-by">Needed by</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={choice.key} onValueChange={(key) => onChange({ ...choice, key })}>
          <SelectTrigger id="needed-by" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Pick a date and time…</SelectItem>
          </SelectContent>
        </Select>
        {choice.key === "custom" && (
          <Input
            type="datetime-local"
            aria-label="Deadline date and time"
            className="w-full sm:w-auto"
            min={toLocalInput(new Date(now.getTime() + data.min_hours * 3_600_000))}
            max={toLocalInput(new Date(now.getTime() + data.max_hours * 3_600_000))}
            value={choice.custom}
            onChange={(e) => onChange({ ...choice, custom: e.target.value })}
          />
        )}
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        By <span className="text-foreground">{deadlineLabel(due.toISOString())}</span>. We remind the reviewer before it, and tell every manager if it
        passes.
      </p>
      {linkEnds !== null && linkEnds < due.getTime() && (
        <p className="m-0 text-xs text-warning">The client’s link expires before this deadline. Choose a longer link or an earlier deadline.</p>
      )}
    </div>
  );
}

// ── The picker ─────────────────────────────────────────────────────────
function Option({
  checked,
  onSelect,
  title,
  detail,
  icon: Icon,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail?: string | null;
  icon: typeof UserRound;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "border-primary bg-primary/5" : "bg-card",
      )}
    >
      <Icon className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span aria-hidden="true" className={cn("grid size-4 flex-none place-items-center rounded-full border", checked && "border-primary bg-primary text-primary-foreground")}>
        {checked && <Check className="size-3" />}
      </span>
    </button>
  );
}

function ReviewerPicker({ postId, pick, onPick }: { postId: string; pick: ReviewerPick | null; onPick: (p: ReviewerPick) => void }) {
  const approvers = useApprovers(postId);
  const data = approvers.data;

  // Pre-select the previous reviewer (D11) once, or "any manager".
  useEffect(() => {
    if (pick || !data) return;
    if (data.suggested) onPick({ kind: data.suggested.kind, id: data.suggested.id, name: data.suggested.name });
    else onPick({ kind: "any" });
  }, [data, pick, onPick]);

  if (approvers.isLoading) return <p className="text-sm text-muted-foreground">Loading reviewers…</p>;
  if (approvers.isError || !data) return <p className="text-sm text-danger">Couldn’t load reviewers. {errorText(approvers.error)}</p>;

  const is = (kind: ReviewerPick["kind"], id?: string) => pick?.kind === kind && (kind === "any" || (pick as { id: string }).id === id);
  return (
    <div className="flex flex-col gap-4" role="radiogroup" aria-label="Who should approve this?">
      {data.suggested && (
        <p className="m-0 text-xs text-muted-foreground">Selected: the person who reviewed it last. You can pick someone else.</p>
      )}
      {data.suggestion_note && <p className="m-0 text-xs text-warning">{data.suggestion_note}</p>}
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-xs font-medium text-muted-foreground">Managers</h3>
        {data.managers.map((m) => (
          <Option
            key={m.user_id}
            icon={UserRound}
            checked={is("manager", m.user_id)}
            onSelect={() => onPick({ kind: "manager", id: m.user_id, name: m.name })}
            title={m.name}
            detail={ROLE_LABEL[m.role] ?? m.role}
          />
        ))}
        <Option icon={Users} checked={is("any")} onSelect={() => onPick({ kind: "any" })} title="Any manager" detail="Nobody in particular. Any owner or manager can approve." />
      </div>
      {data.client_links_enabled && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-xs font-medium text-muted-foreground">Clients for this brand</h3>
          {data.contacts.length === 0 && (
            <p className="m-0 text-xs text-muted-foreground">
              No client contacts saved yet.{data.can_add_contacts ? " Add them on the Brands page." : " Ask an owner or manager to add them on the Brands page."}
            </p>
          )}
          {data.contacts.map((c) => (
            <Option
              key={c.contact_id}
              icon={Send}
              checked={is("contact", c.contact_id)}
              onSelect={() => onPick({ kind: "contact", id: c.contact_id, name: c.name })}
              title={c.name}
              detail={[c.role_label, c.phone ?? c.email].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Share step (the link is shown once) ────────────────────────────────
export function LinkShareView({ link, brandName }: { link: NewLink; brandName: string }) {
  const [copied, setCopied] = useState(false);
  const text = shareMessage(link, brandName);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn’t copy. Select the link and copy it yourself.");
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm">
        Send this to <span className="font-medium">{link.recipient_name}</span>. It works for {describeMinutes(link.expiry_minutes)}, until{" "}
        <span className="font-medium">{deadlineLabel(link.expires_at)}</span>.
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={link.url} aria-label="Approval link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" onClick={copy} aria-label="Copy link">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild className="btn-depth">
          <a href={whatsappHref(text, link.recipient_phone)} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" /> Share on WhatsApp
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={mailtoHref(text, brandName, link.recipient_email)}>
            <Mail aria-hidden="true" /> Email
          </a>
        </Button>
      </div>
      <p className="m-0 rounded-lg border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
        This link is shown only once. If you lose it, revoke it and share a new one.
      </p>
    </div>
  );
}

// ── Submit / reassign dialog ───────────────────────────────────────────
export function ReviewerDialog({
  post,
  brandName,
  mode,
  open,
  onOpenChange,
}: {
  post: Post;
  brandName: string;
  mode: "submit" | "reassign";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshPost(post.id);
  const [pick, setPick] = useState<ReviewerPick | null>(null);
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [due, setDue] = useState<DueChoice>({ key: "default", custom: "" });
  const [link, setLink] = useState<NewLink | null>(null);
  const deadlineOptions = useDeadlineOptions(post.brand_id);

  useEffect(() => {
    if (!open) {
      setPick(null);
      setMinutes(undefined);
      setDue({ key: "default", custom: "" });
      setLink(null);
    }
  }, [open]);

  const dueAt = mode === "submit" && deadlineOptions.data?.enabled ? resolveDue(due, duePresets(deadlineOptions.data)) : null;
  const customMissing = mode === "submit" && due.key === "custom" && !due.custom;

  const send = useMutation({
    mutationFn: () => {
      const body = {
        assign_to_user_id: pick?.kind === "manager" ? pick.id : null,
        assign_to_contact_id: pick?.kind === "contact" ? pick.id : null,
        expires_in_minutes: pick?.kind === "contact" ? minutes ?? null : null,
        ...(mode === "submit" ? { due_at: dueAt ? dueAt.toISOString() : null, due_tz: browserZone() ?? null } : {}),
      };
      return mode === "submit"
        ? api<SubmitResult>(`/posts/${post.id}/submit`, { method: "POST", body })
        : api<SubmitResult>(`/posts/${post.id}/assignee`, { method: "PATCH", body });
    },
    onSuccess: (res) => {
      refresh();
      if (res.approval_link) {
        setLink(res.approval_link);
        return;
      }
      toast.success(
        pick?.kind === "manager"
          ? `${mode === "submit" ? "Sent" : "Reassigned"} to ${pick.name}. They’ll see it in their approvals.`
          : mode === "submit"
            ? "Sent for approval. Any manager can approve it."
            : "Now open to any manager.",
      );
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Send the link to {link.recipient_name}</DialogTitle>
              <DialogDescription>They can approve or ask for changes on their phone, without an account.</DialogDescription>
            </DialogHeader>
            <LinkShareView link={link} brandName={brandName} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{mode === "submit" ? "Who should approve this?" : "Change the reviewer"}</DialogTitle>
              <DialogDescription>
                {mode === "submit"
                  ? "The post locks while it waits, so the reviewer sees exactly what will be posted. Any manager can still approve it."
                  : "Any manager can still approve it, whoever it’s assigned to."}
              </DialogDescription>
            </DialogHeader>
            <ReviewerPicker postId={post.id} pick={pick} onPick={setPick} />
            {pick?.kind === "contact" && <ExpirySelect value={minutes} onChange={setMinutes} />}
            {mode === "submit" && (
              <NeededBySelect brandId={post.brand_id} choice={due} onChange={setDue} forClient={pick?.kind === "contact"} linkMinutes={minutes} />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button className="btn-depth" disabled={!pick || customMissing || send.isPending} onClick={() => send.mutate()}>
                <Send aria-hidden="true" />
                {send.isPending
                  ? "Sending…"
                  : pick?.kind === "contact"
                    ? `Create link for ${pick.name.split(" ")[0]}`
                    : pick?.kind === "manager"
                      ? `Send to ${pick.name.split(" ")[0]}`
                      : mode === "submit"
                        ? "Send for approval"
                        : "Open to any manager"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Share an extra link (pending posts) ────────────────────────────────
export function ShareWithClientDialog({
  post,
  brandName,
  open,
  onOpenChange,
}: {
  post: Post;
  brandName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshPost(post.id);
  const role = useMyRole();
  const isManager = role === "owner" || role === "admin";
  const approvers = useApprovers(post.id, open);
  const [contactId, setContactId] = useState<string>("");
  const [name, setName] = useState("");
  const [reach, setReach] = useState("");
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [link, setLink] = useState<NewLink | null>(null);
  const typed = contactId === "__typed";

  useEffect(() => {
    if (!open) {
      setContactId("");
      setName("");
      setReach("");
      setMinutes(undefined);
      setLink(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api<NewLink>(`/posts/${post.id}/approval-links`, {
        method: "POST",
        body: typed
          ? { recipient_name: name.trim(), recipient_contact: reach.trim() || null, expires_in_minutes: minutes ?? null }
          : { contact_id: contactId, expires_in_minutes: minutes ?? null },
      }),
    onSuccess: (l) => {
      setLink(l);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const contacts = approvers.data?.contacts ?? [];
  const ready = typed ? name.trim().length > 0 : !!contactId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Send the link to {link.recipient_name}</DialogTitle>
              <DialogDescription>The first answer from anyone decides the post.</DialogDescription>
            </DialogHeader>
            <LinkShareView link={link} brandName={brandName} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Share with a client</DialogTitle>
              <DialogDescription>They get a link to approve or ask for changes. No account needed.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-contact">Client</Label>
              <Select value={contactId || undefined} onValueChange={setContactId}>
                <SelectTrigger id="share-contact" className="w-full">
                  <SelectValue placeholder={contacts.length ? "Choose a saved contact" : "No saved contacts"} />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.contact_id} value={c.contact_id}>
                      {c.name}
                      {c.role_label ? ` · ${c.role_label}` : ""}
                    </SelectItem>
                  ))}
                  {isManager && <SelectItem value="__typed">Someone else…</SelectItem>}
                </SelectContent>
              </Select>
              {!isManager && <p className="m-0 text-xs text-muted-foreground">Members can share with the brand’s saved contacts only.</p>}
            </div>
            {typed && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-name">Name</Label>
                  <Input id="share-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-reach">Phone or email (optional)</Label>
                  <Input id="share-reach" maxLength={255} value={reach} onChange={(e) => setReach(e.target.value)} placeholder="+91 98765 43210" />
                </div>
              </div>
            )}
            <ExpirySelect value={minutes} onChange={setMinutes} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button className="btn-depth" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
                <Link2 aria-hidden="true" /> {create.isPending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Deadline chip and reminders ────────────────────────────────────────
/** "Due in 5 h" / "Overdue by 2 days" — pending posts only. */
export function DueChip({ post, className }: { post: Post; className?: string }) {
  if (post.status !== "pending_approval" || !post.approval_due_at) return null;
  const s = dueState(post.approval_due_at);
  return (
    <span
      title={`Needed by ${deadlineLabel(post.approval_due_at)}`}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[s.tone], className)}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[s.tone])} />
      {s.label}
    </span>
  );
}

/** Nudge a client from your own WhatsApp or email; we record that it was sent. */
function SendReminderDialog({
  post,
  brandName,
  links,
  open,
  onOpenChange,
}: {
  post: Post;
  brandName: string;
  links: ApprovalLinkRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const approvers = useApprovers(post.id, open);
  const contact = approvers.data?.contacts.find((c) => c.contact_id === post.assigned_contact_id);
  const name = post.assigned_name ?? contact?.name ?? "there";
  const theirs = links.filter((l) => l.contact_id === post.assigned_contact_id);
  const live = theirs.find((l) => l.status === "not_opened" || l.status === "opened");
  const text = reminderMessage({
    name,
    postTitle: post.title || "Untitled post",
    brandName,
    dueAt: post.approval_due_at,
    sentAt: live?.created_at,
  });
  const linkEndsFirst = live && post.approval_due_at && new Date(live.expires_at) < new Date(post.approval_due_at);

  const record = useMutation({
    mutationFn: (channel: "whatsapp" | "email" | "copy") =>
      api(`/posts/${post.id}/reminders`, { method: "POST", body: { channel } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deadlineKeys.reminders(post.id) });
      toast.success(`Reminder to ${name} recorded on the post.`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      record.mutate("copy");
    } catch {
      toast.error("Couldn’t copy. Select the text and copy it yourself.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remind {name}</DialogTitle>
          <DialogDescription>It goes from your own WhatsApp or email. We note on the post that you sent it.</DialogDescription>
        </DialogHeader>
        {!live ? (
          <p className="m-0 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
            {name} has no working link right now. Use <span className="font-medium">Resend</span> under Client links to send a fresh one.
          </p>
        ) : (
          <>
            <p className="m-0 rounded-lg border bg-surface-subtle px-3 py-2.5 text-sm whitespace-pre-line">{text}</p>
            {linkEndsFirst && (
              <p className="m-0 text-xs text-warning">Their link expires before the deadline. You may want to resend it with a longer life.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <Button asChild className="btn-depth">
                <a href={whatsappHref(text, contact?.phone)} target="_blank" rel="noopener noreferrer" onClick={() => record.mutate("whatsapp")}>
                  <MessageCircle aria-hidden="true" /> WhatsApp
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={reminderMailto(text, brandName, contact?.email)} onClick={() => record.mutate("email")}>
                  <Mail aria-hidden="true" /> Email
                </a>
              </Button>
              <Button variant="outline" onClick={copy}>
                <Copy aria-hidden="true" /> Copy text
              </Button>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Client links panel (pending posts) ─────────────────────────────────
function LinkStatusChip({ status }: { status: string }) {
  const s = LINK_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[s.tone])}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[s.tone])} />
      {s.label}
    </span>
  );
}

function LinkRow({ row, brandName, onResent }: { row: ApprovalLinkRow; brandName: string; onResent: (l: NewLink) => void }) {
  const refresh = useRefreshPost(row.post_id);
  const revoke = useMutation({
    mutationFn: () => api(`/approval-links/${row.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Link revoked. It no longer works.");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const resend = useMutation({
    mutationFn: () => api<NewLink>(`/approval-links/${row.id}/resend`, { method: "POST" }),
    onSuccess: (l) => {
      refresh();
      onResent(l);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const live = row.status === "not_opened" || row.status === "opened";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <span className="min-w-[7rem] flex-1 basis-28 truncate text-sm">{row.recipient_name}</span>
      <LinkStatusChip status={row.status} />
      {row.status === "opened" && <span className="text-xs text-muted-foreground">{row.view_count}×</span>}
      {live && (
        <span className="text-xs text-muted-foreground" title={deadlineLabel(row.expires_at)}>
          expires {timeLeft(row.expires_at)}
        </span>
      )}
      {live && (
        <Button size="sm" variant="ghost" onClick={() => revoke.mutate()} disabled={revoke.isPending} aria-label={`Revoke ${row.recipient_name}'s link`}>
          <X aria-hidden="true" /> Revoke
        </Button>
      )}
      {row.can_resend && (
        <Button size="sm" variant="outline" onClick={() => resend.mutate()} disabled={resend.isPending}>
          <RotateCw aria-hidden="true" /> Resend
        </Button>
      )}
      <span className="sr-only">{brandName}</span>
    </li>
  );
}

/** Assigned reviewer + client links, shown while a post waits for approval. */
export function ReviewPanel({ post, brandName, canManage }: { post: Post; brandName: string; canManage: boolean }) {
  const pending = post.status === "pending_approval";
  const links = useApprovalLinks(post.id, { poll: pending });
  const qc = useQueryClient();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [resent, setResent] = useState<NewLink | null>(null);

  // A client may answer while this screen is open: refresh the post with the links.
  const decided = links.data?.some((l) => l.status === "approved" || l.status === "changes_requested");
  useEffect(() => {
    if (decided) {
      qc.invalidateQueries({ queryKey: keys.post(post.id) });
      qc.invalidateQueries({ queryKey: keys.history(post.id) });
    }
  }, [decided, qc, post.id]);

  const rows = links.data ?? [];
  if (!pending && rows.length === 0) return null;
  return (
    <section aria-labelledby="review-h" className="rounded-[var(--radius-tile)] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 id="review-h" className="m-0 text-sm font-medium">
            Review
          </h2>
          {pending && (
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              {post.assigned_name ? (
                <>
                  Assigned to <span className="text-foreground">{post.assigned_name}</span>. Any manager can still approve.
                </>
              ) : (
                "Open to any manager."
              )}
            </p>
          )}
          {pending && post.approval_due_at && (
            <p className="m-0 mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Needed by <span className="text-foreground">{deadlineLabel(post.approval_due_at)}</span>
              <DueChip post={post} />
            </p>
          )}
        </div>
        {pending && canManage && (
          <div className="flex flex-wrap gap-2">
            {post.assigned_contact_id && post.approval_due_at && (
              <Button size="sm" variant="outline" onClick={() => setRemindOpen(true)}>
                <BellRing aria-hidden="true" /> Send reminder
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
              Change reviewer
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
              <Link2 aria-hidden="true" /> Share with client
            </Button>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="px-5 py-2">
          <h3 className="m-0 pt-2 text-xs font-medium text-muted-foreground">Client links</h3>
          <ul className="m-0 divide-y p-0">
            {rows.map((r) => (
              <LinkRow key={r.id} row={r} brandName={brandName} onResent={setResent} />
            ))}
          </ul>
        </div>
      )}
      <ReviewerDialog post={post} brandName={brandName} mode="reassign" open={reassignOpen} onOpenChange={setReassignOpen} />
      <ShareWithClientDialog post={post} brandName={brandName} open={shareOpen} onOpenChange={setShareOpen} />
      <SendReminderDialog post={post} brandName={brandName} links={rows} open={remindOpen} onOpenChange={setRemindOpen} />
      <Dialog open={!!resent} onOpenChange={(o) => !o && setResent(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New link for {resent?.recipient_name}</DialogTitle>
            <DialogDescription>The old link no longer works.</DialogDescription>
          </DialogHeader>
          {resent && <LinkShareView link={resent} brandName={brandName} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResent(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
