import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Brand } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useTemplates, type Template } from "@/lib/queries";

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => values[key]?.trim() || `[${humanize(key)}]`);
}

/** Values we can fill for the user from the brand profile. */
function brandDefaults(brand: Brand | undefined): Record<string, string> {
  if (!brand) return {};
  return { brand_hashtag: `#${brand.name.replace(/[^A-Za-z0-9]/g, "")}` };
}

export type TemplateResult = { caption: string; hashtags: string[]; cta: string | null };

/** Fill a template's {{placeholders}} with a live preview. */
export function TemplateFillDialog({
  template,
  brand,
  onClose,
  onUse,
}: {
  template: Template | null;
  brand: Brand | undefined;
  onClose: () => void;
  onUse: (result: TemplateResult) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = template ? placeholdersOf(template.template_text) : [];
  const merged = { ...brandDefaults(brand), ...values };
  const preview = template ? fillTemplate(template.template_text, merged) : "";
  const missing = fields.filter((f) => !merged[f]?.trim());

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template?.title}</DialogTitle>
          <DialogDescription>Fill in the blanks. Anything you leave empty stays as a [placeholder] you can edit later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            {fields.map((f) => (
              <div key={f} className="flex flex-col gap-1.5">
                <Label htmlFor={`tpl-${f}`}>{humanize(f)}</Label>
                <Input
                  id={`tpl-${f}`}
                  value={merged[f] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                />
              </div>
            ))}
            {fields.length === 0 && <p className="text-muted-foreground">This template has nothing to fill in.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Preview</span>
            <p className="m-0 rounded-xl bg-muted p-3 text-[13px] whitespace-pre-line">{preview}</p>
            {template?.suggested_hashtags.length ? (
              <p className="m-0 text-[13px] text-muted-foreground">
                Adds hashtags: {template.suggested_hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
              </p>
            ) : null}
            {template?.suggested_cta && (
              <p className="m-0 text-[13px] text-muted-foreground">Button text: {template.suggested_cta}</p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center gap-3">
          {missing.length > 0 && (
            <span className="mr-auto text-[13px] text-muted-foreground">{missing.length} blank(s) left — that’s fine.</span>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              template &&
              onUse({
                caption: preview,
                hashtags: template.suggested_hashtags.map((h) => h.replace(/^#+/, "")),
                cta: template.suggested_cta ?? null,
              })
            }
          >
            Use this text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Browse every template for an industry (or all), then pick one. */
export function TemplateBrowserDialog({
  open,
  industry,
  onClose,
  onPick,
}: {
  open: boolean;
  industry?: string | null;
  onClose: () => void;
  onPick: (t: Template) => void;
}) {
  const [search, setSearch] = useState("");
  const [onlyIndustry, setOnlyIndustry] = useState(true);
  const filters = useMemo(
    () => ({ industry: onlyIndustry && industry ? industry : undefined, search: search.trim() || undefined }),
    [onlyIndustry, industry, search],
  );
  const templates = useTemplates(filters);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Smart Templates</DialogTitle>
          <DialogDescription>Ready-made captions. Pick one, fill in the blanks, then edit freely.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Search templates"
            placeholder="Search templates"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          {industry && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={onlyIndustry} onChange={(e) => setOnlyIndustry(e.target.checked)} className="size-4" />
              Only {humanize(industry)}
            </label>
          )}
        </div>
        {templates.isLoading ? (
          <Skeleton className="h-40" />
        ) : (templates.data?.items.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">No templates match. Try another search.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.data!.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex h-full w-full flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
                >
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {humanize(t.industry)} · {humanize(t.category)}
                  </span>
                  <span className="line-clamp-3 text-[13px] text-muted-foreground">{fillTemplate(t.template_text, {})}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
