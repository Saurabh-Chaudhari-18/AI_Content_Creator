import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type Brand, type Workspace } from "./api";

const WS_KEY = "acc-workspace";
const ALL_BRANDS = "all";

type WorkspaceContextValue = {
  workspaces: Workspace[];
  workspace: Workspace | null;
  setWorkspaceId: (id: string) => void;
  brands: Brand[];
  /** "all" or a brand id */
  brandId: string;
  setBrandId: (id: string) => void;
  brandName: (id: string) => string;
  isLoading: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspacesQ = useQuery({ queryKey: ["workspaces"], queryFn: () => api<Workspace[]>("/workspaces") });
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(() => stored(WS_KEY));
  const [brandId, setBrandId] = useState<string>(ALL_BRANDS);

  const workspaces = useMemo(() => workspacesQ.data ?? [], [workspacesQ.data]);
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null;

  const brandsQ = useQuery({
    queryKey: ["brands", workspace?.id],
    queryFn: () => api<Brand[]>(`/workspaces/${workspace!.id}/brands`),
    enabled: !!workspace,
  });
  const brands = useMemo(() => brandsQ.data ?? [], [brandsQ.data]);

  // A brand from another workspace (or a deleted one) must not stay selected.
  useEffect(() => {
    if (brandId !== ALL_BRANDS && brandsQ.isSuccess && !brands.some((b) => b.id === brandId)) {
      setBrandId(ALL_BRANDS);
    }
  }, [brandId, brands, brandsQ.isSuccess]);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    setBrandId(ALL_BRANDS);
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const brandName = useCallback((id: string) => brands.find((b) => b.id === id)?.name ?? "Unknown brand", [brands]);

  const value = useMemo(
    () => ({
      workspaces,
      workspace,
      setWorkspaceId,
      brands,
      brandId,
      setBrandId,
      brandName,
      isLoading: workspacesQ.isLoading,
    }),
    [workspaces, workspace, setWorkspaceId, brands, brandId, brandName, workspacesQ.isLoading],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

export { ALL_BRANDS };
