/**
 * Staff console data: types and fetchers for /api/v1/admin.
 *
 * Every admin query key starts with "admin", so a change made from the
 * console can refresh every admin screen at once (see `useAdminChange`).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { api, type Schemas } from "@/lib/api";

export type Overview = Schemas["AdminOverview"];
export type AdminWorkspace = Schemas["AdminWorkspace"];
export type AdminWorkspaceDetail = Schemas["AdminWorkspaceDetail"];
export type AdminWorkspaceList = Schemas["AdminWorkspaceList"];
export type AdminMember = Schemas["AdminMember"];
export type WorkspaceFeatures = Schemas["AdminWorkspaceFeatures"];
export type WorkspaceFeature = Schemas["AdminWorkspaceFeature"];
export type AdminUser = Schemas["AdminUser"];
export type AdminUserList = Schemas["AdminUserList"];
export type AdminUserDetail = Schemas["AdminUserDetail"];
export type SetupLink = Schemas["SetupLinkResponse"];
export type AdminPlan = Schemas["AdminPlan"];
export type AdminFeature = Schemas["AdminFeature"];
export type AdminSetting = Schemas["AdminSetting"];
export type AdminTemplate = Schemas["CaptionTemplateResponse"];
export type AdminPostList = Schemas["AdminPostList"];
export type AdminSocialAccount = Schemas["AdminSocialAccount"];
export type AdminBrand = Schemas["BrandResponse"];
export type UsageRow = Schemas["UsageRow"];
export type UsageReport = Schemas["UsageReport"];
export type AuditRow = Schemas["AuditRow"];
export type AuditList = Schemas["AuditList"];

type Query = Record<string, string | number | boolean | undefined | null>;

/** GET under /admin. */
export const adminGet = <T,>(path: string, query?: Query) => api<T>(`/admin${path}`, { query });

/** A change under /admin. Every one carries a reason (DELETE sends it as a query parameter). */
export function adminSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: object, reason: string): Promise<T> {
  if (method === "DELETE") return api<T>(`/admin${path}`, { method, query: { reason } });
  return api<T>(`/admin${path}`, { method, body: { ...body, reason } });
}

export function useAdmin<T>(key: readonly unknown[], path: string, query?: Query, opts: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({
    queryKey: ["admin", ...key, path, query ?? {}],
    queryFn: () => adminGet<T>(path, query),
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
  });
}

/** After a change, every admin screen re-reads what it shows. */
export function useAdminChange() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ["admin"] }), [qc]);
}

// Shared lookups used by several screens.
export const usePlans = () => useAdmin<AdminPlan[]>(["plans"], "/plans");
export const useFeatures = () => useAdmin<AdminFeature[]>(["features"], "/features");
export const useOverview = () => useAdmin<Overview>(["overview"], "/overview");

/** Workspace names by id, for screens that only hold an id (the audit trail). */
export function useWorkspaceNames() {
  const q = useAdmin<AdminWorkspaceList>(["ws-names"], "/workspaces", { limit: 200 }, { staleTime: 5 * 60_000 });
  return useCallback((id?: string | null) => (id ? q.data?.items.find((w) => w.id === id)?.name ?? null : null), [q.data]);
}

/** Which usage figure a limit feature is checked against. */
export function usedFor(row: UsageRow, key: string): number | null {
  switch (key) {
    case "max_posts_per_month": return row.posts_in_table_this_month;
    case "max_social_accounts": return row.social_accounts;
    case "max_brands": return row.brands;
    case "max_members": return row.members;
    case "max_storage_mb": return row.media_stored_mb;
    default: return null;
  }
}
