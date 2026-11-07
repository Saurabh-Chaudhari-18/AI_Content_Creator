import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmptyState, PageHeader, TileTitle } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Schemas, type SocialAccount } from "@/lib/api";
import { daysUntil, formatDateTime, PLATFORMS, platformName } from "@/lib/format";
import { keys, useAccounts, useMyRole, useWorkspacePosts } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PlatformMark } from "@/pages/posts/parts";
import { useWorkspace } from "@/lib/workspace";

function health(a: SocialAccount): { label: string; tone: "success" | "warning" | "danger" | "neutral"; days: number | null } {
  const days = daysUntil(a.token_expires_at);
  if (days !== null && days <= 0) return { label: "Expired", tone: "danger", days };
  if (a.needs_reauth || (days !== null && days <= 7)) return { label: "Refresh soon", tone: "warning", days };
  return { label: "Working", tone: "success", days };
}

export function AccountsPage() {
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const role = useMyRole();
  const isAdmin = role === "owner" || role === "admin";
  const accounts = useAccounts();
  const failed = useWorkspacePosts({ status: "failed", limit: 3 });
  const [params, setParams] = useSearchParams();

  // Facebook's OAuth callback lands here with ?connected=N or ?connected=0&reason=…
  useEffect(() => {
    const connected = params.get("connected");
    if (connected === null) return;
    const n = Number(connected);
    if (n > 0) toast.success(`Connected ${n} account${n === 1 ? "" : "s"}.`);
    else
      toast.error(
        params.get("reason") === "denied"
          ? "Facebook connection was cancelled."
          : "We couldn’t finish connecting Facebook. Please try again.",
      );
    qc.invalidateQueries({ queryKey: keys.accounts(workspace?.id) });
    setParams({}, { replace: true });
  }, [params, setParams, qc, workspace?.id]);

  const connectFacebook = useMutation({
    mutationFn: () =>
      api<Schemas["ConnectStartResponse"]>(`/social/workspaces/${workspace!.id}/connect/facebook`, { method: "POST" }),
    onSuccess: (r) => {
      window.location.href = r.authorization_url;
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 503
          ? "Facebook isn’t set up on this server yet. Use a test account for now."
          : e instanceof ApiError
            ? e.message
            : "Couldn’t start the connection.",
      ),
  });

  const [toRemove, setToRemove] = useState<SocialAccount | null>(null);
  const disconnect = useMutation({
    mutationFn: (id: string) => api(`/social/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Disconnected.");
      qc.invalidateQueries({ queryKey: keys.accounts(workspace?.id) });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn’t disconnect."),
  });

  const [mockOpen, setMockOpen] = useState(false);

  return (
    <BentoGrid>
      <Tile className="flex-row flex-wrap items-center justify-between gap-4 md:col-span-12">
        <PageHeader
          eyebrow="Posts go out through these"
          title="Your social accounts"
          actions={
            isAdmin ? (
              <>
                <Button onClick={() => connectFacebook.mutate()} disabled={connectFacebook.isPending}>
                  Connect Facebook &amp; Instagram
                </Button>
                <Button variant="outline" onClick={() => setMockOpen(true)}>
                  Add a test account
                </Button>
              </>
            ) : (
              <span className="text-[13px] text-muted-foreground">Only owners and admins can connect accounts.</span>
            )
          }
        />
      </Tile>

      {accounts.isLoading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 md:col-span-4" />)
      ) : (accounts.data ?? []).length === 0 ? (
        <div className="md:col-span-12">
          <EmptyState title="No accounts connected">
            Connect a Facebook page (its Instagram business account comes with it). While you’re testing, add a test account — nothing
            is really posted.
          </EmptyState>
        </div>
      ) : (
        accounts.data!.map((a) => {
          const h = health(a);
          const isTest = a.platform_account_id.startsWith("mock") || a.account_type === "test";
          const pct = h.days === null ? 100 : Math.max(4, Math.min(100, Math.round((h.days / 60) * 100)));
          return (
            <Tile key={a.id} tone={h.tone === "warning" ? "warning" : h.tone === "danger" ? "danger" : "default"} className="md:col-span-4">
              <div className="flex items-center gap-3">
                <PlatformMark platform={a.platform} size="lg" />
                <div className="flex flex-col">
                  <span className="font-semibold">{a.account_name}</span>
                  <span className="text-[13px] opacity-80">{platformName(a.platform)} · {a.account_type ?? "account"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    h.tone === "success" && "bg-success-soft text-success",
                    h.tone === "warning" && "bg-card text-warning",
                    h.tone === "danger" && "bg-card text-danger",
                  )}
                >
                  {h.label}
                </span>
                {isTest && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">Test account</span>}
              </div>
              {h.days !== null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="opacity-80">Needs a refresh in</span>
                    <span className="font-semibold">{h.days <= 0 ? "now" : `${h.days} days`}</span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                    <div className={cn("h-1.5 rounded-full", h.tone === "success" ? "bg-emerald-400" : "bg-amber-400")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
              {isTest && <p className="m-0 text-[13px] opacity-80">Posts here are practice runs — nothing reaches the real page.</p>}
              {a.platform === "linkedin" && <p className="m-0 text-[13px] opacity-80">LinkedIn posts text only for now; photos are skipped.</p>}
              <p className="m-0 text-xs opacity-70">Connected {formatDateTime(a.connected_at)}</p>
              {isAdmin && (
                <div className="mt-auto flex gap-3">
                  {!isTest && a.platform !== "linkedin" && (
                    <button type="button" className="font-semibold text-accent-foreground" onClick={() => connectFacebook.mutate()}>
                      Refresh
                    </button>
                  )}
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setToRemove(a)}>
                    Disconnect
                  </button>
                </div>
              )}
            </Tile>
          );
        })
      )}

      {(failed.data?.items.length ?? 0) > 0 && (
        <Tile tone="danger" className="md:col-span-6">
          <TileTitle>Recent posts that didn’t publish</TileTitle>
          <ul className="m-0 flex flex-col gap-1.5 p-0">
            {failed.data!.items.map((p) => (
              <li key={p.id} className="list-none">
                <Link to={`/posts/${p.id}`} className="font-semibold text-danger">
                  {p.title || "Untitled post"}
                </Link>
                <span className="text-[13px]"> — open it to see what the platform said.</span>
              </li>
            ))}
          </ul>
        </Tile>
      )}
      <Tile tone="info" className={(failed.data?.items.length ?? 0) > 0 ? "md:col-span-6" : "md:col-span-12"}>
        <TileTitle>Why do connections need a refresh?</TileTitle>
        <p className="m-0">
          Facebook and Instagram ask you to log in again about every 60 days, and also when someone changes the page password or
          admin roles. We warn you 7 days before — and if a post can’t go out, we tell you plainly. We never post twice by mistake.
        </p>
      </Tile>

      <MockConnectDialog open={mockOpen} onClose={() => setMockOpen(false)} />

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {toRemove?.account_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Scheduled posts for this account will fail until you connect it again. Nothing already posted is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => toRemove && disconnect.mutate(toRemove.id)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BentoGrid>
  );
}

/** Development/staging only — the backend returns 404 in production. */
function MockConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const [platform, setPlatform] = useState<string>("facebook");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api<SocialAccount>(`/social/workspaces/${workspace!.id}/connect/mock`, {
        method: "POST",
        body: {
          platform,
          account_name: name.trim(),
          platform_account_id: `mock-${platform}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          account_type: "page",
        },
      }),
    onSuccess: () => {
      toast.success("Test account added.");
      qc.invalidateQueries({ queryKey: keys.accounts(workspace?.id) });
      setName("");
      onClose();
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 404 ? "Test accounts aren’t available on this server." : e instanceof ApiError ? e.message : "Couldn’t add it.",
      ),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a test account</DialogTitle>
          <DialogDescription>For trying the full flow. Publishing is simulated — nothing reaches a real page.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mock-platform">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id="mock-platform" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {platformName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mock-name">Account name</Label>
            <Input id="mock-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aura Coffee" className="h-11" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            Add test account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
