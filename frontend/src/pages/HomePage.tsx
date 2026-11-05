import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { BentoGrid, Tile } from "@/components/Tile";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Post, type PostList, type SocialAccount } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { NewPostButton } from "./posts/PostsPage";

type Status = Post["status"];

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const PLATFORM_NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** Posts in one status for the selected workspace (and brand, if one is picked). */
function usePostsByStatus(status: Status, limit = 5) {
  const { workspace, brandId } = useWorkspace();
  return useQuery({
    queryKey: ["ws-posts", workspace?.id, brandId, status, limit],
    queryFn: () =>
      api<PostList>(`/workspaces/${workspace!.id}/posts`, {
        query: { status, limit, brand_id: brandId === ALL_BRANDS ? undefined : brandId },
      }),
    enabled: !!workspace,
  });
}

function CountTile({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number | undefined;
  tone: "default" | "info" | "danger";
  loading: boolean;
}) {
  return (
    <Tile tone={tone} className="justify-between md:col-span-2">
      {loading ? (
        <Skeleton className="h-9 w-10" />
      ) : (
        <span className="text-4xl leading-none font-bold">{value ?? 0}</span>
      )}
      <span className="font-medium">{label}</span>
    </Tile>
  );
}

const ROW_BADGE: Record<string, { label: string; className: string }> = {
  failed: { label: "Didn’t publish", className: "bg-danger-soft text-danger" },
  partially_published: { label: "Partly published", className: "bg-warning-soft text-warning" },
  pending_approval: { label: "Needs approval", className: "bg-info-soft text-info" },
  approved: { label: "Ready to schedule", className: "bg-success-soft text-success" },
};

export function HomePage() {
  const { user } = useAuth();
  const { workspace, brandName } = useWorkspace();

  const pending = usePostsByStatus("pending_approval");
  const scheduled = usePostsByStatus("scheduled");
  const failed = usePostsByStatus("failed");
  const approved = usePostsByStatus("approved");

  const accounts = useQuery({
    queryKey: ["accounts", workspace?.id],
    queryFn: () => api<SocialAccount[]>(`/social/workspaces/${workspace!.id}/accounts`),
    enabled: !!workspace,
  });

  // Failures first: the row that needs a nudge must ask for it.
  const attention = [
    ...(failed.data?.items ?? []),
    ...(pending.data?.items ?? []),
    ...(approved.data?.items ?? []),
  ].slice(0, 6);
  const attentionLoading = failed.isLoading || pending.isLoading || approved.isLoading;

  return (
    <BentoGrid>
      <Tile className="flex-row flex-wrap items-center justify-between gap-4 md:col-span-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting()}, {user?.full_name.split(" ")[0]}
          </h1>
          <span className="text-muted-foreground">Here’s what needs you today.</span>
        </div>
        <NewPostButton size="lg" />
      </Tile>

      <CountTile
        label="waiting for approval"
        value={pending.data?.total}
        tone={pending.data?.total ? "info" : "default"}
        loading={pending.isLoading}
      />
      <CountTile label="scheduled" value={scheduled.data?.total} tone="default" loading={scheduled.isLoading} />
      {/* Red only when something actually failed — a zero shouldn't alarm anyone. */}
      <CountTile
        label="didn’t publish"
        value={failed.data?.total}
        tone={failed.data?.total ? "danger" : "default"}
        loading={failed.isLoading}
      />

      <Tile aria-labelledby="attention-h" className="gap-1 md:col-span-6 md:row-span-3">
        <h2 id="attention-h" className="mb-2 text-base font-semibold">
          Needs your attention
        </h2>
        {attentionLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : attention.length === 0 ? (
          <p className="text-muted-foreground">Nothing right now. Nice.</p>
        ) : (
          <ul className="flex flex-col">
            {attention.map((p) => {
              const badge = ROW_BADGE[p.status];
              return (
                <li key={p.id} className="border-t">
                  <Link to={`/posts/${p.id}`} className="flex flex-wrap items-center gap-3 rounded-lg px-1 py-3.5 text-foreground no-underline hover:bg-muted/60">
                  {badge && (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  <div className="flex min-w-[220px] flex-1 flex-col">
                    <span className="font-semibold">
                      {p.title || "Untitled post"} · {brandName(p.brand_id)}
                    </span>
                    <span className="line-clamp-1 text-[13px] text-muted-foreground">{p.caption}</span>
                  </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>

      <Tile aria-labelledby="accounts-h" className="md:col-span-6 md:row-span-3">
        <h2 id="accounts-h" className="text-base font-semibold">
          Connected accounts
        </h2>
        {accounts.isLoading ? (
          <Skeleton className="h-16" />
        ) : (accounts.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">No accounts connected yet.</p>
        ) : (
          <ul className="flex flex-col gap-3.5">
            {accounts.data!.map((a) => {
              const days = daysUntil(a.token_expires_at);
              const soon = a.needs_reauth || (days !== null && days <= 7);
              const pct = days === null ? 100 : Math.max(4, Math.min(100, Math.round((days / 60) * 100)));
              return (
                <li key={a.id} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3">
                    <span>
                      {PLATFORM_NAME[a.platform] ?? a.platform} · {a.account_name}
                    </span>
                    <span className={`text-[13px] font-semibold ${soon ? "text-warning" : "text-success"}`}>
                      {days === null ? "No expiry" : days <= 0 ? "Expired" : `${days} days left`}
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                    <div
                      className={`h-1.5 rounded-full ${soon ? "bg-[#F79009]" : "bg-[#17B26A]"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Link to="/accounts" className="mt-auto font-semibold text-accent-foreground">
          Manage accounts
        </Link>
      </Tile>
    </BentoGrid>
  );
}
