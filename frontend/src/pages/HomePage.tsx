import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, Clock, ExternalLink, LayoutTemplate, Link2Off, RotateCcw, ShieldCheck, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import { EmptyState, InlineLoadError, LoadError, PageHeader, TileTitle } from "@/components/common";
import { BrandLogo, PostThumb } from "@/components/PostThumb";
import { Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { accountHealth } from "@/lib/accountHealth";
import { api, type Post, type UsageSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, humanize, platformName } from "@/lib/format";
import { keys, platformEnabled, useAccounts, useFeatures, useTemplates, useWorkspacePosts } from "@/lib/queries";
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
const whenShort = new Intl.DateTimeFormat("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** One thing on the "Needs you" list: what to do, why, and the one button that does it. */
type Todo = {
  key: string;
  title: string;
  detail: ReactNode;
  action: string;
  to: string;
  tone: "danger" | "warning" | "default";
  post?: Post;
  icon?: LucideIcon;
};

export function HomePage() {
  const { user } = useAuth();
  const { workspace, brands, brandId, brandName } = useWorkspace();
  const firstName = user?.full_name.split(" ")[0] ?? "";

  // One wide read of recent posts drives most cards; per-status totals stay exact.
  const recent = useWorkspacePosts({ limit: 100 });
  const pending = useWorkspacePosts({ status: "pending_approval", limit: 5 });
  const approved = useWorkspacePosts({ status: "approved", limit: 5 });
  const failed = useWorkspacePosts({ status: "failed", limit: 5 });
  const partial = useWorkspacePosts({ status: "partially_published", limit: 5 });
  const scheduled = useWorkspacePosts({ status: "scheduled", limit: 50 });
  const accounts = useAccounts();
  const features = useFeatures();
  const usage = useQuery({
    queryKey: keys.usage(workspace?.id),
    queryFn: () => api<UsageSummary>(`/workspaces/${workspace!.id}/usage`, { query: { days: 30 } }),
    enabled: !!workspace,
  });
  const selectedBrand = brands.find((b) => b.id === brandId);
  const ideas = useTemplates({ industry: selectedBrand?.industry ?? brands[0]?.industry ?? undefined });
  const brandOf = (id: string) => brands.find((b) => b.id === id);

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
  const perBrand = useMemo(() => {
    const m = new Map<string, { scheduled: number; waiting: number }>();
    for (const p of posts) {
      const e = m.get(p.brand_id) ?? { scheduled: 0, waiting: 0 };
      if (p.status === "scheduled") e.scheduled++;
      if (p.status === "pending_approval") e.waiting++;
      m.set(p.brand_id, e);
    }
    return m;
  }, [posts]);

  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active);
  const accountStates = activeAccounts.map((a) => ({ account: a, health: accountHealth(a, platformEnabled(features.data, a.platform)) }));
  const working = accountStates.filter((s) => s.health.tone === "success").length;

  // Most urgent first: accounts that stop posts, failures, approvals, then approved posts with no date.
  const todos: Todo[] = [
    ...accountStates
      .filter((s) => s.health.tone === "danger" || s.health.tone === "warning")
      .map(({ account: a, health: h }) => ({
        key: `acc-${a.id}`,
        title: `${h.tone === "danger" ? "Fix" : "Refresh"} ${platformName(a.platform)} · ${a.account_name}`,
        detail: h.tone === "danger" ? `${h.label}. Posts to this account won’t go out until it’s fixed.` : "Its connection runs out soon. Reconnect it to keep posting.",
        action: "Fix it",
        to: "/accounts",
        tone: h.tone === "danger" ? ("danger" as const) : ("warning" as const),
        icon: Link2Off,
      })),
    ...[...(failed.data?.items ?? []), ...(partial.data?.items ?? [])].map((post) => ({
      key: post.id,
      title: `“${post.title || "Untitled post"}” didn’t publish`,
      detail: `${brandName(post.brand_id)} · open it to see why and try again`,
      action: "Try again",
      to: `/posts/${post.id}`,
      tone: "danger" as const,
      post,
    })),
    ...(pending.data?.items ?? []).map((post) => ({
      key: post.id,
      title: `Approve “${post.title || "Untitled post"}”`,
      detail: `${brandName(post.brand_id)}${post.scheduled_at ? ` · planned ${formatDateTime(post.scheduled_at)}` : ""}`,
      action: "Review",
      to: `/posts/${post.id}`,
      tone: "default" as const,
      post,
    })),
    ...(approved.data?.items ?? []).map((post) => ({
      key: post.id,
      title: `Pick a time for “${post.title || "Untitled post"}”`,
      detail: `${brandName(post.brand_id)} · approved, no date set yet`,
      action: "Pick a time",
      // "?schedule=1" lands on the scheduling panel, not the top of the editor.
      to: `/posts/${post.id}?schedule=1`,
      tone: "default" as const,
      post,
      icon: Clock,
    })),
  ].slice(0, 6);
  const todosLoading = failed.isLoading || pending.isLoading || approved.isLoading || accounts.isLoading;
  const todosError = failed.isError || partial.isError || pending.isError || approved.isError;
  const retryTodos = () => [failed, partial, pending, approved].forEach((q) => q.isError && void q.refetch());

  const setup = {
    brand: brands.length > 0,
    account: activeAccounts.length > 0,
    post: posts.length > 0,
    approved: posts.some((p) => ["approved", "scheduled", "published", "partially_published"].includes(p.status)),
  };
  const setupDone = Object.values(setup).every(Boolean);
  const loadingCore = recent.isLoading || accounts.isLoading;
  const brandQuery = brandId === ALL_BRANDS ? "" : `&brand=${brandId}`;
  const total = todos.length;

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-7 px-4 pt-6 pb-12 sm:px-8 lg:px-10">
      <PageHeader
        title="Your Studio"
        accent="Today"
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link to="/templates">
                <LayoutTemplate aria-hidden="true" /> Use a template
              </Link>
            </Button>
            <NewPostButton size="lg" />
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-7">
        {/* ── Left: what needs you, then what's coming ─────────────── */}
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-6">
          <Tile aria-labelledby="hello-h" className="rim gap-6 p-6 sm:p-9">
            <div className="flex flex-wrap gap-2">
              <span className="eyebrow inline-flex h-8 items-center rounded-md border border-eyebrow/50 bg-accent px-3">
                {loadingCore ? "Loading…" : !setupDone ? "Let’s get you set up" : total === 0 ? "All caught up" : `${total} thing${total === 1 ? "" : "s"} need you`}
              </span>
              <span className="inline-flex h-8 items-center rounded-md border bg-secondary px-3 text-sm">{longDate.format(new Date())}</span>
            </div>
            <div className="border-t pt-6">
              <h2 id="hello-h" className="font-display text-[34px] leading-tight font-medium sm:text-[42px]">
                {greeting()}
                {firstName ? `, ${firstName}` : ""}.
              </h2>
              <p className="mt-1.5 mb-0 font-display text-[17px] text-muted-foreground italic">
                {loadingCore
                  ? "Getting today ready…"
                  : !setupDone
                    ? "A few steps and you can publish your first post."
                    : "Here’s what needs you today, most urgent first."}
              </p>
            </div>

            {!loadingCore && !setupDone ? (
              <ol className="m-0 flex flex-col gap-3 p-0">
                <SetupStep done={setup.brand} to="/brands" title="Add a brand" hint="Who you post for. Agencies add one per client." />
                <SetupStep done={setup.account} to="/accounts" title="Connect a social account" hint="Facebook and Instagram, or a test account while you try things." />
                <SetupStep done={setup.post} to="/posts/new" title="Write your first post" hint="Start from a Smart Template in two clicks." />
                <SetupStep done={setup.approved} to="/posts" title="Get it approved" hint="Then schedule it or post it right away." />
              </ol>
            ) : todosLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-[76px] rounded-2xl" />
                <Skeleton className="h-[76px] rounded-2xl" />
              </div>
            ) : todosError ? (
              <LoadError what="what needs you" onRetry={retryTodos} />
            ) : todos.length === 0 ? (
              <EmptyState title="You’re all caught up">Nothing needs approving, scheduling or fixing right now. A good moment to plan next week.</EmptyState>
            ) : (
              <ul className="m-0 flex flex-col gap-3 p-0">
                {todos.map((t) => (
                  <TodoRow key={t.key} todo={t} brand={t.post ? brandOf(t.post.brand_id) : undefined} />
                ))}
              </ul>
            )}
          </Tile>

          <section aria-labelledby="upcoming-h" className="flex flex-col gap-4 rounded-[var(--radius-tile)] border bg-surface-subtle p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="upcoming-h" className="eyebrow m-0" style={{ fontSize: 14 }}>
                Coming up
              </h2>
              <span className="inline-flex h-7 items-center rounded-full border border-eyebrow/40 bg-accent px-3 text-[13px] font-semibold text-accent-foreground">
                Next 7 days
              </span>
              <span className="flex-1" />
              <Link to="/calendar" className="text-sm font-semibold text-accent-foreground">
                Open calendar →
              </Link>
            </div>
            {scheduled.isLoading ? (
              <Skeleton className="h-40 rounded-2xl" />
            ) : scheduled.isError ? (
              <InlineLoadError what="the schedule" onRetry={() => void scheduled.refetch()} />
            ) : upcoming.length === 0 ? (
              <p className="m-0 text-muted-foreground">Nothing scheduled in the next 7 days.</p>
            ) : (
              <ul className="m-0 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3.5 p-0">
                {upcoming.slice(0, 5).map((p) => (
                  <li key={p.id} className="list-none">
                    <Link to={`/posts/${p.id}`} className="flex h-full flex-col gap-2.5 rounded-2xl border bg-card p-2 pb-3 text-foreground no-underline hover:bg-surface-hover">
                      <span className="relative block">
                        <PostThumb post={p} brand={brandOf(p.brand_id)} className="aspect-[4/3] h-auto w-full rounded-xl text-base" />
                        <span className="absolute top-1.5 left-1.5 rounded-md border border-eyebrow/50 bg-background/85 px-2 py-0.5 text-xs font-bold">
                          {whenShort.format(new Date(p.scheduled_at!))}
                        </span>
                      </span>
                      <span className="px-1 text-sm leading-snug font-bold">{p.title || "Untitled post"}</span>
                      <span className="px-1 text-[13px] text-muted-foreground">{brandName(p.brand_id)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right: publishing status, activity, recent posts ─────── */}
        <aside aria-label="At a glance" className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
          <Tile aria-labelledby="publishing-h" className="gap-4 p-6">
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl border bg-secondary text-eyebrow">
                <ShieldCheck className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="eyebrow">Publishing</div>
                <h2 id="publishing-h" className="m-0 font-display text-[26px] leading-tight font-medium">
                  Auto-publish
                </h2>
              </div>
            </div>
            <p className="m-0 leading-relaxed text-secondary-foreground">
              Approved posts go out on their own at the time you set. If one can’t post, it shows up in “Needs you” with a fix.
            </p>
            <div className="grid grid-cols-3 gap-2.5 border-t pt-4">
              <Stat value={accounts.isLoading ? "–" : `${working} / ${activeAccounts.length}`} label="Accounts working" />
              <Stat value={scheduled.isLoading ? "–" : String(upcoming.length)} label="Next 7 days" />
              <Stat value={pending.isLoading ? "–" : String(pending.data?.total ?? 0)} label="Waiting for you" to={`/posts?status=pending_approval${brandQuery}`} />
            </div>
          </Tile>

          <Tile aria-labelledby="activity-h" className="gap-4 p-6">
            <div className="flex items-baseline justify-between gap-2">
              <TileTitle id="activity-h">Last 14 Days</TileTitle>
              <span className="text-[13px] text-muted-foreground">{activity.reduce((s, d) => s + d.count, 0)} published</span>
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
                      <div className={cn("w-full rounded-t-sm", d.count ? "bg-primary" : "bg-muted")} style={{ height: `${px}px` }} />
                      {(i === 0 || i === 13) && <span className="text-[10px] text-muted-foreground">{dayChip.format(new Date(d.start))}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2.5">
              <Stat value={usage.data?.counts.post_created ?? "–"} label="Written · 30d" />
              <Stat value={usage.data?.counts.post_published ?? "–"} label="Published · 30d" />
              <Stat value={usage.data?.counts.media_uploaded ?? "–"} label="Photos · 30d" />
            </div>
          </Tile>

          <Tile aria-labelledby="recent-h" className="gap-4 p-6">
            <div className="flex items-baseline justify-between">
              <TileTitle id="recent-h">Recently Posted</TileTitle>
              <Link to={`/posts?status=published${brandQuery}`} className="text-sm font-semibold text-accent-foreground">
                All posts →
              </Link>
            </div>
            {recent.isLoading ? (
              <Skeleton className="h-40" />
            ) : published.length === 0 ? (
              <p className="m-0 text-muted-foreground">Nothing published yet. Your first post will show up here.</p>
            ) : (
              <ul className="m-0 grid grid-cols-2 gap-3 p-0">
                {published.slice(0, 4).map((p) => {
                  const links = Object.values((p.publish_result ?? {}) as Record<string, { url?: string }>)
                    .map((r) => r.url)
                    .filter(Boolean) as string[];
                  return (
                    <li key={p.id} className="flex list-none flex-col gap-2 rounded-2xl border bg-secondary p-2 pb-3">
                      <PostThumb post={p} brand={brandOf(p.brand_id)} className="aspect-[16/10] h-auto w-full rounded-xl" />
                      <Link to={`/posts/${p.id}`} className="truncate px-1 text-sm font-semibold text-foreground">
                        {p.title || "Untitled post"}
                      </Link>
                      <span className="px-1 text-xs text-muted-foreground">
                        {brandName(p.brand_id)} · {formatDateTime(p.published_at)}
                      </span>
                      {links[0] && (
                        <a href={links[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1 text-xs font-semibold text-accent-foreground">
                          View post <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Tile>
        </aside>
      </div>

      {/* ── Brands and ideas ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-6">
        {brands.length > 0 && (
          <Tile aria-labelledby="brands-h" className="min-w-0 flex-[1_1_420px] gap-4 p-6">
            <div className="flex items-baseline justify-between">
              <TileTitle id="brands-h">Your Brands</TileTitle>
              <Link to="/brands" className="text-sm font-semibold text-accent-foreground">
                Manage brands
              </Link>
            </div>
            <ul className="m-0 flex flex-col gap-3 p-0">
              {brands.slice(0, 4).map((b) => {
                const c = perBrand.get(b.id) ?? { scheduled: 0, waiting: 0 };
                return (
                  <li key={b.id} className="flex list-none flex-wrap items-center gap-3.5 rounded-2xl border bg-secondary p-3.5">
                    <BrandLogo brand={b} className="size-12 rounded-xl text-sm" />
                    <div className="flex min-w-0 flex-1 basis-40 flex-col">
                      <span className="truncate font-bold">{b.name}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {b.industry ? `${humanize(b.industry)} · ` : ""}
                        {c.scheduled} scheduled · {c.waiting ? `${c.waiting} waiting` : "nothing waiting"}
                      </span>
                    </div>
                    <Button asChild variant="outline" aria-label={`New post for ${b.name}`}>
                      <Link to={`/posts/new?brand=${b.id}`}>Post</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Tile>
        )}

        <Tile aria-labelledby="ideas-h" className="min-w-0 flex-[1.3_1_420px] gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <TileTitle id="ideas-h">Stuck for an Idea?</TileTitle>
              <p className="mt-1 mb-0 text-sm text-muted-foreground">
                Smart Templates{selectedBrand?.industry ? ` for ${humanize(selectedBrand.industry).toLowerCase()}` : ""}. Fill in the blanks and send for review.
              </p>
            </div>
            <Link to="/templates" className="shrink-0 text-sm font-semibold text-accent-foreground">
              All templates
            </Link>
          </div>
          {ideas.isLoading ? (
            <Skeleton className="h-28" />
          ) : (ideas.data?.items ?? []).length === 0 || brands.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Add a brand with an industry to get matching ideas.</p>
          ) : (
            <ul className="m-0 grid grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
              {(ideas.data?.items ?? []).slice(0, 4).map((t) => {
                const brand = selectedBrand ?? brands.find((b) => b.industry === t.industry) ?? brands[0]!;
                return (
                  <li key={t.id} className="list-none">
                    <Link
                      to={`/posts/new?brand=${brand.id}&template=${t.id}`}
                      className="flex min-h-16 items-center gap-3 rounded-2xl border bg-secondary px-3.5 py-3 text-foreground no-underline hover:bg-surface-active"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-display text-base font-semibold text-eyebrow">
                        {t.title.charAt(0)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-sm font-bold">{t.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{brand.name}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Tile>
      </div>
    </main>
  );
}

function TodoRow({ todo, brand }: { todo: Todo; brand?: Parameters<typeof PostThumb>[0]["brand"] }) {
  const Icon = todo.icon ?? RotateCcw;
  return (
    <li
      className={cn(
        "flex list-none flex-wrap items-center gap-4 rounded-2xl border px-4 py-3.5",
        todo.tone === "danger" ? "border-danger-border bg-danger-soft" : todo.tone === "warning" ? "border-warning-border bg-warning-soft" : "bg-secondary",
      )}
    >
      {todo.post && !todo.icon ? (
        <PostThumb post={todo.post} brand={brand} className="size-14 rounded-xl" />
      ) : (
        <span
          className={cn(
            "grid size-14 shrink-0 place-items-center rounded-xl border",
            todo.tone === "danger" ? "border-danger-border text-danger" : todo.tone === "warning" ? "border-warning-border text-warning" : "border-eyebrow/50 text-eyebrow",
          )}
        >
          <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-[1_1_260px]">
        <div className="text-base font-bold">{todo.title}</div>
        <div className="text-sm text-muted-foreground">{todo.detail}</div>
      </div>
      <Button asChild variant={todo.tone === "danger" ? "default" : "outline"}>
        <Link to={todo.to}>
          {todo.action} <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </li>
  );
}

function Stat({ value, label, to }: { value: ReactNode; label: string; to?: string }) {
  const body = (
    <>
      <span className="num block font-display text-[26px] leading-tight text-accent-foreground">{value}</span>
      <span className="block text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
    </>
  );
  const cls = "rounded-xl border bg-secondary px-2 py-3 text-center no-underline";
  return to ? (
    <Link to={to} className={cn(cls, "text-foreground hover:bg-surface-active")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function SetupStep({ done, to, title, hint }: { done: boolean; to: string; title: string; hint: string }) {
  return (
    <li className={cn("flex list-none flex-wrap items-center gap-4 rounded-2xl border px-4 py-3.5", done ? "bg-transparent" : "bg-secondary")}>
      {done ? (
        <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-[1_1_220px] flex-col">
        <span className={cn("font-bold", done && "text-muted-foreground line-through")}>{title}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
      {!done && (
        <Button asChild variant="outline">
          <Link to={to}>
            Go <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </li>
  );
}
