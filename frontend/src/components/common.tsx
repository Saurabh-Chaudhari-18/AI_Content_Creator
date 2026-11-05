import type { ReactNode } from "react";

import { JOB_STATUS, POST_STATUS, TONE_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = POST_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE_CLASS[s.tone], className)}>
      {s.label}
    </span>
  );
}

export function JobBadge({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE_CLASS[s.tone])}>
      {s.label}
    </span>
  );
}

/** Title row for a page: small context line, h1, and optional actions on the right. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        {eyebrow && <span className="text-[13px] text-muted-foreground">{eyebrow}</span>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
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

/** A section heading inside a tile. */
export function TileTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-base font-semibold">
      {children}
    </h2>
  );
}
