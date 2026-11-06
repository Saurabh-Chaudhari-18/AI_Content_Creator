import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { authApi, onSessionChange, refreshSession, setAccessToken, type User } from "./api";
import { useTheme, type Theme } from "./theme";

type AuthStatus = "loading" | "signed-in" | "signed-out";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Apply a theme now and save it to the account, so it comes back on the next login. */
  setThemePreference: (theme: Theme) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const { setTheme } = useTheme();
  // Saves run one after another so rapid clicks can't land out of order.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  /** Every way of signing in ends here: remember the user, restore their theme. */
  const signIn = useCallback(
    (u: User) => {
      setUser(u);
      setTheme(u.theme_preference);
      setStatus("signed-in");
    },
    [setTheme],
  );

  // On page load the access token is gone (memory only). If the refresh
  // cookie is still valid, silently start a new session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await refreshSession();
      if (cancelled) return;
      if (!ok) {
        setStatus("signed-out");
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) signIn(me);
      } catch {
        if (!cancelled) setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signIn]);

  // A failed refresh anywhere in the app ends the session here.
  useEffect(
    () =>
      onSessionChange((signedIn) => {
        if (!signedIn) {
          setUser(null);
          setStatus("signed-out");
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setAccessToken(res.access_token);
    signIn(res.user);
  }, [signIn]);

  const register = useCallback(async (fullName: string, email: string, password: string) => {
    const res = await authApi.register(fullName, email, password);
    setAccessToken(res.access_token);
    signIn(res.user);
  }, [signIn]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
    }
  }, []);

  const setThemePreference = useCallback(
    (next: Theme) => {
      setTheme(next); // instant on screen; the save happens in the background
      setUser((u) => (u ? { ...u, theme_preference: next } : u));
      saveChain.current = saveChain.current
        .then(() => authApi.updateMe({ theme_preference: next }))
        .catch(() => toast.error("Couldn’t save your theme to your account. It will still apply on this device."));
    },
    [setTheme],
  );

  const value = useMemo(
    () => ({ status, user, login, register, logout, setThemePreference }),
    [status, user, login, register, logout, setThemePreference],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
