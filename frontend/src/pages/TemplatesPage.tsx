import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { BrandPickerDialog } from "@/components/BrandPicker";
import { EmptyState, LoadError, PageHeader } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Brand } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useTemplates, type Template } from "@/lib/queries";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { fillTemplate, placeholdersOf } from "./posts/TemplateDialogs";

const ANY = "any";

export function TemplatesPage() {
  const navigate = useNavigate();
  const { brands, brandId } = useWorkspace();
  const selectedBrand = brands.find((b) => b.id === brandId);
  const [industry, setIndustry] = useState<string>(selectedBrand?.industry ?? ANY);
  const [category, setCategory] = useState<string>(ANY);
  const [search, setSearch] = useState("");

  const filters = useMemo(
    () => ({
      industry: industry === ANY ? undefined : industry,
      category: category === ANY ? undefined : category,
      search: search.trim() || undefined,
    }),
    [industry, category, search],
  );
  const templates = useTemplates(filters);
  const all = useTemplates({});
  const industries = all.data?.industries ?? [];
  const categories = all.data?.categories ?? [];

  // With "All brands" showing and more than one brand, the brand is never
  // guessed: an agency would start a post under the wrong client.
  const [choosingFor, setChoosingFor] = useState<Template | null>(null);
  const start = (brand: Brand, t: Template) => navigate(`/posts/new?brand=${brand.id}&template=${t.id}`);

  /** Open Post Studio with this template, for a brand the user is sure about. */
  function use(t: Template) {
    const selected = brandId !== ALL_BRANDS ? brands.find((b) => b.id === brandId) : undefined;
    const only = brands.length === 1 ? brands[0] : undefined;
    const brand = selected ?? only;
    if (brand) start(brand, t);
    else if (brands.length > 1) setChoosingFor(t);
  }

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader eyebrow="Ready-made captions you fill in for your brand" title="Smart Templates" />
      </div>

      <Tile className="flex-row flex-wrap items-end gap-3 md:col-span-12">
        <label className="flex w-full flex-col gap-1.5 text-[13px] font-medium sm:w-auto">
          Industry
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="h-10 w-full sm:w-48" aria-label="Industry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All industries</SelectItem>
              {industries.map((i) => (
                <SelectItem key={i} value={i}>
                  {humanize(i)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex w-full flex-col gap-1.5 text-[13px] font-medium sm:w-auto">
          Type
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-full sm:w-44" aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All types</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {humanize(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex w-full flex-col gap-1.5 text-[13px] font-medium sm:w-auto sm:flex-1">
          Search
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. offer, launch, festival" className="h-10 sm:max-w-sm" />
        </label>
        <span className="ml-auto text-[13px] text-muted-foreground">{templates.data?.total ?? 0} templates</span>
      </Tile>

      {templates.isLoading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 md:col-span-4" />)
      ) : templates.isError ? (
        <div className="md:col-span-12">
          <LoadError what="templates" onRetry={() => void templates.refetch()} />
        </div>
      ) : (templates.data?.items.length ?? 0) === 0 ? (
        <div className="md:col-span-12">
          <EmptyState title="No templates match">Try another industry or search word.</EmptyState>
        </div>
      ) : (
        templates.data!.items.map((t) => (
          <Tile key={t.id} className="md:col-span-4">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{humanize(t.industry)}</span>
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{humanize(t.category)}</span>
            </div>
            <h2 className="text-base font-semibold">{t.title}</h2>
            <p className="m-0 line-clamp-5 text-[13px] whitespace-pre-line text-muted-foreground">{fillTemplate(t.template_text, {})}</p>
            <p className="m-0 text-xs text-muted-foreground">{placeholdersOf(t.template_text).length} blanks to fill</p>
            <Button className="mt-auto self-start" variant="outline" onClick={() => use(t)} disabled={brands.length === 0}>
              Use this template
            </Button>
          </Tile>
        ))
      )}

      <BrandPickerDialog
        open={choosingFor !== null}
        onOpenChange={(open) => !open && setChoosingFor(null)}
        title="Which brand is this post for?"
        description={choosingFor ? `“${choosingFor.title}” will be filled in with this brand’s details.` : undefined}
        suggest={(b) => !!choosingFor && b.industry === choosingFor.industry}
        onPick={(b) => choosingFor && start(b, choosingFor)}
      />
    </BentoGrid>
  );
}
