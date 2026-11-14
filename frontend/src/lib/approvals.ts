/**
 * Approver picker, client approval links and in-app notifications.
 * Plan: docs/client_approval_link_plan.md.
 */
import { useQuery } from "@tanstack/react-query";

import { api, type Schemas } from "./api";
import { useWorkspace } from "./workspace";

export type Approvers = Schemas["ApproversResponse"];
export type ApprovalLinkRow = Schemas["ApprovalLinkResponse"];
export type NewLink = Schemas["NewLinkResponse"];
export type LinkOptions = Schemas["LinkOptionsResponse"];
export type BrandContact = Schemas["BrandContactResponse"];
export type SubmitResult = Schemas["SubmitResponse"];
export type AppNotification = Schemas["NotificationResponse"];
export type NotificationList = Schemas["NotificationListResponse"];

/** A choice in the "Who should approve this?" picker. */
export type ReviewerPick = { kind: "any" } | { kind: "manager"; id: string; name: string } | { kind: "contact"; id: string; name: string };

export const approvalKeys = {
  approvers: (postId?: string) => ["approvers", postId] as const,
  links: (postId?: string) => ["approval-links", postId] as const,
  linkOptions: (wsId?: string) => ["approval-link-options", wsId] as const,
  contacts: (brandId?: string) => ["brand-contacts", brandId] as const,
  notifications: (wsId?: string) => ["notifications", wsId] as const,
  unread: (wsId?: string) => ["notifications-unread", wsId] as const,
};

export function useApprovers(postId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: approvalKeys.approvers(postId),
    queryFn: () => api<Approvers>(`/posts/${postId}/approvers`),
    enabled: !!postId && enabled,
  });
}

export function useApprovalLinks(postId: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: approvalKeys.links(postId),
    queryFn: () => api<ApprovalLinkRow[]>(`/posts/${postId}/approval-links`),
    enabled: !!postId,
    // While a client may be answering, keep the list (and the post) fresh.
    refetchInterval: opts.poll ? 15_000 : false,
  });
}

export function useLinkOptions() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: approvalKeys.linkOptions(workspace?.id),
    queryFn: () => api<LinkOptions>(`/workspaces/${workspace!.id}/approval-link-options`),
    enabled: !!workspace,
  });
}

export function useBrandContacts(brandId: string | undefined, includeRemoved = false) {
  return useQuery({
    queryKey: [...approvalKeys.contacts(brandId), includeRemoved],
    queryFn: () => api<BrandContact[]>(`/brands/${brandId}/contacts`, { query: { include_removed: includeRemoved } }),
    enabled: !!brandId,
  });
}

export function useUnreadCount() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: approvalKeys.unread(workspace?.id),
    queryFn: () => api<Schemas["UnreadCountResponse"]>(`/workspaces/${workspace!.id}/notifications/unread-count`),
    enabled: !!workspace,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useNotifications(enabled: boolean) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: approvalKeys.notifications(workspace?.id),
    queryFn: () => api<NotificationList>(`/workspaces/${workspace!.id}/notifications`, { query: { limit: 30 } }),
    enabled: !!workspace && enabled,
  });
}

// ── Lifetimes & deadlines ──────────────────────────────────────────────
export function describeMinutes(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}

/** "4:30 pm IST, 15 Nov" in the viewer's own time zone, always with its label (D14). */
export function deadlineLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short", timeZone })
    .format(d)
    .replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone }).format(d);
  return `${time}, ${day}`;
}

/** "in 12 minutes", "in 3 hours", "in 2 days" — or "expired". */
export function timeLeft(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `in ${d} days`;
}

// ── Sharing (the agency's own WhatsApp / email: no cost to us) ─────────
export function shareMessage(link: NewLink, brandName: string): string {
  const first = link.recipient_name.split(" ")[0] || link.recipient_name;
  return (
    `Hi ${first}, please review this post for ${brandName}: ${link.url}\n` +
    `Please approve within ${describeMinutes(link.expiry_minutes)} (by ${deadlineLabel(link.expires_at)}).`
  );
}

export function whatsappHref(text: string, phone?: string | null): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoHref(text: string, brandName: string, email?: string | null): string {
  const subject = `Please review a post for ${brandName}`;
  return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

export const LINK_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  not_opened: { label: "Not opened", tone: "neutral" },
  opened: { label: "Opened", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  changes_requested: { label: "Changes requested", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  revoked: { label: "Revoked", tone: "neutral" },
  out_of_date: { label: "Out of date", tone: "neutral" },
};

/** Pending posts assigned to me: the "Waiting for my approval" card. */
export function useMyApprovals() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["ws-posts", workspace?.id, "assigned-to-me"],
    queryFn: () =>
      api<Schemas["PostListResponse"]>(`/workspaces/${workspace!.id}/posts`, { query: { assigned_to: "me", limit: 10 } }),
    enabled: !!workspace,
    refetchInterval: 60_000,
  });
}
