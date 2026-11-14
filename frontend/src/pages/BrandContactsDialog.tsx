/**
 * Saved client contacts for one brand: the people a post can be sent to for
 * approval through a no-login link. Owners and managers edit; members read.
 * Plan: docs/client_approval_link_plan.md §5 (D4, D12).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, type Brand } from "@/lib/api";
import { approvalKeys, useBrandContacts, type BrandContact } from "@/lib/approvals";

type Form = { name: string; role_label: string; phone: string; email: string };
const EMPTY: Form = { name: "", role_label: "", phone: "", email: "" };

export function BrandContactsDialog({ brand, canEdit, onClose }: { brand: Brand; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const contacts = useBrandContacts(brand.id);
  const [editing, setEditing] = useState<BrandContact | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [toRemove, setToRemove] = useState<BrandContact | null>(null);
  const [forget, setForget] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: approvalKeys.contacts(brand.id) });
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

  function startEdit(c: BrandContact | "new") {
    setEditing(c);
    setForm(c === "new" ? EMPTY : { name: c.name, role_label: c.role_label ?? "", phone: c.phone ?? "", email: c.email ?? "" });
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        role_label: form.role_label.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      return editing === "new"
        ? api<BrandContact>(`/brands/${brand.id}/contacts`, { method: "POST", body })
        : api<BrandContact>(`/brands/${brand.id}/contacts/${(editing as BrandContact).id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      toast.success(editing === "new" ? "Contact saved." : "Contact updated.");
      setEditing(null);
      refresh();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: () => api(`/brands/${brand.id}/contacts/${toRemove!.id}`, { method: "DELETE", query: { forget } }),
    onSuccess: () => {
      toast.success(forget ? "Contact removed and their details erased." : "Contact removed.");
      setToRemove(null);
      setForget(false);
      refresh();
    },
    onError,
  });

  const list = contacts.data ?? [];
  const valid = form.name.trim() && (form.phone.trim() || form.email.trim());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Client contacts · {brand.name}</DialogTitle>
          <DialogDescription>
            People at the client who can approve posts with a link, without an account. Members can send links only to these contacts.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-role">Role (optional)</Label>
                <Input id="c-role" maxLength={80} placeholder="Marketing head" value={form.role_label} onChange={(e) => setForm({ ...form, role_label: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-phone">WhatsApp number</Label>
                <Input id="c-phone" inputMode="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <p className="m-0 text-xs text-muted-foreground">Add a phone number with its country code, an email, or both.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button className="btn-depth" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save contact"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {contacts.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!contacts.isLoading && list.length === 0 && (
              <p className="m-0 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No client contacts yet.</p>
            )}
            <ul className="m-0 flex flex-col divide-y p-0">
              {list.map((c) => (
                <li key={c.id} className="flex list-none items-center gap-3 py-2.5">
                  <UserRound className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm">
                      {c.name}
                      {c.role_label && <span className="text-muted-foreground"> · {c.role_label}</span>}
                    </p>
                    <p className="m-0 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {c.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" aria-hidden="true" /> {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3" aria-hidden="true" /> {c.email}
                        </span>
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                        Edit
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setToRemove(c)}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter>
              {canEdit ? (
                <Button className="btn-depth" onClick={() => startEdit("new")}>
                  <Plus aria-hidden="true" /> Add contact
                </Button>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">Only owners and managers can change client contacts.</p>
              )}
            </DialogFooter>
          </>
        )}

        <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {toRemove?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Their open links stop working, and posts waiting for them move to any manager. Their name stays in the approval history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={forget} onCheckedChange={(v) => setForget(v === true)} className="mt-0.5" />
              <span>Also erase their phone number and email (for a data-deletion request)</span>
            </label>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate()}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
