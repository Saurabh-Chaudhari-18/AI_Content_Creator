import type { SocialAccount } from "./api";
import { daysUntil } from "./format";

export type AccountHealth = { label: string; tone: "success" | "warning" | "danger" | "neutral"; days: number | null };

/**
 * One account's state, in the same words the pre-publish check uses: an
 * account that is connected but can't be posted to (plan or a pause on our
 * side) must never read as "Working". Shared by the Accounts page and the
 * sidebar's "to fix" count.
 */
export function accountHealth(a: SocialAccount, canPost: boolean | undefined): AccountHealth {
  const days = daysUntil(a.token_expires_at);
  if (days !== null && days <= 0) return { label: "Expired", tone: "danger", days };
  if (canPost === false) return { label: "Can’t post right now", tone: "danger", days };
  if (a.needs_reauth || (days !== null && days <= 7)) return { label: "Refresh soon", tone: "warning", days };
  return { label: "Working", tone: "success", days };
}
