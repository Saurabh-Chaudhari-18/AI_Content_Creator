import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, ExternalLink, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { EmptyState, StatusBadge, TileTitle } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Post, type UsageSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysUntil, formatDateTime, humanize, initials, platformName } from "@/lib/format";
import { keys, useAccounts, useTemplates, useWorkspacePosts } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { NewPostButton } from "./posts/PostsPage";

const DAY = 86_400_000;

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const longDate = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });
const dayChip = new Intl.DateTimeFormat("en-IN", { weekday: "short" });
const timeOnly = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** One sentence that says what today looks like. */
function summary(counts: { pending: number; scheduledWeek: number; failed: number }): string {
  const parts: string[] = [];
  if (counts.failed) parts.push(`${counts.failed} post${counts.failed === 1 ? "" : "s"} didn’t publish`);
  if (counts.pending) parts.push(`${counts.pending} waiting for approval`);
  if (counts.scheduledWeek) parts.push(`${counts.scheduledWeek} going out this week`);
  if (parts.length === 0) return "Nothing is waiting on you. A good moment to plan next week.";
  return parts.join(" · ") + ".";
}

export function HomePage() {
  const { user } = useAuth();
  const { workspace, brands, brandId, brandName } = useWorkspace();
  const firstName = user?.full_name.split(" ")[0] ?? "";

  // One wide read of recent posts drives most tiles; per-status totals stay exact.
  const recent = useWorkspacePosts({ limit: 100 });
  const pending = useWorkspacePosts({ status: "pending_approval", limit: 5 });
  const approved = useWorkspacePosts({ status: "approved", limit: 5 });
  const failed = useWorkspacePosts({ status: "failed", limit: 5 });
  const partial = useWorkspacePosts({ status: "partially_published", limit: 5 });
  const scheduled = useWorkspacePosts({ status: "scheduled", limit: 50 });
  const accounts = useAccounts();
  const usage = useQuery({
    queryKey: keys.usage(workspace?.id),
    queryFn: () => api<UsageSummary>(`/workspaces/${workspace!.id}/usage`, { query: { days: 30 } }),
    enabled: !!workspace,
  });
  const selectedBrand = brands.find((b) => b.id === brandId);
  const ideas = useTemplates({ industry: selectedBrand?.industry ?? brands[0]?.industry ?? undefined });

  const now = Date.now();
  const posts = recent.data?.items ?? [];

  const upcoming = useMemo(
    () =>
      (scheduled.data?.items ?? [])
        .filter((p) => p.scheduled_at && new Date(p.scheduled_at).getTime() - now < 7 * DAY)
        .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime()),
    [scheduled.data, now],
  );
  const published = useMemo(
    () =>
      posts
        .filter((p) => p.published_at)
        .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime()),
    [posts],
  );
  const activity = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * DAY);
      d.setHours(0, 0, 0, 0);
      return { start: d.getTime(), count: 0 };
    });
    for (const p of published) {
      const t = new Date(p.published_at!).getTime();
      const bucket = days.find((d) => t >= d.start && t < d.start + DAY);
      if (bucket) bucket.count++;
    }
    return days;
  }, [published, now]);
  const publishedThisMonth = published.filter((p) => new Date(p.published_at!).getTime() > now - 30 * DAY).length;
  const perBrand = useMemo(() => {
    const m = new Map<string, { total: number; scheduled: number; drafts: number }>();
    for (const p of posts) {
      const e = m.get(p.brand_id) ?? { total: 0, scheduled: 0, drafts: 0 };
      e.total++;
      if (p.status === "scheduled") e.scheduled++;
      if (p.status === "draft" || p.status === "pending_approval") e.drafts++;
      m.set(p.brand_id, e);
    }
    return m;
  }, [posts]);

  // Failures first, then approvals waiting, then approved-but-unscheduled.
  const attention: { post: Post; action: string; tone: "danger" | "info" | "success" }[] = [
    ...(failed.data?.items ?? []).map((post) => ({ post, action: "Try again", tone: "danger" as const })),
    ...(partial.data?.items ?? []).map((post) => ({ post, action: "Try again", tone: "danger" as const })),
    ...(pending.data?.items ?? []).map((post) => ({ post, action: "Review", tone: "info" as const })),
    ...(approved.data?.items ?? []).map((post) => ({ post, action: "Schedule", tone: "success" as const })),
  ].slice(0, 6);
  const attentionLoading = failed.isLoading || pending.isLoading || approved.isLoading;

  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active);
  const setup = {
    brand: brands.length > 0,
    account: activeAccounts.length > 0,
    post: posts.length > 0,
    approved: posts.some((p) => ["approved", "scheduled", "published", "partially_published"].includes(p.status)),
  };
  const setupDone = Object.values(setup).every(Boolean);
  const loadingCore = recent.isLoading || accounts.isLoading;

  const brandQuery = brandId === ALL_BRANDS ? "" : `&brand=${brandId}`;

  return (
    <BentoGrid>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section
        className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-[var(--radius-tile)] p-6 text-white sm:p-7 md:col-span-8"
        style={{ background: "linear-gradient(135deg, var(--primary) 0%, #1e1b4b 100%)" }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -top-20 -right-20 size-72 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-1.5">
          <span className="text-sm text-white/75">{longDate.format(new Date())}</span>
          <h1 className="text-3xl font-bold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          {loadingCore ? (
            <Skeleton className="h-5 w-72 bg-white/20" />
          ) : !setupDone ? (
            <p className="m-0 max-w-xl text-white/85">Let’s get your workspace ready. A few steps and you can publish your first post.</p>
          ) : (
            <p className="m-0 max-w-xl text-white/85">
              {summary({ pending: pending.data?.total ?? 0, scheduledWeek: upcoming.length, failed: (failed.data?.total ?? 0) + (partial.data?.total ?? 0) })}
            </p>
          )}
        </div>
        <div className="relative flex flex-wrap gap-2">
          <div className="[&>button]:bg-white [&>button]:text-[#1e1b4b] [&>button]:hover:bg-white/90">
            <NewPostButton size="lg" />
          </div>
          <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            <Link to="/templates">
              <Sparkles aria-hidden="true" /> Browse templates
            </Link>
          </Button>
        </div>
      </section>

      {/* ── Activity ─────────────────────────────────────────────── */}
      <Tile aria-labelledby="activity-h" className="justify-between md:col-span-4">
        <div className="flex items-baseline justify-between gap-2">
          <TileTitle id="activity-h">Last 14 days</TileTitle>
          <span className="text-[13px] text-muted-foreground">{published.length ? `${activity.reduce((s, d) => s + d.count, 0)} published` : "—"}</span>
        </div>
        {recent.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <div
            role="img"
            aria-label={`Posts published per day over the last 14 days: ${activity.map((d) => d.count).join(", ")}`}
            className="flex h-20 items-end gap-1"
          >
            {activity.map((d, i) => {
              const max = Math.max(1, ...activity.map((x) => x.count));
              // Pixel heights: a percentage would be relative to the column, which has no fixed height.
              const px = d.count ? Math.max(10, Math.round((d.count / max) * 56)) : 4;
              return (
                <div key={d.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div
                    title={`${new Date(d.start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: ${d.count}`}
                    className={cn("w-full rounded-t-sm", d.count ? "bg-primary" : "bg-muted")}
                    style={{ height: `${px}px` }}
                  />
                  {(i === 0 || i === 13) && <span className="text-[10px] text-muted-foreground">{dayChip.format(new Date(d.start))}</span>}
                </div>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted py-2">
            <span className="block text-xl font-bold">{usage.data?.counts.post_created ?? "–"}</span>
            <span className="text-[11px] text-muted-foreground">written · 30d</span>
          </div>
          <div className="rounded-xl bg-muted py-2">
            <span className="block text-xl font-bold">{usage.data?.counts.post_published ?? "–"}</span>
            <span className="text-[11px] text-muted-foreground">published · 30d</span>
          </div>
          <div className="rounded-xl bg-muted py-2">
            <span className="block text-xl font-bold">{usage.data?.counts.media_uploaded ?? "–"}</span>
            <span className="text-[11px] text-muted-foreground">photos · 30d</span>
          </div>
        </div>
      </Tile>

      {/* ── Counts (each opens Posts pre-filtered) ───────────────── */}
      <CountTile to={`/posts?status=pending_approval${brandQuery}`} label="waiting for approval" value={pending.data?.total} tone={pending.data?.total ? "info" : "default"} loading={pending.isLoading} />
      <CountTile to={`/posts?status=scheduled${brandQuery}`} label="scheduled" value={scheduled.data?.total} tone="default" loading={scheduled.isLoading} />
      <CountTile to={`/posts?status=published${brandQuery}`} label="published this month" value={recent.isLoading ? undefined : publishedThisMonth} tone={publishedThisMonth ? "success" : "default"} loading={recent.isLoading} />
      <CountTile to={`/posts?status=failed${brandQuery}`} label="didn’t publish" value={(failed.data?.total ?? 0) + (partial.data?.total ?? 0)} tone={(failed.data?.total ?? 0) + (partial.data?.total ?? 0) ? "danger" : "default"} loading={failed.isLoading} />

      {/* ── Needs you / setup ────────────────────────────────────── */}
      {!loadingCore && !setupDone ? (
        <Tile aria-labelledby="setup-h" className="md:col-span-6 md:row-span-2">
          <TileTitle id="setup-h">Get set up</TileTitle>
          <ol className="m-0 flex flex-col p-0">
            <SetupStep done={setup.brand} to="/brands" title="Add a brand" hint="Who you post for. Agencies add one per client." />
            <SetupStep done={setup.account} to="/accounts" title="Connect a social account" hint="Facebook and Instagram, or a test account while you try things." />
            <SetupStep done={setup.post} to="/posts" title="Write your first post" hint="Start from a Smart Template in two clicks." />
            <SetupStep done={setup.approved} to="/posts" title="Get it approved" hint="Then schedule it or post it right away." />
          </ol>
        </Tile>
      ) : (
        <Tile aria-labelledby="attention-h" className="gap-1 md:col-span-6 md:row-span-2">
          <div className="mb-1 flex items-baseline justify-between">
            <TileTitle id="attention-h">Needs your attention</TileTitle>
            <Link to="/posts" className="text-[13px] font-semibold text-accent-foreground">All posts</Link>
          </div>
          {attentionLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : attention.length === 0 ? (
            <EmptyState title="You’re all caught up">Nothing needs approving, scheduling or fixing right now.</EmptyState>
          ) : (
            <ul className="m-0 flex flex-col p-0">
              {attention.map(({ post, action }) => (
                <li key={post.id} className="flex list-none flex-wrap items-center gap-3 border-t py-3">
                  {post.media[0] ? (
                    <img src={post.media[0].media_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">{initials(brandName(post.brand_id))}</span>
                  )}
                  <div className="flex min-w-[200px] flex-1 flex-col">
                    <span className="font-semibold">{post.title || "Untitled post"} <span className="font-normal text-muted-foreground">· {brandName(post.brand_id)}</span></span>
                    <span className="line-clamp-1 text-[13px] text-muted-foreground">{post.caption || "No caption yet"}</span>
                  </div>
                  <StatusBadge status={post.status} />
                  <Button asChild size="sm" variant={action === "Try again" ? "default" : "outline"}>
                    <Link to={`/posts/${post.id}`}>{action}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      )}

      {/* ── Coming up ────────────────────────────────────────────── */}
      <Tile aria-labelledby="upcoming-h" className="md:col-span-3 md:row-span-2">
        <div className="flex items-baseline justify-between">
          <TileTitle id="upcoming-h">Coming up</TileTitle>
          <Link to="/calendar" className="text-[13px] font-semibold text-accent-foreground">Calendar</Link>
        </div>
        {scheduled.isLoading ? (
          <Skeleton className="h-24" />
        ) : upcoming.length === 0 ? (
          <p className="m-0 text-muted-foreground">Nothing scheduled in the next 7 days.</p>
        ) : (
          <ul className="m-0 flex flex-col gap-3 p-0">
            {upcoming.slice(0, 5).map((p) => {
              const d = new Date(p.scheduled_at!);
              return (
                <li key={p.id} className="list-none">
                  <Link to={`/posts/${p.id}`} className="flex gap-3 text-foreground no-underline">
                    <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-muted py-1.5">
                      <span className="text-[11px] text-muted-foreground uppercase">{dayChip.format(d)}</span>
                      <span className="text-lg leading-tight font-bold">{d.getDate()}</span>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{p.title || "Untitled post"}</span>
                      <span className="text-[13px] text-muted-foreground">{timeOnly.format(d)} · {brandName(p.brand_id)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>

      {/* ── Accounts ─────────────────────────────────────────────── */}
      <Tile aria-labelledby="accounts-h" className="md:col-span-3 md:row-span-2">
        <div className="flex items-baseline justify-between">
          <TileTitle id="accounts-h">Accounts</TileTitle>
          <Link to="/accounts" className="text-[13px] font-semibold text-accent-foreground">Manage</Link>
        </div>
        {accounts.isLoading ? (
          <Skeleton className="h-16" />
        ) : activeAccounts.length === 0 ? (
          <>
            <p className="m-0 text-muted-foreground">No accounts connected yet.</p>
            <Button asChild variant="outline" className="self-start"><Link to="/accounts">Connect one</Link></Button>
          </>
        ) : (
          <ul className="m-0 flex flex-col gap-3 p-0">
            {activeAccounts.map((a) => {
              const days = daysUntil(a.token_expires_at);
              const soon = a.needs_reauth || (days !== null && days <= 7);
              const pct = days === null ? 100 : Math.max(4, Math.min(100, Math.round((days / 60) * 100)));
              return (
                <li key={a.id} className="flex list-none flex-col gap-1">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate">{platformName(a.platform)} · {a.account_name}</span>
                    <span className={cn("shrink-0 font-semibold", soon ? "text-warning" : "text-success")}>
                      {days === null ? "OK" : days <= 0 ? "Expired" : `${days}d`}
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                    <div className={cn("h-1.5 rounded-full", soon ? "bg-[#F79009]" : "bg-[#17B26A]")} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>

      {/* ── Brands ───────────────────────────────────────────────── */}
      {brands.length > 0 && (
        <Tile aria-labelledby="brands-h" className="md:col-span-7">
          <div className="flex items-baseline justify-between">
            <TileTitle id="brands-h">Your brands</TileTitle>
            <Link to="/brands" className="text-[13px] font-semibold text-accent-foreground">Manage</Link>
          </div>
          <ul className="m-0 grid gap-3 p-0 sm:grid-cols-2">
            {brands.slice(0, 4).map((b) => {
              const c = perBrand.get(b.id) ?? { total: 0, scheduled: 0, drafts: 0 };
              return (
                <li key={b.id} className="flex list-none items-center gap-3 rounded-xl border p-3">
                  {b.logo_url ? (
                    <img src={b.logo_url} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent font-bold text-accent-foreground">{initials(b.name)}</span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{b.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.scheduled} scheduled · {c.drafts} in progress{b.industry ? ` · ${humanize(b.industry)}` : ""}
                    </span>
                  </div>
                  <Button asChild size="sm" variant="ghost" aria-label={`New post for ${b.name}`}>
                    <Link to={`/posts/new?brand=${b.id}`}><ArrowRight aria-hidden="true" /></Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </Tile>
      )}

      {/* ── Ideas ────────────────────────────────────────────────── */}
      <Tile tone="info" aria-labelledby="ideas-h" className={brands.length > 0 ? "md:col-span-5" : "md:col-span-12"}>
        <TileTitle id="ideas-h">Ideas for {selectedBrand?.name ?? "your next post"}</TileTitle>
        <p className="m-0 text-[13px]">Smart Templates{selectedBrand?.industry ? ` for ${humanize(selectedBrand.industry).toLowerCase()}` : ""} — fill in the blanks and go.</p>
        <div className="flex flex-wrap gap-2">
          {(ideas.data?.items ?? []).slice(0, 4).map((t) => {
            const brand = selectedBrand ?? brands.find((b) => b.industry === t.industry) ?? brands[0];
            return brand ? (
              <Button key={t.id} asChild size="sm" variant="outline" className="rounded-full bg-card">
                <Link to={`/posts/new?brand=${brand.id}&template=${t.id}`}>{t.title}</Link>
              </Button>
            ) : null;
          })}
          {ideas.isSuccess && (ideas.data.items.length === 0 || brands.length === 0) && (
            <span className="text-[13px]">Add a brand with an industry to get matching ideas.</span>
          )}
        </div>
      </Tile>

      {/* ── Recently published ───────────────────────────────────── */}
      <Tile aria-labelledby="recent-h" className="md:col-span-12">
        <div className="flex items-baseline justify-between">
          <TileTitle id="recent-h">Recently published</TileTitle>
          <Link to={`/posts?status=published${brandQuery}`} className="text-[13px] font-semibold text-accent-foreground">See all</Link>
        </div>
        {recent.isLoading ? (
          <Skeleton className="h-24" />
        ) : published.length === 0 ? (
          <p className="m-0 text-muted-foreground">Nothing published yet. Your first post will show up here.</p>
        ) : (
          <ul className="m-0 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {published.slice(0, 4).map((p) => {
              const links = Object.values((p.publish_result ?? {}) as Record<string, { url?: string }>).map((r) => r.url).filter(Boolean) as string[];
              return (
                <li key={p.id} className="flex list-none gap-3 rounded-xl border p-3">
                  {p.media[0] ? (
                    <img src={p.media[0].media_url} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden="true" className="size-16 shrink-0 rounded-lg bg-muted" />
                  )}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link to={`/posts/${p.id}`} className="truncate font-semibold text-foreground">{p.title || "Untitled post"}</Link>
                    <span className="text-xs text-muted-foreground">{brandName(p.brand_id)} · {formatDateTime(p.published_at)}</span>
                    {links[0] && (
                      <a href={links[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-accent-foreground">
                        View post <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </BentoGrid>
  );
}

function CountTile({
  to,
  label,
  value,
  tone,
  loading,
}: {
  to: string;
  label: string;
  value: number | undefined;
  tone: "default" | "info" | "danger" | "success";
  loading: boolean;
}) {
  return (
    <Tile tone={tone} className="group justify-between p-0 md:col-span-3">
      <Link to={to} className="flex h-full flex-col justify-between gap-3 p-5 text-inherit no-underline sm:p-6">
        {loading ? <Skeleton className="h-9 w-10" /> : <span className="text-4xl leading-none font-bold">{value ?? 0}</span>}
        <span className="flex items-center justify-between font-medium">
          {label}
          <ArrowRight aria-hidden="true" className="size-4 opacity-0 transition-opacity group-hover:opacity-70" />
        </span>
      </Link>
    </Tile>
  );
}

function SetupStep({ done, to, title, hint }: { done: boolean; to: string; title: string; hint: string }) {
  return (
    <li className="flex list-none items-start gap-3 border-t py-3 first:border-t-0">
      {done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="flex flex-1 flex-col">
        <span className={cn("font-semibold", done && "text-muted-foreground line-through")}>{title}</span>
        <span className="text-[13px] text-muted-foreground">{hint}</span>
      </div>
      {!done && (
        <Button asChild size="sm" variant="outline">
          <Link to={to}>Go</Link>
        </Button>
      )}
    </li>
  );
}
