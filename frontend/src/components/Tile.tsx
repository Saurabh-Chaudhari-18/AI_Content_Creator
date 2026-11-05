import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type Tone = "default" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  default: "bg-card border-border",
  info: "bg-info-soft border-info-border text-info",
  success: "bg-success-soft border-success-border text-success",
  warning: "bg-warning-soft border-warning-border text-warning",
  danger: "bg-danger-soft border-danger-border text-danger",
};

/** One bento tile. Span it with `md:col-span-*` / `md:row-span-*`. */
export function Tile({ tone = "default", className, ...props }: ComponentProps<"section"> & { tone?: Tone }) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-[var(--radius-tile)] border p-5 sm:p-6", TONES[tone], className)}
      {...props}
    />
  );
}

/** The 12-column bento grid; collapses to one column on phones. */
export function BentoGrid({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "mx-auto grid max-w-[1360px] auto-rows-[minmax(96px,auto)] grid-cols-1 gap-4 px-4 pt-5 pb-10 sm:px-7 md:grid-cols-12",
        className,
      )}
      {...props}
    />
  );
}
