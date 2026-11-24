import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { BrandPickerDialog } from "@/components/BrandPicker";
import { EmptyState, LoadError, PageHeader, StatusBadge } from "@/components/common";
import { PostThumb } from "@/components/PostThumb";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Post } from "@/lib/api";
import { useDeadlineOptions } from "@/lib/approvals";
import { formatDateTime } from "@/lib/format";
import { useWorkspacePosts } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { DueChip } from "./ReviewerDialogs";

type Filter = Post["status"] | "all" | "overdue";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Waiting for approval" },
  // Waiting past their "Needed by" (shown only when the plan has deadlines).
  { value: "overdue", label: "Overdue" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Didn’t publish" },
];

const PAGE_SIZE = 20;

/** What opening a post in each state is for. */
const NEXT_STEP: Record<string, string> = {
  draft: "Continue",
  pending_approval: "Review",
  approved: "Pick a time",
  failed: "Fix it",
  partially_published: "Fix it",
};

/** "New post" needs a brand. With "All brands" selected, ask which one. */
export function NewPostButton({ size = "default" }: { size?: "default" | "lg" }) {
  const { brandId, brands } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function start() {
    if (brandId !== ALL_BRANDS) navigate(`/posts/new?brand=${brandId}`);
    else if (brands.length === 1) navigate(`/posts/new?brand=${brands[0]!.id}`);
    else setOpen(true);
  }

  return (
    <>
      <Button size={size} onClick={start} disabled={brands.length === 0}>
        New post
      </Button>
      <BrandPickerDialog open={open} onOpenChange={setOpen} onPick={(b) => navigate(`/posts/new?brand=${b.id}`)} />
    </>
  );
}

export function PostsPage() {
  const { brandName, brands, brandsError, retryBrands, setBrandId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  // The status filter lives in the address (?status=…), so the sidebar's "To approve"
  // and Home's links switch it even when this page is already open.
  const raw = params.get("status");
  const filter: Filter = raw && FILTERS.some((f) => f.value === raw) ? (raw as Filter) : "all";
  const deadlines = useDeadlineOptions();
  const shownFilters = FILTERS.filter((f) => f.value !== "overdue" || deadlines.data?.enabled || filter === "overdue");
  function setFilter(value: Filter) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setParams(next, { replace: true });
  }
  // Home's count tiles link here with ?status=…&brand=… so the list opens already filtered.
  const brandParam = params.get("brand");
  useEffect(() => {
    if (brandParam) setBrandId(brandParam);
  }, [brandParam, setBrandId]);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter]);
  const posts = useWorkspacePosts({
    status: filter === "all" || filter === "overdue" ? undefined : filter,
    overdue: filter === "overdue",
    limit: PAGE_SIZE,
    page,
  });

  const total = posts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader
          eyebrow="Everything your team is working on"
          title="All Posts"
          accent={filter === "pending_approval" ? "To approve" : filter === "overdue" ? "Overdue" : "& Drafts"}
          actions={<NewPostButton size="lg" />}
        />
      </div>

      <Tile className="gap-4 md:col-span-12">
        {/* Phones: one swipeable row that bleeds to the tile edge; wider screens wrap. */}
        <div
          role="tablist"
          aria-label="Filter by status"
          className="-mx-5 flex gap-1 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {shownFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={(e) => {
                setFilter(f.value);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
              }}
              className={cn(
                "h-10 shrink-0 rounded-[10px] border border-transparent px-3.5 whitespace-nowrap text-secondary-foreground transition-colors hover:bg-muted",
                filter === f.value && "border-eyebrow/50 bg-accent font-semibold text-accent-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {posts.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : posts.isError || brandsError ? (
          <LoadError what="your posts" onRetry={() => (brandsError ? retryBrands() : void posts.refetch())} />
        ) : brands.length === 0 ? (
          <EmptyState title="Add a brand first">
            Posts belong to a brand. <Link to="/brands" className="font-semibold text-accent-foreground">Create a brand</Link>{" "}
            to get started.
          </EmptyState>
        ) : (posts.data?.items.length ?? 0) === 0 ? (
          filter === "overdue" ? (
            <EmptyState title="Nothing overdue">Every post waiting for approval is still inside its deadline.</EmptyState>
          ) : (
            <EmptyState title="No posts here yet">Start one with “New post”, or pick a Smart Template.</EmptyState>
          )
        ) : (
          <ul className="flex flex-col">
            {posts.data!.items.map((p) => {
              const when = p.published_at ?? p.scheduled_at;
              const next = NEXT_STEP[p.status] ?? "Open";
              return (
                <li key={p.id}>
                  <Link
                    to={`/posts/${p.id}${p.status === "approved" ? "?schedule=1" : ""}`}
                    className="group flex items-center gap-3 rounded-xl border-t px-2 py-3.5 text-foreground no-underline hover:bg-muted/60 md:gap-4"
                  >
                    <PostThumb post={p} brand={brands.find((b) => b.id === p.brand_id)} className="size-12 self-start md:self-center" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{p.title || "Untitled post"}</span>
                      <span className="line-clamp-1 text-[13px] text-muted-foreground">{p.caption || "No caption yet"}</span>
                      {/* Phones: brand, time and status fold under the title. */}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                        <StatusBadge status={p.status} />
                        <DueChip post={p} />
                        <span>{brandName(p.brand_id)} · {when ? formatDateTime(when) : "Not scheduled"}</span>
                      </span>
                    </div>
                    <span className="hidden w-32 shrink-0 truncate text-[13px] text-muted-foreground md:block">{brandName(p.brand_id)}</span>
                    <span className="hidden w-40 shrink-0 text-[13px] text-muted-foreground md:block">{when ? formatDateTime(when) : "Not scheduled"}</span>
                    <span className="hidden w-44 shrink-0 flex-col items-start gap-1 md:flex">
                      <StatusBadge status={p.status} />
                      <DueChip post={p} />
                    </span>
                    {/* The whole row opens the post; this names what you'll do there. */}
                    <span
                      aria-hidden="true"
                      className="hidden h-9 w-28 shrink-0 items-center justify-center rounded-[10px] border text-sm font-semibold text-accent-foreground group-hover:bg-surface-active lg:inline-flex"
                    >
                      {next}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <span className="text-[13px] text-muted-foreground">
              Page {page} of {pages} · {total} posts
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Tile>
    </BentoGrid>
  );
}
