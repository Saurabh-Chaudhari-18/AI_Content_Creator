import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  FileCheck,
  ImagePlus,
  LayoutTemplate,
  Lock,
  PenLine,
  Save,
  ShieldCheck,
  Stamp,
  Trash2,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmptyState, StatusBadge } from "@/components/common";
import { BentoGrid } from "@/components/Tile";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError, type Post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brandColor, brandStyle } from "@/lib/brandColor";
import { daysUntil, humanize, PLATFORMS, platformName, type Platform } from "@/lib/format";
import { keys, useAccounts, useMembers, useMyRole, useTemplates, type Template } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

import { ApprovalActions, ApprovalRecord, usePostHistory } from "./ApprovalPanel";
import { CHAR_LIMIT, HashtagInput, limitState, LimitRing, PlatformMark, PlatformPreview, renderPostText } from "./parts";
import { JobsPanel, PublishPanel } from "./PublishPanel";
import { shortHash } from "./Seal";
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
// Editing these sends the post back to draft (the backend resets them).
const NEEDS_REAPPROVAL: Post["status"][] = ["approved", "scheduled", "failed"];
// The preview and channel cards read left to right in this order.
const CHANNELS: Platform[] = ["instagram", "facebook", "linkedin"];

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

const languageName = (code: string | undefined) => {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

function Banner({ tone, icon: Icon, children }: { tone: "warning" | "success" | "danger"; icon: LucideIcon; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-5",
        tone === "warning" && "border-warning-border bg-warning-soft/60",
        tone === "success" && "border-success-border bg-success-soft/60",
        tone === "danger" && "border-danger-border bg-danger-soft/60",
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 flex-none", tone === "warning" && "text-warning", tone === "success" && "text-success", tone === "danger" && "text-danger")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 text-secondary-foreground">{children}</div>
    </div>
  );
}

function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="m-0 text-sm font-medium">
          {title}
        </h2>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
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
  const members = useMembers();

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
  const history = usePostHistory(isNew ? undefined : id);

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
  const [previewTab, setPreviewTab] = useState<Platform>("instagram");

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
      qc.invalidateQueries({ queryKey: keys.history(id) });
    },
    onError,
  });
  const submit = useMutation({
    mutationFn: () => api<Post>(`/posts/${id}/submit`, { method: "POST" }),
    onSuccess: (p) => {
      toast.success(p.content_hash ? `Sent for approval and sealed ${shortHash(p.content_hash)}.` : "Sent for approval.");
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
  const lengthOn = (p: Platform) => {
    const s = shown(p);
    return [...renderPostText(s.caption, s.hashtags, s.cta, p)].length;
  };
  const previewPlatform: Platform = tab === "all" ? previewTab : tab;

  const expiring = (accounts.data ?? []).filter((a) => {
    const d = daysUntil(a.token_expires_at);
    return a.is_active && (a.needs_reauth || (d !== null && d <= 7));
  });

  const media = useMemo(() => [...(post.data?.media ?? [])].sort((a, b) => a.sort_order - b.sort_order), [post.data?.media]);
  const firstImage = media.find((m) => m.media_type !== "video")?.media_url;

  // ── Render ───────────────────────────────────────────────────────────
  if (!isNew && post.isLoading) {
    return (
      <BentoGrid>
        <Skeleton className="h-16 md:col-span-12" />
        <Skeleton className="h-[480px] md:col-span-7" />
        <Skeleton className="h-[480px] md:col-span-5" />
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
            Choose a brand with the brand button in the left rail, or go to <Link to="/posts">Posts</Link> and press “New post”.
          </EmptyState>
        </div>
      </BentoGrid>
    );
  }

  const p = post.data;
  const saving = create.isPending || save.isPending;
  const showPublish = p && status === "approved";
  const showJobs = p && ["scheduled", "publishing", "published", "partially_published", "failed"].includes(status);
  const latest = history.data?.[0];
  const changesRequested = status === "draft" && latest?.action === "rejected" ? latest : undefined;
  const title = form.title || (isNew ? "New post" : "Untitled post");
  const sealedHash = p && status !== "draft" ? p.content_hash : null;
  const meta = [brand?.name, languageName(brand?.language), brand?.target_audience].filter(Boolean);
  const captionLength = lengthOn(previewPlatform);

  return (
    <div className="flex flex-col lg:h-svh">
      {/* ── Header: where you are, the seal, status, actions ─────── */}
      <header className="sticky top-14 z-20 flex min-h-16 flex-none flex-wrap items-center gap-x-6 gap-y-3 border-b bg-surface-subtle px-4 py-3 sm:px-6 md:top-0">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden truncate sm:inline">{brand?.name ?? "—"}</span>
            <span aria-hidden="true" className="hidden sm:inline">/</span>
            <Link to="/posts" className="text-muted-foreground no-underline hover:text-foreground">
              Posts
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="truncate text-foreground">
              {title}
            </span>
          </nav>
          {p && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="hidden h-7 flex-none items-center gap-2 rounded-md border bg-background px-2 font-mono text-xs text-secondary-foreground md:flex">
                  <Stamp className="size-3.5 text-indigo-400" aria-hidden="true" />
                  <span className="text-foreground">v{p.version_number}</span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="num">{sealedHash ? shortHash(sealedHash) : "not sealed"}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 leading-5">
                The seal is a fingerprint of the caption, hashtags, call to action, media and per-channel wording. Approval is tied to it, and
                publishing checks it again.
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-3" role="status">
          {p && <StatusBadge status={status} />}
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editable && (isNew || dirty) && (
            <Button
              variant={isNew ? "default" : "outline"}
              className={cn(isNew && "btn-depth")}
              onClick={onSave}
              disabled={saving || (!dirty && !isNew)}
            >
              <Save aria-hidden="true" /> {saving ? "Saving…" : isNew ? "Save draft" : "Save changes"}
            </Button>
          )}
          {p && status === "draft" && (
            <Button
              className="btn-depth"
              onClick={() => submit.mutate()}
              disabled={dirty || !form.caption.trim() || submit.isPending}
              title={dirty ? "Save your changes first" : !form.caption.trim() ? "Write a caption first" : undefined}
            >
              <FileCheck aria-hidden="true" /> Send for approval
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
      </header>

      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* ── Composer ──────────────────────────────────────────── */}
        <section aria-label="Write the post" className="border-b lg:w-[55%] lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="m-0 text-2xl leading-8 font-medium">{title}</h1>
                  <p className="m-0 mt-1 text-sm text-muted-foreground">
                    <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: brandColor(brand) }} />
                    {meta.join(" · ")}
                  </p>
                </div>
                {brand?.tone_of_voice && (
                  <span className="flex h-8 flex-none items-center gap-2 rounded-lg border bg-card px-3 text-xs text-secondary-foreground">
                    <span className="text-muted-foreground">Tone</span>
                    {brand.tone_of_voice}
                  </span>
                )}
              </div>

              {status === "pending_approval" && (
                <Banner tone="warning" icon={Lock}>
                  <span className="text-foreground">Version {p?.version_number} is locked while it waits for approval,</span> so the approver sees
                  exactly what will be posted.{canManage ? " Withdraw it to make changes." : ""}
                </Banner>
              )}
              {(status === "approved" || status === "scheduled") && (
                <Banner tone="success" icon={ShieldCheck}>
                  <span className="text-foreground">This version is approved and sealed.</span> Any edit sends it back for approval
                  {status === "scheduled" ? " and cancels the schedule" : ""}.
                </Banner>
              )}
              {status === "failed" && (
                <Banner tone="danger" icon={TriangleAlert}>
                  To post it unchanged, use “Try again”. If you edit it, it goes back for approval.
                </Banner>
              )}
              {changesRequested && (
                <Banner tone="warning" icon={Undo2}>
                  <span className="text-foreground">{members.data?.find((m) => m.user_id === changesRequested.user_id)?.full_name ?? "A reviewer"} asked for changes.</span>
                  {changesRequested.rejection_reason && (
                    <blockquote className="m-0 mt-2 border-l-2 border-warning-border pl-3">{changesRequested.rejection_reason}</blockquote>
                  )}
                  <span className="mt-2 block">Edit the post, save, then send it for approval again.</span>
                </Banner>
              )}
              {expiring.length > 0 && (
                <Banner tone="warning" icon={TriangleAlert}>
                  <span className="text-foreground">{expiring.map((a) => platformName(a.platform)).join(", ")} needs a refresh.</span> After that,
                  scheduled posts can’t go out. <Link to="/accounts">Refresh now</Link>
                </Banner>
              )}
            </div>

            {/* Channels: live length per platform; tap one to give it its own wording */}
            <Section id="channels-h" title="Channels" aside="Tap a channel to give it its own wording">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CHANNELS.map((pl) => {
                  const len = lengthOn(pl);
                  const limit = CHAR_LIMIT[pl]!;
                  const state = pl === "instagram" && !firstImage && p ? { tone: "near" as const, label: "Needs a photo" } : limitState(len, limit);
                  const selected = tab === pl;
                  return (
                    <button
                      key={pl}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setTab(selected ? "all" : pl);
                        setPreviewTab(pl);
                      }}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors duration-150",
                        selected ? "border-primary/60 bg-accent/70" : "bg-card hover:bg-surface-hover",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <PlatformMark platform={pl} />
                          <span className="truncate">{platformName(pl)}</span>
                        </span>
                        <span className={cn("flex-none text-xs", state.tone === "over" ? "text-danger" : state.tone === "near" ? "text-warning" : "text-success")}>
                          {state.label}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="num flex items-center gap-2 font-mono text-secondary-foreground">
                          <LimitRing length={len} limit={limit} />
                          {len.toLocaleString()}
                          <span className="text-muted-foreground">/ {limit >= 10_000 ? `${Math.round(limit / 1000)}k` : limit.toLocaleString()}</span>
                        </span>
                        <span className="text-muted-foreground">{form.targets[pl] ? "Own text" : "Shared"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {tab === "all" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="title">Title (only your team sees this)</Label>
                  <Input id="title" maxLength={255} value={form.title} disabled={!editable} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-11 bg-card" />
                </div>

                <Section id="caption-h" title="Caption" aside="Shared by every channel without its own wording">
                  <div className="rounded-xl border bg-card transition-colors duration-150 focus-within:border-primary/60">
                    <div className="flex h-11 items-center justify-between gap-2 border-b px-2">
                      <Button variant="ghost" size="sm" className="text-secondary-foreground" disabled={!editable} onClick={() => setBrowseOpen(true)}>
                        <LayoutTemplate aria-hidden="true" /> Smart Template
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button variant="ghost" size="sm" className="pointer-events-none text-muted-foreground" disabled>
                              <PenLine aria-hidden="true" /> Rewrite with AI
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Arrives in Phase 2</TooltipContent>
                      </Tooltip>
                    </div>
                    <textarea
                      id="caption"
                      aria-labelledby="caption-h"
                      rows={6}
                      value={form.caption}
                      disabled={!editable}
                      onChange={(e) => setForm({ ...form, caption: e.target.value })}
                      placeholder="What do you want to say?"
                      className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-80"
                    />
                    <div className="flex h-9 items-center justify-between border-t px-4 font-mono text-xs text-muted-foreground">
                      <span className="num">{form.caption.trim() ? form.caption.trim().split(/\s+/).length : 0} words</span>
                      <span className="num">
                        <span className="text-secondary-foreground">{captionLength.toLocaleString()}</span> characters on {platformName(previewPlatform)}
                      </span>
                    </div>
                  </div>
                </Section>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="hashtags">Hashtags</Label>
                  <HashtagInput id="hashtags" value={form.hashtags} disabled={!editable} onChange={(h) => setForm({ ...form, hashtags: h })} />
                  <span className="num text-xs text-muted-foreground">{form.hashtags.length} of 30</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cta">Button text (call to action)</Label>
                  <Input id="cta" maxLength={255} value={form.cta} disabled={!editable} onChange={(e) => setForm({ ...form, cta: e.target.value })} className="h-11 bg-card" placeholder="e.g. Book your seat" />
                </div>
              </>
            ) : (
              <Section id="own-h" title={`${platformName(tab)} wording`}>
                <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
                  <span>
                    <span className="block text-sm">Use different text for {platformName(tab)}</span>
                    <span className="block text-[13px] text-muted-foreground">Off: {platformName(tab)} gets the shared text.</span>
                  </span>
                  <Switch
                    checked={!!override}
                    disabled={!editable}
                    onCheckedChange={(on) => setOverride(tab, on ? { caption: form.caption, hashtags: form.hashtags } : undefined)}
                    aria-label={`Use different text for ${platformName(tab)}`}
                  />
                </div>
                {override && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="o-caption">{platformName(tab)} caption</Label>
                      <textarea
                        id="o-caption"
                        rows={6}
                        value={override.caption ?? ""}
                        disabled={!editable}
                        onChange={(e) => setOverride(tab, { ...override, caption: e.target.value })}
                        className="block w-full resize-y rounded-xl border bg-card px-4 py-3 text-[15px] leading-6 outline-none focus:border-primary/60 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="o-hashtags">{platformName(tab)} hashtags</Label>
                      <HashtagInput id="o-hashtags" value={override.hashtags ?? []} disabled={!editable} onChange={(h) => setOverride(tab, { ...override, hashtags: h })} />
                    </div>
                  </>
                )}
                <Button variant="ghost" size="sm" className="self-start text-secondary-foreground" onClick={() => setTab("all")}>
                  <ArrowLeft aria-hidden="true" /> Back to the shared text
                </Button>
              </Section>
            )}

            <MediaSection post={p} media={media} editable={editable} />

            {editable && (
              <Section
                id="tpl-h"
                title="Start from a template"
                aside={brand?.industry ? `Smart Templates for ${humanize(brand.industry).toLowerCase()}` : "Smart Templates"}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(suggestions.data?.items ?? []).slice(0, 4).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFilling(t)}
                      className="rounded-lg border bg-card px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-hover"
                    >
                      <span className="block text-sm">{t.title}</span>
                      <span className="block text-xs text-muted-foreground">{humanize(t.category)}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="self-start text-[13px] font-medium text-accent-foreground" onClick={() => setBrowseOpen(true)}>
                  Browse all templates <ArrowRight className="inline size-3.5" aria-hidden="true" />
                </button>
              </Section>
            )}
          </div>
        </section>

        {/* ── Preview, publishing, approval record ──────────────── */}
        <section aria-label="Preview and approval" className="bg-surface-subtle lg:w-[45%] lg:overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-8 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div role="tablist" aria-label="Preview channel" className="flex items-center gap-1 rounded-xl border bg-background p-1">
                {CHANNELS.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    role="tab"
                    aria-selected={previewPlatform === pl}
                    onClick={() => {
                      setPreviewTab(pl);
                      if (tab !== "all") setTab(pl);
                    }}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-150",
                      previewPlatform === pl ? "bg-surface-active text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <PlatformMark platform={pl} size="sm" />
                    <span className="hidden sm:inline">{platformName(pl)}</span>
                  </button>
                ))}
              </div>
              <span className="font-mono text-xs text-muted-foreground">{status === "published" ? "Published" : "Not published yet"}</span>
            </div>

            {/* The moment: the post as followers will see it, lit by its own photo */}
            <div className="relative isolate py-4">
              <div aria-hidden="true" className="preview-glow pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 transition-opacity duration-500" style={{ opacity: previewPlatform === "linkedin" ? 0.3 : 1 }}>
                {firstImage && (
                  <img src={firstImage} alt="" className="size-full object-cover opacity-90" style={{ filter: "blur(56px) saturate(1.8) brightness(1.45)" }} />
                )}
                <div className="absolute inset-[18%] rounded-full opacity-40" style={{ background: brandColor(brand), filter: "blur(48px)" }} />
              </div>
              <PlatformPreview
                platform={previewPlatform}
                accountName={brand?.name ?? "Your brand"}
                brandStyle={brandStyle(brand)}
                imageUrl={firstImage}
                {...shown(previewPlatform)}
              />
            </div>

            {showPublish && <PublishPanel post={p} />}
            {showJobs && <JobsPanel post={p} />}
            {p && <ApprovalRecord post={p} brandName={brand?.name ?? "—"} imageUrl={firstImage} />}
          </div>
        </section>
      </div>

      <TemplateBrowserDialog open={browseOpen} industry={brand?.industry} onClose={() => setBrowseOpen(false)} onPick={(t) => setFilling(t)} />
      <TemplateFillDialog key={filling?.id ?? "none"} template={filling} brand={brand} onClose={() => setFilling(null)} onUse={applyTemplate} />

      <AlertDialog open={confirmReapproval} onOpenChange={setConfirmReapproval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save and send back for approval?</AlertDialogTitle>
            <AlertDialogDescription>
              {status === "failed"
                ? "Saving a change moves this post back to draft. Someone will need to approve the new version before it can be posted."
                : `This post is ${status === "scheduled" ? "scheduled" : "approved"}. Saving a change moves it back to draft${
                    status === "scheduled" ? " and cancels the schedule" : ""
                  }. Someone will need to approve it again.`}
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
              {status === "scheduled" ? "Its schedule is cancelled too. " : ""}This can’t be undone. Posts already live on social media are not
              removed from there.
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
    </div>
  );
}

/** Photos and videos: upload, reorder (carousel order), remove. */
function MediaSection({ post, media, editable }: { post: Post | undefined; media: Post["media"]; editable: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

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
    <Section id="media-h" title="Photos and videos" aside={post ? `${media.length} of 10` : undefined}>
      {!post ? (
        <p className="m-0 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Save the draft first, then add photos.</p>
      ) : (
        <>
          <ul className="m-0 grid grid-cols-2 gap-3 p-0 sm:grid-cols-4">
            {media.map((m, i) => (
              <li key={m.id} className="group relative list-none overflow-hidden rounded-xl border bg-card">
                {m.media_type === "video" ? (
                  <video src={m.media_url} className="aspect-square w-full bg-background object-cover" muted />
                ) : (
                  <img src={m.media_url} alt={m.alt_text ?? ""} className="aspect-square w-full object-cover" />
                )}
                <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 font-mono text-[11px] text-white">{i + 1}</span>
                {editable && (
                  <div className="flex justify-center gap-1 border-t p-1">
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Move earlier" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Move later" disabled={i === media.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                      <ArrowRight aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 hover:text-danger" aria-label="Remove photo" onClick={() => removeMedia.mutate(m.id)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {editable && media.length < 10 && (
              <li className="list-none">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={upload.isPending}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-[13px] text-muted-foreground transition-colors duration-150 hover:border-primary/60 hover:text-foreground"
                >
                  <ImagePlus className="size-5" strokeWidth={1.5} aria-hidden="true" />
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
          <p className="m-0 text-xs leading-5 text-muted-foreground">
            JPG, PNG, WEBP or GIF up to 25 MB; MP4, MOV or WEBM up to 100 MB. Location data is removed from photos. Instagram uses the first
            photo; LinkedIn posts text only for now.
          </p>
        </>
      )}
    </Section>
  );
}
