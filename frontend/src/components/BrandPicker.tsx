import { Check } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Brand } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

import { BrandLogo } from "./PostThumb";

/** One button per brand: logo, name and industry. `suggest` floats the best matches to the top. */
export function BrandChoices({
  onPick,
  suggest,
  className,
}: {
  onPick: (brand: Brand) => void;
  /** Brands that fit best (e.g. same industry as a template) come first, marked "Good match". */
  suggest?: (brand: Brand) => boolean;
  className?: string;
}) {
  const { brands } = useWorkspace();
  const ordered = suggest ? [...brands].sort((a, b) => Number(suggest(b)) - Number(suggest(a))) : brands;
  return (
    <ul className={cn("m-0 flex flex-col gap-2 p-0", className)}>
      {ordered.map((b) => (
        <li key={b.id} className="list-none">
          <button
            type="button"
            onClick={() => onPick(b)}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:border-primary/60 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <BrandLogo brand={b} className="size-10 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{b.name}</span>
              {b.industry && <span className="block truncate text-[13px] text-muted-foreground">{humanize(b.industry)}</span>}
            </span>
            {suggest?.(b) && (
              <span className="inline-flex flex-none items-center gap-1 rounded-full border border-success-border bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                <Check className="size-3" aria-hidden="true" /> Good match
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Which brand is this for?" — asked whenever the brand isn't certain. */
export function BrandPickerDialog({
  open,
  onOpenChange,
  title = "Which brand is this post for?",
  description = "The brand’s tone and audience shape the templates you see.",
  onPick,
  suggest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onPick: (brand: Brand) => void;
  suggest?: (brand: Brand) => boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <BrandChoices onPick={onPick} suggest={suggest} />
      </DialogContent>
    </Dialog>
  );
}
