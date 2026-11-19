import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { EmptyState, LoadError, PageHeader, StatusBadge } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Post } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useWorkspacePosts } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

const FILTERS: { value: Post["status"] | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Waiting for approval" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Didn’t publish" },
];

const PAGE_SIZE = 20;

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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Which brand is this post for?</DialogTitle>
            <DialogDescription>The brand’s tone and audience shape the templates you see.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {brands.map((b) => (
              <Button
                key={b.id}
                variant="outline"
                className="h-12 justify-start"
                onClick={() => navigate(`/posts/new?brand=${b.id}`)}
              >
                <span className="font-semibold">{b.name}</span>
                {b.industry && <span className="text-muted-foreground"> · {b.industry.replace(/_/g, " ")}</span>}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PostsPage() {
  const { brandName, brands, brandsError, retryBrands, setBrandId } = useWorkspace();
  const [params] = useSearchParams();
  const initial = params.get("status") as Post["status"] | null;
  const [filter, setFilter] = useState<Post["status"] | "all">(
    initial && FILTERS.some((f) => f.value === initial) ? initial : "all",
  );
  // Home's count tiles link here with ?status=…&brand=… so the list opens already filtered.
  const brandParam = params.get("brand");
  useEffect(() => {
    if (brandParam) setBrandId(brandParam);
  }, [brandParam, setBrandId]);
  const [page, setPage] = useState(1);
  const posts = useWorkspacePosts({ status: filter === "all" ? undefined : filter, limit: PAGE_SIZE, page });

  const total = posts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader eyebrow="Everything your team is working on" title="Posts" actions={<NewPostButton />} />
      </div>

      <Tile className="gap-4 md:col-span-12">
        {/* Phones: one swipeable row that bleeds to the tile edge; wider screens wrap. */}
        <div
          role="tablist"
          aria-label="Filter by status"
          className="-mx-5 flex gap-1 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={(e) => {
                setFilter(f.value);
                setPage(1);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
              }}
              className={cn(
                "h-9 shrink-0 rounded-lg px-3 whitespace-nowrap text-secondary-foreground transition-colors hover:bg-muted",
                filter === f.value && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
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
          <EmptyState title="No posts here yet">Start one with “New post”, or pick a Smart Template.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {posts.data!.items.map((p) => {
              const thumb = p.media[0];
              const when = p.published_at ?? p.scheduled_at;
              return (
                <li key={p.id}>
                  <Link
                    to={`/posts/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border-t px-2 py-3.5 text-foreground no-underline hover:bg-muted/60 md:gap-4"
                  >
                    {thumb ? (
                      <img src={thumb.media_url} alt="" className="size-12 shrink-0 self-start rounded-lg object-cover md:self-center" />
                    ) : (
                      <span aria-hidden="true" className="size-12 shrink-0 self-start rounded-lg bg-muted md:self-center" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{p.title || "Untitled post"}</span>
                      <span className="line-clamp-1 text-[13px] text-muted-foreground">{p.caption || "No caption yet"}</span>
                      {/* Phones: brand, time and status fold under the title. */}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                        <StatusBadge status={p.status} />
                        <span>{brandName(p.brand_id)} · {when ? formatDateTime(when) : "Not scheduled"}</span>
                      </span>
                    </div>
                    <span className="hidden w-32 shrink-0 truncate text-[13px] text-muted-foreground md:block">{brandName(p.brand_id)}</span>
                    <span className="hidden w-40 shrink-0 text-[13px] text-muted-foreground md:block">{when ? formatDateTime(when) : "Not scheduled"}</span>
                    <span className="hidden w-36 shrink-0 md:block">
                      <StatusBadge status={p.status} />
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
