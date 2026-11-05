/**
 * API client.
 *
 * Security model (matches the backend, see backend/app/api/v1/auth.py):
 * - ACCESS token: short-lived JWT, kept in memory only (never localStorage).
 * - REFRESH token: HttpOnly cookie on /api/v1/auth — JavaScript never sees it.
 * - CSRF: /auth/refresh and /auth/logout need the readable csrf_token cookie
 *   echoed in the X-CSRF-Token header (double-submit).
 * - Refresh tokens ROTATE: a second concurrent /refresh would present an
 *   already-revoked token and log the user out. So refresh is single-flight:
 *   every request that hits 401 at the same moment awaits the SAME promise.
 */
import type { components } from "./api-schema";

export type Schemas = components["schemas"];
export type User = Schemas["UserResponse"];
export type Workspace = Schemas["WorkspaceResponse"];
export type Brand = Schemas["BrandResponse"];
export type Post = Schemas["PostResponse"];
export type PostList = Schemas["PostListResponse"];
export type SocialAccount = Schemas["SocialAccountResponse"];
export type UsageSummary = Schemas["UsageSummaryResponse"];

const API_BASE = "/api/v1";
const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "X-CSRF-Token";

// ── Access token (memory only) ──────────────────────────────────────────
let accessToken: string | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((fn) => fn(token !== null));
}

/** Notified when the session ends (refresh failed) or starts. */
export function onSessionChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Errors ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(humanMessage(status, detail));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI returns `detail` as a string, or a list of field errors on 422. */
function humanMessage(status: number, detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : undefined;
        const msg = (d.msg ?? "is invalid").replace(/^Value error, /, "");
        return field && field !== "body" ? `${String(field)}: ${msg}` : msg;
      })
      .join(" · ");
  }
  if (status === 0) return "Can’t reach the server. Check your connection and try again.";
  if (status === 429) return "Too many attempts. Please wait a little and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request could not be completed.";
}

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// ── Low-level request ──────────────────────────────────────────────────
type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Send the CSRF header (cookie-authenticated auth endpoints). */
  csrf?: boolean;
  /** Internal: don't try to refresh on 401 (auth endpoints themselves). */
  noRefresh?: boolean;
  signal?: AbortSignal;
};

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const url = new URL(API_BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.csrf) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  try {
    return await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, null);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.detail ?? null);
  return data as T;
}

// ── Single-flight refresh ──────────────────────────────────────────────
let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh cookie for a new access token. Never throws. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await rawRequest("/auth/refresh", { method: "POST", csrf: true, noRefresh: true });
        if (!res.ok) {
          setAccessToken(null);
          return false;
        }
        const data = (await res.json()) as Schemas["AccessTokenResponse"];
        setAccessToken(data.access_token);
        return true;
      } catch {
        setAccessToken(null);
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** JSON API call with one transparent retry after a successful refresh. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, opts);
  if (res.status === 401 && !opts.noRefresh && accessToken !== null) {
    if (await refreshSession()) res = await rawRequest(path, opts);
  }
  return parse<T>(res);
}

// ── Auth endpoints ─────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api<Schemas["AuthResponse"]>("/auth/login", { method: "POST", body: { email, password }, noRefresh: true }),
  register: (full_name: string, email: string, password: string) =>
    api<Schemas["AuthResponse"]>("/auth/register", {
      method: "POST",
      body: { full_name, email, password },
      noRefresh: true,
    }),
  logout: () => api<Schemas["MessageResponse"]>("/auth/logout", { method: "POST", csrf: true, noRefresh: true }),
  me: () => api<User>("/auth/me"),
};
