import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader, TileTitle } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, ApiError, type UsageSummary, type Workspace } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDate, initials, ROLE_LABEL } from "@/lib/format";
import { keys, useMembers, useMyRole } from "@/lib/queries";
import { useWorkspace } from "@/lib/workspace";

const USAGE_LABEL: Record<string, string> = {
  post_created: "Posts written",
  media_uploaded: "Photos and videos uploaded",
  post_published: "Posts published",
};

export function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const role = useMyRole();
  const isOwner = role === "owner";
  const isAdmin = isOwner || role === "admin";
  const members = useMembers();

  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
  const updateWorkspace = useMutation({
    mutationFn: (body: { name?: string; allow_self_approval?: boolean }) =>
      api<Workspace>(`/workspaces/${workspace!.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Saved.");
      qc.invalidateQueries({ queryKey: keys.workspaces() });
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
      </Tile>

      <Tile aria-labelledby="usage-h" className="md:col-span-6">
        <TileTitle id="usage-h">Last 30 days</TileTitle>
        {usage.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <dl className="m-0 grid grid-cols-3 gap-3">
            {Object.entries(USAGE_LABEL).map(([k, label]) => (
              <div key={k} className="rounded-[12px] bg-muted p-3">
                <dd className="m-0 text-2xl font-bold">{usage.data?.counts[k] ?? 0}</dd>
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

      <Tile aria-labelledby="members-h" className="md:col-span-12">
        <TileTitle id="members-h">Team</TileTitle>
        {members.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="m-0 flex flex-col p-0">
            {members.data!.map((m) => (
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
