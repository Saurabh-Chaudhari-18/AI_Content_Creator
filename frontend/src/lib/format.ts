/** Display helpers shared by every screen: names, status labels, dates. */

export const PLATFORM_NAME: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export const PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function platformName(p: string): string {
  return PLATFORM_NAME[p] ?? p;
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Post status → plain-language label + colour tone. */
export const POST_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Waiting for approval", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  publishing: { label: "Publishing…", tone: "warning" },
  published: { label: "Published", tone: "success" },
  partially_published: { label: "Partly published", tone: "warning" },
  failed: { label: "Didn’t publish", tone: "danger" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  processing: { label: "Sending…", tone: "warning" },
  completed: { label: "Posted", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  needs_review: { label: "Check on the platform", tone: "warning" },
};

export const APPROVAL_ACTION: Record<string, string> = {
  submitted: "Sent for approval",
  approved: "Approved",
  rejected: "Changes requested",
  invalidated: "Back to draft",
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

const dateTime = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : "—";
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** "beauty_salon" → "Beauty salon" */
export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Value for <input type="datetime-local"> in the viewer's own time zone. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** IANA name sent to the API. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Human label for the viewer's zone ("Asia/Calcutta" is the old IANA name some browsers still report). */
export function timeZoneLabel(): string {
  const tz = viewerTimeZone();
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "India time (IST)";
  return tz.replace(/_/g, " ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
