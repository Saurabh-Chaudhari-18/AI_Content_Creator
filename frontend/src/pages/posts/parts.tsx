import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { platformName } from "@/lib/format";

/** Exactly what the backend adapters publish (see SocialPublishAdapter.compose_text). */
export function renderPostText(caption: string, hashtags: string[], cta: string | null | undefined, platform: string): string {
  let text = caption || "";
  if (hashtags.length) text += `\n\n${hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`;
  if (cta) text += `\n\n${platform === "linkedin" ? "🔗" : "👉"} ${cta}`;
  return text;
}

export const CHAR_LIMIT: Record<string, number> = { instagram: 2200, facebook: 63206, linkedin: 3000 };

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
    <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-input bg-card px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1">
          #{tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove #${tag}`}
              className="rounded text-muted-foreground hover:text-foreground"
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
        placeholder={value.length ? "" : "Type a hashtag and press Enter"}
        className="min-w-32 flex-1 bg-transparent px-1 py-1 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** A neutral social-post card — not a copy of any platform's UI. */
export function PostPreview({
  platform,
  accountName,
  text,
  imageUrl,
}: {
  platform: string;
  accountName: string;
  text: string;
  imageUrl?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold">
        <span aria-hidden="true" className="size-6 rounded-full bg-primary/80" />
        {accountName}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{platformName(platform)}</span>
      </div>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="aspect-square w-full object-cover" />
      ) : platform === "instagram" ? (
        <div className="flex aspect-square items-center justify-center bg-muted text-[13px] text-muted-foreground">
          Instagram needs a photo
        </div>
      ) : null}
      <p className="m-0 px-3 py-2.5 text-[13px] whitespace-pre-line">{text || "Your caption will appear here."}</p>
    </div>
  );
}
