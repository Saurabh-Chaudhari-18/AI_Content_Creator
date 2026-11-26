import { ArrowRight, Check, Images, Lock, Trash2, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/common";
import { PostThumb } from "@/components/PostThumb";
import { SafeImage } from "@/components/SafeImage";
import { Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import type { Post, SocialAccount } from "@/lib/api";
import { formatDateTime, platformName, type Platform } from "@/lib/format";
import { useWorkspacePosts, type ApprovalLog } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

import { ApprovalActions, ApprovalRecord } from "./ApprovalPanel";
import { CHAR_LIMIT, limitState, PlatformMark, PlatformPreview } from "./parts";
import { DueChip, ReviewPanel } from "./ReviewerDialogs";

type Shown = { caption: string; hashtags: string[]; cta: string | null | undefined };

/**
 * Post Studio while a post waits for approval: the Round 3 "Approval Studio".
 * One post, large and clear, with the decision at the bottom of the card and
 * the facts a reviewer needs (channel fit, who it's with, history) beside it.
 * Nothing here edits the post; editing means withdrawing it first.
 */
export function ReviewStudio({
  post,
  brand,
  brandColor,
  brandStyle,
  channels,
  previewPlatform,
  onPreview,
  shown,
  lengthOn,
  imageUrl,
  mediaCount,
  authorName,
  submitted,
  expiring,
  canApprove,
  canManage,
  approveBlockedReason,
  onDelete,
}: {
  post: Post;
  brand: { id: string; name: string } | undefined;
  brandColor: string;
  brandStyle: CSSProperties;
  channels: Platform[];
  previewPlatform: Platform;
  onPreview: (p: Platform) => void;
  shown: (p: Platform) => Shown;
  lengthOn: (p: Platform) => number;
  imageUrl: string | undefined;
  mediaCount: number;
  authorName: string | undefined;
  submitted: ApprovalLog | undefined;
  expiring: SocialAccount[];
  canApprove: boolean;
  canManage: boolean;
  approveBlockedReason: string | null;
  onDelete: () => void;
}) {
  const { brands, brandName } = useWorkspace();
  const waiting = useWorkspacePosts({ status: "pending_approval", limit: 6 });
  const others = (waiting.data?.items ?? []).filter((p) => p.id !== post.id);
  const total = waiting.data?.total ?? 0;
  const position = (waiting.data?.items ?? []).findIndex((p) => p.id === post.id);
  const title = post.title || "Untitled post";
  const text = shown(previewPlatform);
  const tags = text.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
  const length = lengthOn(previewPlatform);
  const limit = CHAR_LIMIT[previewPlatform]!;

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-7 px-4 pt-6 pb-12 sm:px-8 lg:px-10">
      <PageHeader
        title="Approval Studio"
        accent="Review"
        eyebrow={
          <Link to="/posts?status=pending_approval" className="text-muted-foreground">
            ← Everything waiting for approval
          </Link>
        }
        actions={
          canManage ? (
            <Button variant="ghost" size="icon" aria-label="Delete post" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-6">
          <Tile aria-labelledby="review-title" className="rim gap-6 p-6 sm:p-9">
            <div className="flex flex-wrap gap-2">
              <span className="eyebrow inline-flex h-8 items-center rounded-md border border-eyebrow/50 bg-accent px-3">
                {position >= 0 && total > 1 ? `${position + 1} of ${total} waiting` : "Waiting for approval"}
              </span>
              <span className="inline-flex h-8 items-center gap-2 rounded-md border bg-secondary px-3 text-sm">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: brandColor }} />
                {brand?.name ?? "—"}
              </span>
              {mediaCount > 0 && (
                <span className="inline-flex h-8 items-center gap-2 rounded-md border bg-secondary px-3 text-sm">
                  <Images className="size-3.5 text-eyebrow" aria-hidden="true" />
                  {mediaCount} photo{mediaCount === 1 ? "" : "s"}
                </span>
              )}
              {post.scheduled_at && (
                <span className="inline-flex h-8 items-center gap-2 rounded-full border border-eyebrow/50 bg-accent px-3 text-sm">
                  <span aria-hidden="true" className="size-2 rounded-full bg-eyebrow" />
                  Planned {formatDateTime(post.scheduled_at)}
                </span>
              )}
              <DueChip post={post} className="h-8 px-3 text-sm" />
            </div>

            <div className="border-t pt-6">
              <h2 id="review-title" className="m-0 font-display text-[34px] leading-tight font-medium sm:text-[44px]">
                {title}
              </h2>
              <p className="mt-2 mb-0 font-display text-[17px] text-muted-foreground italic">
                {authorName ? `Written by ${authorName}` : "Sent for review"}
                {submitted ? ` · sent for review ${formatDateTime(submitted.created_at)}` : ""}
              </p>
            </div>

            {/* The post as followers will see it, lit by its own photo */}
            <div className="flex flex-col items-center gap-4 rounded-2xl border bg-surface-subtle px-4 py-6">
              <div role="tablist" aria-label="Preview channel" className="flex items-center gap-1 rounded-xl border bg-background p-1">
                {channels.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    role="tab"
                    aria-selected={previewPlatform === pl}
                    onClick={() => onPreview(pl)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-150",
                      previewPlatform === pl ? "bg-surface-active font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <PlatformMark platform={pl} size="sm" />
                    {platformName(pl)}
                  </button>
                ))}
              </div>
              <div className="relative isolate w-full py-2">
                <div aria-hidden="true" className="preview-glow pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10" style={{ opacity: previewPlatform === "linkedin" ? 0.3 : 1 }}>
                  <SafeImage src={imageUrl} alt="" className="size-full object-cover opacity-90" style={{ filter: "blur(56px) saturate(1.8) brightness(1.45)" }} />
                  <div className="absolute inset-[18%] rounded-full opacity-40" style={{ background: brandColor, filter: "blur(48px)" }} />
                </div>
                <PlatformPreview platform={previewPlatform} accountName={brand?.name ?? "Your brand"} brandStyle={brandStyle} imageUrl={imageUrl} {...text} />
              </div>
            </div>

            <section aria-labelledby="caption-review-h" className="flex flex-col gap-3.5 rounded-2xl border bg-surface-subtle p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="caption-review-h" className="eyebrow m-0 flex-1">
                  Caption on {platformName(previewPlatform)}
                </h3>
                <span className={cn("num text-[13px]", length > limit ? "text-danger" : "text-muted-foreground")}>
                  {length.toLocaleString()} of {limit.toLocaleString()} characters
                </span>
              </div>
              <p className="m-0 rounded-xl border bg-card px-5 py-4 text-[17px] leading-relaxed whitespace-pre-line">
                {text.caption || <span className="text-muted-foreground">No caption.</span>}
              </p>
              {tags.length > 0 && (
                <ul aria-label="Hashtags" className="m-0 flex flex-wrap gap-2 p-0">
                  {tags.map((t) => (
                    <li key={t} className="inline-flex h-9 list-none items-center rounded-md border bg-secondary px-3 text-[15px]">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
              {text.cta && (
                <p className="m-0 text-sm text-secondary-foreground">
                  <span className="text-muted-foreground">Button text:</span> {text.cta}
                </p>
              )}
            </section>

            <div className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm text-secondary-foreground">
              <Lock className="mt-0.5 size-4 shrink-0 text-eyebrow" aria-hidden="true" />
              <span>
                Version {post.version_number} is locked while it waits, so you approve exactly what will be posted.
                {canManage ? " To change it, withdraw it to edit." : ""}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-6">
              <ApprovalActions post={post} canApprove={canApprove} canManage={canManage} approveBlockedReason={approveBlockedReason} size="lg" />
            </div>
          </Tile>

          {others.length > 0 && (
            <section aria-labelledby="next-h" className="overflow-hidden rounded-[var(--radius-tile)] border bg-surface-subtle">
              <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
                <h2 id="next-h" className="eyebrow m-0" style={{ fontSize: 14 }}>
                  Up next
                </h2>
                <span className="inline-flex h-7 items-center rounded-full border border-eyebrow/40 bg-accent px-3 text-[13px] font-semibold text-accent-foreground">
                  {others.length} more waiting
                </span>
              </div>
              <ul className="m-0 flex flex-col p-0">
                {others.slice(0, 3).map((o) => (
                  <li key={o.id} className="list-none border-t first:border-t-0">
                    <Link to={`/posts/${o.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 text-foreground no-underline hover:bg-surface-hover">
                      <PostThumb post={o} brand={brands.find((b) => b.id === o.brand_id)} className="size-16 rounded-xl" />
                      <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                        <span className="font-bold">{o.title || "Untitled post"}</span>
                        <span className="text-sm text-muted-foreground">
                          {brandName(o.brand_id)}
                          {o.scheduled_at ? ` · planned ${formatDateTime(o.scheduled_at)}` : ""}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-accent-foreground">
                        Review next <ArrowRight className="size-4" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside aria-label="About this post" className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
          <Tile aria-labelledby="fit-h" className="gap-3.5 p-6">
            <div>
              <div className="eyebrow">Before you approve</div>
              <h2 id="fit-h" className="m-0 font-display text-[26px] leading-tight font-medium">
                Channel Check
              </h2>
            </div>
            <ul className="m-0 flex flex-col gap-2.5 p-0">
              {channels.map((pl) => {
                const len = lengthOn(pl);
                const lim = CHAR_LIMIT[pl]!;
                const state = pl === "instagram" && !imageUrl ? { tone: "over" as const, label: "Needs a photo" } : limitState(len, lim);
                return (
                  <li key={pl} className="flex list-none items-center gap-3 rounded-xl border bg-secondary px-3.5 py-3">
                    <PlatformMark platform={pl} />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="font-semibold">{platformName(pl)}</span>
                      <span className="num text-xs text-muted-foreground">
                        {len.toLocaleString()} / {lim.toLocaleString()} characters
                      </span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold",
                        state.tone === "over" ? "border-danger-border text-danger" : state.tone === "near" ? "border-warning-border text-warning" : "border-success-border text-success",
                      )}
                    >
                      {state.tone === "ok" && <Check className="size-3.5" aria-hidden="true" />}
                      {state.tone === "ok" ? "Fits" : state.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 border-t pt-3 text-[13px] text-muted-foreground">You pick the exact accounts and time after approving.</p>
            {expiring.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span className="text-secondary-foreground">
                  {expiring.map((a) => platformName(a.platform)).join(", ")} needs a refresh before scheduled posts can go out.{" "}
                  <Link to="/accounts">Fix it</Link>
                </span>
              </div>
            )}
          </Tile>

          <ReviewPanel post={post} brandName={brand?.name ?? "—"} canManage={canManage} />
          <ApprovalRecord post={post} brandName={brand?.name ?? "—"} imageUrl={imageUrl} />
        </aside>
      </div>
    </main>
  );
}
