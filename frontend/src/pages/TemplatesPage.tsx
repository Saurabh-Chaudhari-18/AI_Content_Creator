import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { EmptyState, PageHeader } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

  /** Open Post Studio with this template, for the brand that fits best. */
  function use(t: Template) {
    const brand =
      (brandId !== ALL_BRANDS && brands.find((b) => b.id === brandId)) ||
      brands.find((b) => b.industry === t.industry) ||
      brands[0];
    if (!brand) return;
    navigate(`/posts/new?brand=${brand.id}&template=${t.id}`);
  }

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader eyebrow="Ready-made captions you fill in for your brand" title="Smart Templates" />
      </div>

      <Tile className="flex-row flex-wrap items-end gap-3 md:col-span-12">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Industry
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="h-10 w-48" aria-label="Industry">
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
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Type
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-44" aria-label="Type">
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
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
          Search
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. offer, launch, festival" className="h-10 max-w-sm" />
        </label>
        <span className="ml-auto text-[13px] text-muted-foreground">{templates.data?.total ?? 0} templates</span>
      </Tile>

      {templates.isLoading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 md:col-span-4" />)
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
    </BentoGrid>
  );
}
