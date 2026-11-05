/** Data hooks shared across screens. Query keys are listed here so mutations can invalidate them. */
import { useQuery } from "@tanstack/react-query";

import { api, type Post, type PostList, type Schemas, type SocialAccount } from "./api";
import { useAuth } from "./auth";
import { ALL_BRANDS, useWorkspace } from "./workspace";

export type Member = Schemas["MemberResponse"];
export type Template = Schemas["CaptionTemplateResponse"];
export type TemplateList = Schemas["CaptionTemplateListResponse"];
export type Job = Schemas["JobResponse"];
export type ApprovalLog = Schemas["ApprovalLogResponse"];
export type Validation = Schemas["ValidateResponse"];
export type CalendarPost = Schemas["CalendarPost"];

export const keys = {
  wsPosts: (wsId?: string) => ["ws-posts", wsId] as const,
  post: (id?: string) => ["post", id] as const,
  history: (id?: string) => ["post-history", id] as const,
  jobs: (id?: string) => ["post-jobs", id] as const,
  accounts: (wsId?: string) => ["accounts", wsId] as const,
  members: (wsId?: string) => ["members", wsId] as const,
  brands: (wsId?: string) => ["brands", wsId] as const,
  calendar: (wsId?: string) => ["calendar", wsId] as const,
  workspaces: () => ["workspaces"] as const,
  usage: (wsId?: string) => ["usage", wsId] as const,
};

/** Workspace-wide posts (optionally one status), honouring the brand filter. */
export function useWorkspacePosts(opts: { status?: Post["status"]; limit?: number; page?: number } = {}) {
  const { workspace, brandId } = useWorkspace();
  const { status, limit = 20, page = 1 } = opts;
  return useQuery({
    queryKey: [...keys.wsPosts(workspace?.id), brandId, status ?? "all", limit, page],
    queryFn: () =>
      api<PostList>(`/workspaces/${workspace!.id}/posts`, {
        query: { status, limit, page, brand_id: brandId === ALL_BRANDS ? undefined : brandId },
      }),
    enabled: !!workspace,
  });
}

export function useAccounts() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: keys.accounts(workspace?.id),
    queryFn: () => api<SocialAccount[]>(`/social/workspaces/${workspace!.id}/accounts`),
    enabled: !!workspace,
  });
}

export function useMembers() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: keys.members(workspace?.id),
    queryFn: () => api<Member[]>(`/workspaces/${workspace!.id}/members`),
    enabled: !!workspace,
  });
}

/** The signed-in user's role in the current workspace. */
export function useMyRole(): "owner" | "admin" | "member" | null {
  const { user } = useAuth();
  const members = useMembers();
  const me = members.data?.find((m) => m.user_id === user?.id);
  return (me?.role as "owner" | "admin" | "member" | undefined) ?? null;
}

export function useTemplates(filters: { industry?: string; category?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ["templates", filters],
    queryFn: () => api<TemplateList>("/templates", { query: filters }),
    staleTime: 5 * 60_000,
  });
}
