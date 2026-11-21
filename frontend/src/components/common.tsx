import type { ReactNode } from "react";

import { JOB_STATUS, POST_STATUS, TONE_CLASS, TONE_DOT } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = POST_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap", TONE_CLASS[s.tone], className)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[s.tone])} />
      {s.label}
    </span>
  );
}

export function JobBadge({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[s.tone])}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[s.tone])} />
      {s.label}
    </span>
  );
}

/**
 * Title row for a page: a serif h1 (with an optional italic accent word, e.g.
 * "Posting Calendar · This week"), a plain-language line under it, and
 * optional actions on the right.
 */
export function PageHeader({
  eyebrow,
  title,
  accent,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  accent?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="font-display text-[28px] leading-tight font-medium sm:text-[34px]">
          {title}
          {accent && <span className="text-eyebrow italic"> · {accent}</span>}
        </h1>
        {eyebrow && <span className="text-sm text-muted-foreground">{eyebrow}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-tile)] border border-dashed px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-md text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Shown INSTEAD of an empty state when the list failed to load, so a
 * network or server error never reads as "nothing here". */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-[var(--radius-tile)] border border-dashed border-danger/50 px-6 py-12 text-center">
      <p className="m-0 font-semibold">Couldn’t load {what}</p>
      <p className="m-0 max-w-md text-muted-foreground">Check your connection and try again. Nothing you saved is lost.</p>
      <button type="button" onClick={onRetry} className="mt-1 font-semibold text-accent-foreground underline underline-offset-4">
        Try again
      </button>
    </div>
  );
}

/** The one-line version, for small tiles. */
export function InlineLoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="m-0 text-danger">
      Couldn’t load {what}.{" "}
      <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-4">
        Try again
      </button>
    </p>
  );
}

/** A section heading inside a tile. */
export function TileTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="font-display text-[22px] leading-tight font-medium">
      {children}
    </h2>
  );
}
