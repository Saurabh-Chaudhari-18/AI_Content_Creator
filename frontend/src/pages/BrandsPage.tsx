import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type Brand } from "@/lib/api";
import { humanize, initials } from "@/lib/format";
import { keys, useMyRole, useTemplates } from "@/lib/queries";
import { useWorkspace } from "@/lib/workspace";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
];

type BrandForm = { name: string; industry: string; target_audience: string; tone_of_voice: string; language: string };

function toForm(b?: Brand): BrandForm {
  return {
    name: b?.name ?? "",
    industry: b?.industry ?? "",
    target_audience: b?.target_audience ?? "",
    tone_of_voice: b?.tone_of_voice ?? "",
    language: b?.language ?? "en",
  };
}

export function BrandsPage() {
  const { brands, workspace } = useWorkspace();
  const role = useMyRole();
  const isAdmin = role === "owner" || role === "admin";
  const [editing, setEditing] = useState<Brand | "new" | null>(null);
  const [toRemove, setToRemove] = useState<Brand | null>(null);
  const qc = useQueryClient();

  const deactivate = useMutation({
    mutationFn: (id: string) => api(`/brands/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Brand removed from the list.");
      qc.invalidateQueries({ queryKey: keys.brands(workspace?.id) });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn’t remove it."),
  });

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader
          eyebrow="Who you post for — each brand has its own voice"
          title="Brands"
          actions={<Button onClick={() => setEditing("new")}>Add a brand</Button>}
        />
      </div>

      {brands.length === 0 ? (
        <div className="md:col-span-12">
          <EmptyState title="No brands yet">Add your business, or each client if you’re an agency.</EmptyState>
        </div>
      ) : (
        brands.map((b) => (
          <Tile key={b.id} className="md:col-span-4">
            <div className="flex items-center gap-3">
              {b.logo_url ? (
                <img src={b.logo_url} alt="" className="size-12 rounded-[14px] object-cover" />
              ) : (
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-[14px] bg-accent font-bold text-accent-foreground">
                  {initials(b.name)}
                </span>
              )}
              <div className="flex flex-col">
                <span className="text-base font-semibold">{b.name}</span>
                <span className="text-[13px] text-muted-foreground">
                  {humanize(b.industry) || "No industry set"} · {LANGUAGES.find((l) => l.code === b.language)?.label ?? b.language}
                </span>
              </div>
            </div>
            <dl className="m-0 grid gap-2 text-[13px]">
              <div>
                <dt className="text-muted-foreground">Audience</dt>
                <dd className="m-0">{b.target_audience || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tone of voice</dt>
                <dd className="m-0">{b.tone_of_voice || "—"}</dd>
              </div>
            </dl>
            <div className="mt-auto flex gap-3">
              <button type="button" className="font-semibold text-accent-foreground" onClick={() => setEditing(b)}>
                Edit
              </button>
              {isAdmin && (
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setToRemove(b)}>
                  Remove
                </button>
              )}
            </div>
          </Tile>
        ))
      )}

      {editing && <BrandDialog brand={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {toRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from lists and filters. Its posts and history are kept, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => toRemove && deactivate.mutate(toRemove.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BentoGrid>
  );
}

function BrandDialog({ brand, onClose }: { brand?: Brand; onClose: () => void }) {
  const qc = useQueryClient();
  const { workspace, setBrandId } = useWorkspace();
  const [form, setForm] = useState<BrandForm>(() => toForm(brand));
  const fileRef = useRef<HTMLInputElement>(null);
  const industries = useTemplates({}).data?.industries ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: keys.brands(workspace?.id) });
  const body = () => ({
    name: form.name.trim(),
    industry: form.industry.trim() || null,
    target_audience: form.target_audience.trim() || null,
    tone_of_voice: form.tone_of_voice.trim() || null,
    language: form.language,
  });
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn’t save.");

  const save = useMutation({
    mutationFn: () =>
      brand
        ? api<Brand>(`/brands/${brand.id}`, { method: "PATCH", body: body() })
        : api<Brand>(`/workspaces/${workspace!.id}/brands`, { method: "POST", body: body() }),
    onSuccess: (b) => {
      toast.success(brand ? "Brand updated." : "Brand added.");
      refresh();
      if (!brand) setBrandId(b.id);
      onClose();
    },
    onError,
  });
  const logo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api(`/brands/${brand!.id}/logo`, { method: "POST", body: fd });
    },
    onSuccess: () => {
      toast.success("Logo updated.");
      refresh();
    },
    onError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{brand ? `Edit ${brand.name}` : "Add a brand"}</DialogTitle>
          <DialogDescription>This shapes which Smart Templates you see and how posts are written.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-name">Brand name</Label>
            <Input id="b-name" maxLength={255} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-industry">Industry</Label>
              <Input
                id="b-industry"
                list="industry-options"
                maxLength={100}
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="h-11"
                placeholder="e.g. restaurant"
              />
              <datalist id="industry-options">
                {industries.map((i) => (
                  <option key={i} value={i}>
                    {humanize(i)}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-lang">Language</Label>
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                <SelectTrigger id="b-lang" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-audience">Who is it for?</Label>
            <Textarea
              id="b-audience"
              rows={2}
              maxLength={5000}
              value={form.target_audience}
              onChange={(e) => setForm({ ...form, target_audience: e.target.value })}
              placeholder="e.g. Office workers 25–40 who love specialty coffee"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-tone">Tone of voice</Label>
            <Input
              id="b-tone"
              maxLength={100}
              value={form.tone_of_voice}
              onChange={(e) => setForm({ ...form, tone_of_voice: e.target.value })}
              placeholder="e.g. warm, friendly, a little playful"
              className="h-11"
            />
          </div>
          {brand && (
            <div className="flex items-center gap-3">
              {brand.logo_url ? (
                <img src={brand.logo_url} alt="Current logo" className="size-12 rounded-[14px] object-cover" />
              ) : (
                <span aria-hidden="true" className="size-12 rounded-[14px] bg-muted" />
              )}
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={logo.isPending}>
                {logo.isPending ? "Uploading…" : brand.logo_url ? "Change logo" : "Add logo"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                aria-label="Choose a logo image"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) logo.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
            {brand ? "Save" : "Add brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
