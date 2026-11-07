import {
  Bookmark,
  Ellipsis,
  Facebook,
  Forward,
  Globe,
  Heart,
  ImageIcon,
  Instagram,
  Linkedin,
  MessageCircle,
  Repeat2,
  Send,
  ThumbsUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type CSSProperties, type KeyboardEvent } from "react";

import { initials } from "@/lib/brandColor";
import { cn } from "@/lib/utils";

/** Exactly what the backend adapters publish (see SocialPublishAdapter.compose_text). */
export function renderPostText(caption: string, hashtags: string[], cta: string | null | undefined, platform: string): string {
  let text = caption || "";
  if (hashtags.length) text += `\n\n${hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`;
  if (cta) text += `\n\n${platform === "linkedin" ? "🔗" : "👉"} ${cta}`;
  return text;
}

export const CHAR_LIMIT: Record<string, number> = { instagram: 2200, facebook: 63206, linkedin: 3000 };

const PLATFORM_ICON: Record<string, LucideIcon> = { instagram: Instagram, facebook: Facebook, linkedin: Linkedin };

/** The platform's own colour tile, small, as identity. */
export function PlatformMark({ platform, size = "md" }: { platform: string; size?: "sm" | "md" | "lg" }) {
  const Icon = PLATFORM_ICON[platform] ?? Globe;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center text-white",
        `tile-${platform}`,
        size === "sm" ? "size-4 rounded-[4px]" : size === "lg" ? "size-11 rounded-xl" : "size-5 rounded-md",
      )}
    >
      <Icon className={size === "sm" ? "size-2.5" : size === "lg" ? "size-5" : "size-3"} strokeWidth={size === "lg" ? 1.75 : 2} />
    </span>
  );
}

/** How close a text is to a platform's limit: indigo, amber near it, red over it. */
export function limitState(length: number, limit: number): { tone: "ok" | "near" | "over"; label: string } {
  if (length > limit) return { tone: "over", label: `Over by ${(length - limit).toLocaleString()}` };
  if (length >= limit * 0.8) return { tone: "near", label: "Near limit" };
  return { tone: "ok", label: "Ready" };
}

export function LimitRing({ length, limit }: { length: number; limit: number }) {
  const ratio = Math.min(length / limit, 1);
  const shown = length ? Math.max(ratio, 0.04) : 0;
  const { tone } = limitState(length, limit);
  const C = 50.27; // 2πr, r = 8
  return (
    <svg viewBox="0 0 20 20" className="size-[18px] flex-none -rotate-90" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - shown)}
        className={cn(
          "transition-[stroke-dashoffset,stroke] duration-300 ease-out",
          tone === "over" ? "stroke-red-400" : tone === "near" ? "stroke-amber-400" : "stroke-indigo-400",
        )}
      />
    </svg>
  );
}

/** Chips + free text. Enter, comma or space turns the typed word into a hashtag. */
export function HashtagInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#+/, ""))
      .filter(Boolean)
      .filter((t) => !value.includes(t));
    if (tags.length) onChange([...value, ...tags].slice(0, 30));
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-2 rounded-xl border bg-card px-2 py-1.5 transition-colors duration-150 focus-within:border-primary/60",
        disabled && "opacity-60",
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-surface-subtle pr-1 pl-3 text-sm">
          #{tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove #${tag}`}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && commit(draft)}
        placeholder={value.length ? "Add hashtag" : "Type a hashtag and press Enter"}
        className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

type PreviewProps = {
  platform: string;
  accountName: string;
  brandStyle?: CSSProperties;
  caption: string;
  hashtags: string[];
  cta?: string | null;
  imageUrl?: string;
};

function Avatar({ name, style, className }: { name: string; style?: CSSProperties; className?: string }) {
  return (
    <span style={style} className={cn("brand-tile grid flex-none place-items-center text-[11px] font-medium", className)}>
      {initials(name) || "·"}
    </span>
  );
}

function tagLine(hashtags: string[]): string {
  return hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
}

/** The post as followers will see it on each platform. Text is exactly what gets published. */
export function PlatformPreview(props: PreviewProps) {
  const { platform, accountName, brandStyle, caption, hashtags, cta, imageUrl } = props;
  const handle = accountName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const tags = tagLine(hashtags);
  const ctaLine = cta ? `${platform === "linkedin" ? "🔗" : "👉"} ${cta}` : "";
  const empty = !caption && !tags;

  if (platform === "instagram") {
    return (
      <article className="relative mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-white/[0.08] bg-black text-white shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)]">
        <header className="flex h-14 items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <Avatar name={accountName} style={brandStyle} className="size-8 rounded-full" />
            <div className="leading-tight">
              <p className="text-[13px] font-semibold">{handle || "yourbrand"}</p>
              <p className="text-[11px] text-white/60">{accountName}</p>
            </div>
          </div>
          <Ellipsis className="size-5 text-white/80" aria-hidden="true" />
        </header>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="aspect-square w-full bg-zinc-950 object-cover" />
        ) : (
          <div className="grid aspect-square place-items-center bg-zinc-950 text-[13px] text-white/60">
            <span className="flex items-center gap-2">
              <ImageIcon className="size-4" aria-hidden="true" />
              Instagram needs a photo
            </span>
          </div>
        )}
        <div className="flex h-12 items-center justify-between px-3">
          <div className="flex items-center gap-4">
            <Heart className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <MessageCircle className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <Send className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <Bookmark className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="px-3 pb-4 text-[13px] leading-[18px] whitespace-pre-line">
          {empty ? (
            <p className="m-0 text-white/50">Your caption will appear here.</p>
          ) : (
            <>
              <p className="m-0">
                <span className="mr-1 font-semibold">{handle}</span>
                {caption}
              </p>
              {tags && <p className="m-0 mt-1 text-[#e0f1ff]">{tags}</p>}
              {ctaLine && <p className="m-0 mt-1">{ctaLine}</p>}
            </>
          )}
        </div>
      </article>
    );
  }

  if (platform === "facebook") {
    return (
      <article className="relative mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#242526] text-[#e4e6eb] shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)]">
        <header className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Avatar name={accountName} style={brandStyle} className="size-10 rounded-full text-xs" />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold">{accountName}</p>
            <p className="flex items-center gap-1 text-[13px] text-[#b0b3b8]">
              Scheduled post · <Globe className="size-3" aria-hidden="true" />
            </p>
          </div>
        </header>
        <div className="px-4 pb-3 text-[15px] leading-5 whitespace-pre-line">
          {empty ? <span className="text-white/50">Your caption will appear here.</span> : caption}
          {tags && <span className="block text-[#4599ff]">{tags}</span>}
          {ctaLine && <span className="block">{ctaLine}</span>}
        </div>
        {imageUrl && <img src={imageUrl} alt="" className="aspect-square w-full bg-zinc-950 object-cover" />}
        <div className="mx-4 flex h-11 items-center justify-around border-t border-white/10 text-[15px] text-[#b0b3b8]">
          <span className="flex items-center gap-2"><ThumbsUp className="size-[18px]" aria-hidden="true" />Like</span>
          <span className="flex items-center gap-2"><MessageCircle className="size-[18px]" aria-hidden="true" />Comment</span>
          <span className="flex items-center gap-2"><Forward className="size-[18px]" aria-hidden="true" />Share</span>
        </div>
      </article>
    );
  }

  return (
    <article className="relative mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b1f23] text-[#e9e9e9] shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)]">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <Avatar name={accountName} style={brandStyle} className="size-12 rounded-md text-xs" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">{accountName}</p>
          <p className="text-xs text-white/60">Company page</p>
          <p className="flex items-center gap-1 text-xs text-white/60">
            Scheduled · <Globe className="size-3" aria-hidden="true" />
          </p>
        </div>
      </header>
      <div className="px-4 pb-4 text-sm leading-5 whitespace-pre-line">
        {empty ? <span className="text-white/50">Your caption will appear here.</span> : caption}
        {tags && <span className="block text-[#71b7fb]">{tags}</span>}
        {ctaLine && <span className="block">{ctaLine}</span>}
      </div>
      {imageUrl && (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
          <ImageIcon className="mt-px size-3.5 flex-none" aria-hidden="true" />
          The image is not attached on LinkedIn yet. It posts the text only.
        </p>
      )}
      <div className="mx-4 flex h-11 items-center justify-around border-t border-white/10 text-sm text-white/70">
        <span className="flex items-center gap-2"><ThumbsUp className="size-[18px]" aria-hidden="true" />Like</span>
        <span className="flex items-center gap-2"><MessageCircle className="size-[18px]" aria-hidden="true" />Comment</span>
        <span className="flex items-center gap-2"><Repeat2 className="size-[18px]" aria-hidden="true" />Repost</span>
        <span className="flex items-center gap-2"><Send className="size-[18px]" aria-hidden="true" />Send</span>
      </div>
    </article>
  );
}
