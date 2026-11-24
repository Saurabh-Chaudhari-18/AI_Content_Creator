import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";

import { InlineLoadError, PageHeader, TileTitle } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { deadlineHourPresets, describeHours, describeMinutes, useDeadlineOptions, useLinkOptions } from "@/lib/approvals";
import { api, ApiError, type UsageSummary, type Workspace } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDate, initials, ROLE_LABEL } from "@/lib/format";
import { keys, useFeatures, useMembers, useMyRole } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

/** The plan items a customer cares about day to day (keys from backend app/core/features.py). */
const PLAN_ITEMS = [
  { key: "facebook_publishing", label: "Posting to Facebook" },
  { key: "instagram_publishing", label: "Posting to Instagram" },
  { key: "linkedin_publishing", label: "Posting to LinkedIn" },
  { key: "scheduling", label: "Scheduling and calendar" },
];

const USAGE_LABEL: Record<string, string> = {
  post_created: "Posts written",
  media_uploaded: "Photos and videos uploaded",
  post_published: "Posts published",
};

export function SettingsPage() {
  const qc = useQueryClient();
  const { user, setEmailNotifications } = useAuth();
  const [savingEmailPref, setSavingEmailPref] = useState(false);
  const { workspace } = useWorkspace();
  const role = useMyRole();
  const isOwner = role === "owner";
  const isAdmin = isOwner || role === "admin";
  const members = useMembers();
  const linkOptions = useLinkOptions();
  const deadlineOptions = useDeadlineOptions();
  const features = useFeatures();
  const location = useLocation();
  // Arriving from a "See your plan" link: show that section.
  useEffect(() => {
    if (location.hash !== "#plan" || !features.data) return;
    document.getElementById("plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, features.data]);

  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
  const updateWorkspace = useMutation({
    mutationFn: (body: {
      name?: string;
      allow_self_approval?: boolean;
      approval_link_default_minutes?: number;
      approval_due_default_hours?: number;
      certificate_verification_enabled?: boolean;
      email_client_reminders?: boolean;
    }) => api<Workspace>(`/workspaces/${workspace!.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Saved.");
      qc.invalidateQueries({ queryKey: keys.workspaces() });
      qc.invalidateQueries({ queryKey: ["approval-link-options"] });
      qc.invalidateQueries({ queryKey: ["approval-deadline-options"] });
    },
    onError,
  });

  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? workspace?.name ?? "";

  // ── Members ──────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");
  const addMember = useMutation({
    mutationFn: () =>
      api<{ message: string }>(`/workspaces/${workspace!.id}/members`, { method: "POST", body: { email: email.trim(), role: newRole } }),
    onSuccess: (r) => {
      toast.success(r.message);
      setEmail("");
      qc.invalidateQueries({ queryKey: keys.members(workspace?.id) });
      qc.invalidateQueries({ queryKey: keys.workspaces() }); // self-approval may have switched off
    },
    onError,
  });
  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) addMember.mutate();
  }

  // ── Usage ────────────────────────────────────────────────────────────
  const usage = useQuery({
    queryKey: keys.usage(workspace?.id),
    queryFn: () => api<UsageSummary>(`/workspaces/${workspace!.id}/usage`, { query: { days: 30 } }),
    enabled: !!workspace,
  });

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader eyebrow="Workspace, team and usage" title="Settings" />
      </div>

      <Tile aria-labelledby="ws-h" className="md:col-span-6">
        <TileTitle id="ws-h">Workspace</TileTitle>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (shownName.trim()) updateWorkspace.mutate({ name: shownName.trim() });
          }}
        >
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" maxLength={255} value={shownName} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} className="h-11" />
          </div>
          {isAdmin && (
            <Button type="submit" variant="outline" disabled={!name || name.trim() === workspace?.name || updateWorkspace.isPending}>
              Save name
            </Button>
          )}
        </form>

        <div className="flex items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="self-approval" className="font-semibold">
              Authors can approve their own posts
            </Label>
            <span className="text-[13px] text-muted-foreground">
              On for one-person businesses. Turns off by itself when a second person joins, so someone else always checks. Only
              the owner can change it.
            </span>
          </div>
          <Switch
            id="self-approval"
            checked={!!workspace?.allow_self_approval}
            disabled={!isOwner || updateWorkspace.isPending}
            onCheckedChange={(v) => updateWorkspace.mutate({ allow_self_approval: v })}
          />
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <Label htmlFor="link-default" className="font-semibold">
              Client links expire after
            </Label>
            <span className="text-[13px] text-muted-foreground">
              The default when you share a post with a client. Members can choose a shorter time, never a longer one. Owners and managers
              can change it.
            </span>
          </div>
          <Select
            value={String(workspace?.approval_link_default_minutes ?? 0)}
            disabled={!isAdmin || updateWorkspace.isPending || !linkOptions.data}
            onValueChange={(v) => updateWorkspace.mutate({ approval_link_default_minutes: Number(v) })}
          >
            <SelectTrigger id="link-default" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Platform default</SelectItem>
              {(linkOptions.data?.presets ?? []).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {describeMinutes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {deadlineOptions.data?.enabled && (
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
              <Label htmlFor="due-default" className="font-semibold">
                Approvals are needed within
              </Label>
              <span className="text-[13px] text-muted-foreground">
                The deadline a post gets when it’s sent for approval. Reviewers are reminded before it, and every manager is told if it
                passes. A brand can set its own; the sender can always pick another.
              </span>
            </div>
            <Select
              value={String(workspace?.approval_due_default_hours ?? 0)}
              disabled={!isAdmin || updateWorkspace.isPending}
              onValueChange={(v) => updateWorkspace.mutate({ approval_due_default_hours: Number(v) })}
            >
              <SelectTrigger id="due-default" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Platform default ({describeHours(deadlineOptions.data.platform_default_hours)})</SelectItem>
                {deadlineHourPresets(deadlineOptions.data).map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {describeHours(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cert-verify" className="font-semibold">
              Anyone can check our approval certificates
            </Label>
            <span className="text-[13px] text-muted-foreground">
              A client or auditor types the certificate number on the verify page and sees that it’s genuine: who approved, when, and the
              fingerprint. Never the post itself. Only the owner can change it.
            </span>
          </div>
          <Switch
            id="cert-verify"
            checked={workspace?.certificate_verification_enabled ?? true}
            disabled={!isOwner || updateWorkspace.isPending}
            onCheckedChange={(v) => updateWorkspace.mutate({ certificate_verification_enabled: v })}
          />
        </div>
      </Tile>

      <Tile aria-labelledby="usage-h" className="md:col-span-6">
        <TileTitle id="usage-h">Last 30 days</TileTitle>
        {usage.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <dl className="m-0 grid grid-cols-3 gap-3">
            {Object.entries(USAGE_LABEL).map(([k, label]) => (
              <div key={k} className="rounded-[12px] bg-muted p-3">
                <dd className="m-0 text-2xl font-semibold">{usage.data?.counts[k] ?? 0}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          {usage.data ? `${formatBytes(usage.data.media_bytes)} of photos and videos uploaded. ` : ""}AI writing arrives in the next
          phase; its usage will show here.
        </p>
      </Tile>

      {/* "See your plan" links from the publish panel and Accounts land here. */}
      <Tile id="plan" aria-labelledby="plan-h" className="scroll-mt-6 md:col-span-12">
        <TileTitle id="plan-h">Your plan{features.data ? `: ${features.data.plan_name}` : ""}</TileTitle>
        {features.isLoading ? (
          <Skeleton className="h-10" />
        ) : features.isError ? (
          <InlineLoadError what="your plan" onRetry={() => void features.refetch()} />
        ) : (
          <ul className="m-0 flex flex-wrap gap-2 p-0">
            {PLAN_ITEMS.map(({ key, label }) => {
              const on = features.data?.features.find((f) => f.key === key)?.enabled ?? false;
              return (
                <li
                  key={key}
                  className={cn(
                    "flex list-none items-center gap-1.5 rounded-full border px-3 py-1 text-[13px]",
                    on ? "border-success-border bg-success-soft text-success" : "bg-muted text-muted-foreground",
                  )}
                >
                  {on ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                  {label}
                  <span className="sr-only">{on ? "included" : "not available right now"}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          Something not ticked is either not in your plan or paused for a while on our side. Posts already scheduled still go out.
        </p>
      </Tile>

      <Tile aria-labelledby="email-h" className="md:col-span-12">
        <TileTitle id="email-h">Email</TileTitle>
        {deadlineOptions.data && !deadlineOptions.data.email_enabled && (
          <p className="m-0 text-[13px] text-muted-foreground">
            Email isn’t available right now (it’s switched off on this server or not part of your plan), so reminders and notices
            arrive in the app only.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email-me" className="font-semibold">
                Email me about approvals
              </Label>
              <span className="text-[13px] text-muted-foreground">
                When a post is sent to you, when its deadline is near, and when it’s overdue. Goes to {user?.email}. This is your own
                setting; the bell in the app keeps working either way.
              </span>
            </div>
            <Switch
              id="email-me"
              checked={user?.email_notifications ?? true}
              disabled={savingEmailPref}
              onCheckedChange={(v) => {
                setSavingEmailPref(true);
                setEmailNotifications(v)
                  .then(() => toast.success(v ? "We’ll email you about approvals." : "No more approval emails for you."))
                  .catch(onError)
                  .finally(() => setSavingEmailPref(false));
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-[12px] bg-muted px-4 py-3.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email-clients" className="font-semibold">
                Remind clients by email automatically
              </Label>
              <span className="text-[13px] text-muted-foreground">
                A client who hasn’t answered gets an email before the deadline and when it passes, with replies going to whoever
                shared the link. Only clients with a saved email and a working link. Each email lets them stop the reminders.
                Owners and managers can change it.
              </span>
            </div>
            <Switch
              id="email-clients"
              checked={!!workspace?.email_client_reminders}
              disabled={!isAdmin || updateWorkspace.isPending || (!deadlineOptions.data?.email_enabled && !workspace?.email_client_reminders)}
              onCheckedChange={(v) => updateWorkspace.mutate({ email_client_reminders: v })}
            />
          </div>
        </div>
      </Tile>

      <Tile aria-labelledby="members-h" className="md:col-span-12">
        <TileTitle id="members-h">Team</TileTitle>
        {members.isLoading ? (
          <Skeleton className="h-24" />
        ) : members.isError ? (
          <p className="m-0 text-danger" role="alert">
            Couldn’t load the team.{" "}
            <button type="button" className="font-semibold underline" onClick={() => members.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <ul className="m-0 flex flex-col p-0">
            {(members.data ?? []).map((m) => (
              <li key={m.id} className="flex list-none flex-wrap items-center gap-3 border-t py-3">
                <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold text-secondary-foreground">
                  {initials(m.full_name)}
                </span>
                <div className="flex min-w-48 flex-1 flex-col">
                  <span className="font-semibold">
                    {m.full_name}
                    {m.user_id === user?.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{m.email}</span>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>
                <span className="w-28 text-right text-xs text-muted-foreground">Joined {formatDate(m.joined_at)}</span>
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <Label htmlFor="m-email">Add someone by email</Label>
              <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="They need an account first" className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-role">Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as "member" | "admin")}>
                <SelectTrigger id="m-role" className="h-11 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  {isOwner && <SelectItem value="admin">Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!email.trim() || addMember.isPending}>
              Add to team
            </Button>
            <p className="m-0 w-full text-xs text-muted-foreground">
              Members write posts. Admins also approve posts and connect accounts. Removing people and changing roles comes next.
            </p>
          </form>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">Ask an owner or admin to add people.</p>
        )}
      </Tile>
    </BentoGrid>
  );
}
