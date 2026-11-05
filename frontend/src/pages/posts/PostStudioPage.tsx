import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmptyState, StatusBadge, TileTitle } from "@/components/common";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type Post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysUntil, humanize, PLATFORMS, platformName, type Platform } from "@/lib/format";
import { keys, useAccounts, useMyRole, useTemplates, type Template } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

import { ApprovalActions, ApprovalHistory } from "./ApprovalPanel";
import { CHAR_LIMIT, HashtagInput, PostPreview, renderPostText } from "./parts";
import { JobsPanel, PublishPanel } from "./PublishPanel";
import { TemplateBrowserDialog, TemplateFillDialog, type TemplateResult } from "./TemplateDialogs";

type Override = { caption?: string | null; hashtags?: string[] | null; cta?: string | null };
type Form = {
  title: string;
  caption: string;
  hashtags: string[];
  cta: string;
  targets: Partial<Record<Platform, Override>>;
};

const EMPTY: Form = { title: "", caption: "", hashtags: [], cta: "", targets: {} };
const LOCKED: Post["status"][] = ["pending_approval", "publishing", "published", "partially_published"];
const NEEDS_REAPPROVAL: Post["status"][] = ["approved", "scheduled"];

function formFromPost(p: Post): Form {
  return {
    title: p.title ?? "",
    caption: p.caption,
    hashtags: p.hashtags,
    cta: p.cta ?? "",
    targets: (p.platform_targets ?? {}) as Form["targets"],
  };
}

function sameForm(a: Form, b: Form): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const STEPS = ["Written", "Approved", "Scheduled", "Published"] as const;
function stepIndex(status: string): number {
  switch (status) {
    case "draft":
      return 0;
    case "pending_approval":
      return 1;
    case "approved":
      return 2;
    case "scheduled":
    case "publishing":
      return 3;
    default:
      return 4;
  }
}

export function PostStudioPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { workspace, brands } = useWorkspace();
  const role = useMyRole();
  const accounts = useAccounts();

  const post = useQuery({
    queryKey: keys.post(id),
    queryFn: () => api<Post>(`/posts/${id}`),
    enabled: !isNew,
    // While a post is about to go out, keep its status fresh.
    refetchInterval: (q) => {
      const p = q.state.data;
      if (!p) return false;
      if (p.status === "publishing") return 5000;
      if (p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at).getTime() - Date.now() < 120_000) return 5000;
      return false;
    },
  });

  const brandId = post.data?.brand_id ?? params.get("brand") ?? undefined;
  const brand = brands.find((b) => b.id === brandId);

  // ── Form state ───────────────────────────────────────────────────────
  const [form, setForm] = useState<Form>(EMPTY);
  const [baseline, setBaseline] = useState<Form>(EMPTY);
  const loadedRef = useRef<string | null>(null);
  const dirty = !sameForm(form, baseline);

  useEffect(() => {
    if (!post.data) return;
    const stamp = `${post.data.id}:${post.data.updated_at}`;
    if (loadedRef.current === stamp) return;
    // Don't overwrite what the user is typing when a background refetch lands.
    if (loadedRef.current?.startsWith(post.data.id) && dirty) return;
    loadedRef.current = stamp;
    const f = formFromPost(post.data);
    setForm(f);
    setBaseline(f);
  }, [post.data, dirty]);

  const status = post.data?.status ?? "draft";
  const editable = isNew || !LOCKED.includes(status);
  const [tab, setTab] = useState<"all" | Platform>("all");

  // ── Roles ────────────────────────────────────────────────────────────
  const isAdmin = role === "owner" || role === "admin";
  const isAuthor = post.data?.created_by === user?.id;
  const canManage = isNew || isAuthor || isAdmin;
  const selfApprovalBlocked = isAuthor && workspace?.allow_self_approval === false;
  const canApprove = !!post.data && isAdmin && !selfApprovalBlocked;
  const approveBlockedReason = !isAdmin
    ? "An owner or admin will review it."
    : selfApprovalBlocked
      ? "Someone else must approve your post."
      : null;

  // ── Mutations ────────────────────────────────────────────────────────
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.post(id) });
    qc.invalidateQueries({ queryKey: ["ws-posts"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };

  function payload(): Record<string, unknown> {
    const targets: Form["targets"] = {};
    for (const p of PLATFORMS) if (form.targets[p]) targets[p] = form.targets[p];
    return {
      title: form.title.trim() || null,
      caption: form.caption,
      hashtags: form.hashtags,
      cta: form.cta.trim() || null,
      platform_targets: targets,
    };
  }

  const create = useMutation({
    mutationFn: () => api<Post>(`/brands/${brandId}/posts`, { method: "POST", body: payload() }),
    onSuccess: (p) => {
      toast.success("Draft saved.");
      qc.invalidateQueries({ queryKey: ["ws-posts"] });
      navigate(`/posts/${p.id}`, { replace: true });
    },
    onError,
  });
  const save = useMutation({
    mutationFn: () => api<Post>(`/posts/${id}`, { method: "PATCH", body: payload() }),
    onSuccess: (p) => {
      qc.setQueryData(keys.post(id), p);
      const f = formFromPost(p);
      loadedRef.current = `${p.id}:${p.updated_at}`;
      setForm(f);
      setBaseline(f);
      toast.success(NEEDS_REAPPROVAL.includes(status) ? "Saved. It needs approval again." : "Saved.");
      invalidate();
    },
    onError,
  });
  const submit = useMutation({
    mutationFn: () => api<Post>(`/posts/${id}/submit`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Sent for approval.");
      invalidate();
      qc.invalidateQueries({ queryKey: keys.history(id) });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/posts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Post deleted.");
      qc.invalidateQueries({ queryKey: ["ws-posts"] });
      navigate("/posts");
    },
    onError,
  });

  const [confirmReapproval, setConfirmReapproval] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function onSave() {
    if (isNew) create.mutate();
    else if (NEEDS_REAPPROVAL.includes(status)) setConfirmReapproval(true);
    else save.mutate();
  }

  // ── Templates ────────────────────────────────────────────────────────
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filling, setFilling] = useState<Template | null>(null);
  const suggestions = useTemplates({ industry: brand?.industry ?? undefined });
  const templateParam = params.get("template");
  const fromLink = useTemplates({});
  useEffect(() => {
    if (!templateParam || !fromLink.data) return;
    const t = fromLink.data.items.find((x) => x.id === templateParam);
    if (t) setFilling(t);
    params.delete("template");
    setParams(params, { replace: true });
  }, [templateParam, fromLink.data, params, setParams]);

  function applyTemplate(r: TemplateResult) {
    setForm((f) => ({
      ...f,
      caption: r.caption,
      hashtags: [...new Set([...f.hashtags, ...r.hashtags])].slice(0, 30),
      cta: f.cta || r.cta || "",
    }));
    setFilling(null);
    setBrowseOpen(false);
  }

  // ── Per-platform text ────────────────────────────────────────────────
  const override = tab === "all" ? undefined : form.targets[tab];
  function setOverride(p: Platform, next: Override | undefined) {
    setForm((f) => {
      const targets = { ...f.targets };
      if (next) targets[p] = next;
      else delete targets[p];
      return { ...f, targets };
    });
  }
  const shown = (p: Platform) => {
    const o = form.targets[p];
    return {
      caption: o?.caption ?? form.caption,
      hashtags: o?.hashtags ?? form.hashtags,
      cta: o && "cta" in o ? o.cta : form.cta || null,
    };
  };
  const previewPlatform: Platform = tab === "all" ? "instagram" : tab;
  const pv = shown(previewPlatform);
  const previewText = renderPostText(pv.caption, pv.hashtags, pv.cta, previewPlatform);

  const expiring = (accounts.data ?? []).filter((a) => {
    const d = daysUntil(a.token_expires_at);
    return a.is_active && (a.needs_reauth || (d !== null && d <= 7));
  });

  // ── Render ───────────────────────────────────────────────────────────
  if (!isNew && post.isLoading) {
    return (
      <BentoGrid>
        <Skeleton className="h-28 md:col-span-12" />
        <Skeleton className="h-96 md:col-span-8" />
        <Skeleton className="h-96 md:col-span-4" />
      </BentoGrid>
    );
  }
  if (!isNew && post.isError) {
    return (
      <BentoGrid>
        <div className="md:col-span-12">
          <EmptyState title="We couldn’t open this post">
            It may have been deleted, or it belongs to another workspace. <Link to="/posts">Back to posts</Link>
          </EmptyState>
        </div>
      </BentoGrid>
    );
  }
  if (isNew && !brand) {
    return (
      <BentoGrid>
        <div className="md:col-span-12">
          <EmptyState title="Pick a brand first">
            Choose a brand in “Showing” at the top, or go to <Link to="/posts">Posts</Link> and press “New post”.
          </EmptyState>
        </div>
      </BentoGrid>
    );
  }

  const p = post.data;
  const step = stepIndex(status);
  const saving = create.isPending || save.isPending;
  const showPublish = p && status === "approved";
  const showJobs = p && ["scheduled", "publishing", "published", "partially_published", "failed"].includes(status);

  return (
    <BentoGrid>
      {/* ── Status bar ─────────────────────────────────────────── */}
      <Tile className="gap-4 md:col-span-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted-foreground">
              <Link to="/posts" className="text-muted-foreground">Posts</Link> · {brand?.name ?? "—"}
              {p ? ` · version ${p.version_number}` : " · new"}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{form.title || (isNew ? "New post" : "Untitled post")}</h1>
              {p && <StatusBadge status={status} />}
              {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button variant={status === "draft" && !dirty && p ? "outline" : "default"} onClick={onSave} disabled={saving || (!dirty && !isNew)}>
                {saving ? "Saving…" : isNew ? "Save draft" : "Save changes"}
              </Button>
            )}
            {p && status === "draft" && (
              <Button
                onClick={() => submit.mutate()}
                disabled={dirty || !form.caption.trim() || submit.isPending}
                title={dirty ? "Save your changes first" : undefined}
              >
                Send for approval
              </Button>
            )}
            {p && status === "pending_approval" && (
              <ApprovalActions post={p} canApprove={canApprove} canManage={canManage} approveBlockedReason={approveBlockedReason} />
            )}
            {p && canManage && status !== "publishing" && (
              <Button variant="ghost" size="icon" aria-label="Delete post" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        <ol aria-label="Progress" className="m-0 grid grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {STEPS.map((s, i) => {
            const done = i < step || (i === 3 && status === "published");
            const current = i === step && status !== "published";
            const failed = i === 3 && (status === "failed" || status === "partially_published");
            return (
              <li
                key={s}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "list-none rounded-[10px] px-3 py-2 text-[13px]",
                  done && "bg-secondary text-secondary-foreground",
                  current && "bg-accent font-semibold text-accent-foreground ring-1 ring-primary",
                  failed && "bg-danger-soft font-semibold text-danger",
                  !done && !current && !failed && "border border-dashed text-muted-foreground",
                )}
              >
                {done ? "✓ " : ""}
                {failed ? (status === "failed" ? "Didn’t publish" : "Partly published") : s}
              </li>
            );
          })}
        </ol>
        {status === "pending_approval" && (
          <p className="m-0 text-[13px] text-muted-foreground">Locked while it waits for approval, so the approver sees exactly what will be posted.</p>
        )}
      </Tile>

      {/* ── Left: composer + photos ────────────────────────────── */}
      <div className="flex flex-col gap-4 md:col-span-8">
        <Tile aria-labelledby="compose-h" className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TileTitle id="compose-h">What do you want to say?</TileTitle>
            <div role="tablist" aria-label="Text for each platform" className="inline-flex flex-wrap gap-1 rounded-[10px] bg-muted p-1">
              {(["all", ...PLATFORMS] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "h-8 rounded-lg px-3 text-[13px] text-muted-foreground",
                    tab === t && "bg-card font-semibold text-foreground shadow-sm",
                  )}
                >
                  {t === "all" ? "Same everywhere" : platformName(t)}
                  {t !== "all" && form.targets[t] ? " •" : ""}
                </button>
              ))}
            </div>
          </div>

          {tab === "all" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Title (only your team sees this)</Label>
                <Input id="title" maxLength={255} value={form.title} disabled={!editable} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-11" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="caption">Caption</Label>
                <Textarea
                  id="caption"
                  rows={7}
                  value={form.caption}
                  disabled={!editable}
                  onChange={(e) => setForm({ ...form, caption: e.target.value })}
                  className="text-base leading-relaxed"
                />
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <button type="button" className="font-medium text-accent-foreground disabled:opacity-50" disabled={!editable} onClick={() => setBrowseOpen(true)}>
                    Start from a Smart Template
                  </button>
                  <span>
                    {renderPostText(form.caption, form.hashtags, form.cta, "instagram").length} of {CHAR_LIMIT.instagram.toLocaleString()} on Instagram
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hashtags">Hashtags</Label>
                <HashtagInput id="hashtags" value={form.hashtags} disabled={!editable} onChange={(h) => setForm({ ...form, hashtags: h })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cta">Button text (call to action)</Label>
                <Input id="cta" maxLength={255} value={form.cta} disabled={!editable} onChange={(e) => setForm({ ...form, cta: e.target.value })} className="h-11" placeholder="e.g. Book your seat" />
              </div>
            </>
          ) : (
            <>
              <label className="flex items-center justify-between gap-4 rounded-[10px] bg-muted px-4 py-3">
                <span>
                  <span className="font-medium">Use different text for {platformName(tab)}</span>
                  <span className="block text-[13px] text-muted-foreground">Off = {platformName(tab)} gets the “Same everywhere” text.</span>
                </span>
                <Switch
                  checked={!!override}
                  disabled={!editable}
                  onCheckedChange={(on) =>
                    setOverride(tab, on ? { caption: form.caption, hashtags: form.hashtags } : undefined)
                  }
                  aria-label={`Use different text for ${platformName(tab)}`}
                />
              </label>
              {override && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="o-caption">{platformName(tab)} caption</Label>
                    <Textarea
                      id="o-caption"
                      rows={6}
                      value={override.caption ?? ""}
                      disabled={!editable}
                      onChange={(e) => setOverride(tab, { ...override, caption: e.target.value })}
                      className="text-base leading-relaxed"
                    />
                    <span className="text-right text-xs text-muted-foreground">
                      {renderPostText(override.caption ?? "", override.hashtags ?? form.hashtags, form.cta, tab).length} of {CHAR_LIMIT[tab]!.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="o-hashtags">{platformName(tab)} hashtags</Label>
                    <HashtagInput id="o-hashtags" value={override.hashtags ?? []} disabled={!editable} onChange={(h) => setOverride(tab, { ...override, hashtags: h })} />
                  </div>
                </>
              )}
            </>
          )}

          {editable && NEEDS_REAPPROVAL.includes(status) && (
            <p className="m-0 text-[13px] text-muted-foreground">This post is approved. If you change anything, it goes back for approval.</p>
          )}
        </Tile>

        <MediaTile post={p} editable={editable} />
      </div>

      {/* ── Right column ───────────────────────────────────────── */}
      <div className="flex flex-col gap-4 md:col-span-4">
        {expiring.length > 0 && (
          <Tile tone="warning">
            <span className="text-[13px] font-semibold">{expiring.map((a) => platformName(a.platform)).join(", ")} needs a refresh</span>
            <span className="text-[13px]">After that, scheduled posts can’t go out.</span>
            <Link to="/accounts" className="font-semibold text-warning">Refresh now</Link>
          </Tile>
        )}
        {showPublish && <PublishPanel post={p} />}
        {showJobs && <JobsPanel post={p} />}
        {p && <ApprovalHistory post={p} />}

        <Tile aria-labelledby="preview-h" className="gap-2.5 p-4 sm:p-4">
          <span id="preview-h" className="px-1 text-[13px] text-muted-foreground">
            How it will look on {platformName(previewPlatform)}
          </span>
          <PostPreview platform={previewPlatform} accountName={brand?.name ?? "Your brand"} text={previewText} imageUrl={p?.media[0]?.media_url} />
        </Tile>

        {editable && (
          <Tile aria-labelledby="tpl-h">
            <TileTitle id="tpl-h">Need a starting point?</TileTitle>
            <p className="m-0 text-muted-foreground">Smart Templates{brand?.industry ? ` for ${humanize(brand.industry).toLowerCase()}` : ""}</p>
            <div className="flex flex-wrap gap-2">
              {(suggestions.data?.items ?? []).slice(0, 4).map((t) => (
                <Button key={t.id} variant="outline" size="sm" className="rounded-full" onClick={() => setFilling(t)}>
                  {t.title}
                </Button>
              ))}
            </div>
            <button type="button" className="self-start text-[13px] font-semibold text-accent-foreground" onClick={() => setBrowseOpen(true)}>
              Browse all templates
            </button>
          </Tile>
        )}
      </div>

      <TemplateBrowserDialog open={browseOpen} industry={brand?.industry} onClose={() => setBrowseOpen(false)} onPick={(t) => setFilling(t)} />
      <TemplateFillDialog key={filling?.id ?? "none"} template={filling} brand={brand} onClose={() => setFilling(null)} onUse={applyTemplate} />

      <AlertDialog open={confirmReapproval} onOpenChange={setConfirmReapproval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save and send back for approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This post is {status === "scheduled" ? "scheduled" : "approved"}. Saving a change moves it back to draft
              {status === "scheduled" ? " and cancels the schedule" : ""}. Someone will need to approve it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => save.mutate()}>Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {status === "scheduled" ? "Its schedule is cancelled too. " : ""}This can’t be undone. Posts already live on social
              media are not removed from there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => remove.mutate()}>
              Delete post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BentoGrid>
  );
}

/** Photos and videos: upload, reorder (carousel order), remove. */
function MediaTile({ post, editable }: { post: Post | undefined; editable: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const media = useMemo(() => [...(post?.media ?? [])].sort((a, b) => a.sort_order - b.sort_order), [post?.media]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.post(post?.id) });
    qc.invalidateQueries({ queryKey: ["ws-posts"] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("post_id", post!.id);
      return api(`/media/upload`, { method: "POST", body: fd });
    },
    onSuccess: () => {
      toast.success("Photo added.");
      refresh();
    },
    onError,
  });
  const removeMedia = useMutation({
    mutationFn: (mediaId: string) => api(`/media/${mediaId}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`/media/reorder`, { method: "PATCH", body: { post_id: post!.id, media_ids: ids } }),
    onSuccess: refresh,
    onError,
  });

  function move(index: number, delta: number) {
    const ids = media.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    reorder.mutate(ids);
  }

  return (
    <Tile aria-labelledby="media-h">
      <TileTitle id="media-h">Photos and videos</TileTitle>
      {!post ? (
        <p className="m-0 text-muted-foreground">Save the draft first, then add photos.</p>
      ) : (
        <>
          <ul className="m-0 flex flex-wrap gap-3 p-0">
            {media.map((m, i) => (
              <li key={m.id} className="flex list-none flex-col gap-1.5">
                {m.media_type === "video" ? (
                  <video src={m.media_url} className="size-28 rounded-xl bg-muted object-cover" muted />
                ) : (
                  <img src={m.media_url} alt={m.alt_text ?? ""} className="size-28 rounded-xl object-cover" />
                )}
                {editable && (
                  <div className="flex justify-center gap-1">
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Move earlier" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                      <ArrowUp className="-rotate-90" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Move later" disabled={i === media.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                      <ArrowDown className="-rotate-90" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Remove photo" onClick={() => removeMedia.mutate(m.id)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {editable && (
              <li className="list-none">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={upload.isPending}
                  className="flex size-28 items-center justify-center rounded-xl border border-dashed bg-muted/40 text-[13px] text-muted-foreground hover:border-primary"
                >
                  {upload.isPending ? "Uploading…" : "Add photo"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                  className="sr-only"
                  aria-label="Choose a photo or video"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                    e.target.value = "";
                  }}
                />
              </li>
            )}
          </ul>
          <p className="m-0 text-xs text-muted-foreground">
            JPG, PNG, WEBP or GIF up to 25 MB; MP4, MOV or WEBM up to 100 MB. Instagram uses the first photo. LinkedIn posts text only for now.
          </p>
        </>
      )}
    </Tile>
  );
}
