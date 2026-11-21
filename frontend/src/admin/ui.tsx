/** Building blocks of the staff console. Class names come from admin.css. */
import type { UseQueryResult } from "@tanstack/react-query";
import { createContext, Fragment, useContext, useEffect, useId, type ReactNode } from "react";
import { Link } from "react-router";

import { ApiError } from "@/lib/api";

import { useWorkspaceNames, type AuditRow } from "./api";

// ── Formatting ─────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (v: number) => String(v).padStart(2, "0");
export const num = (v: number) => v.toLocaleString("en-GB");
export const fmtDate = (iso?: string | null) => {
  if (!iso) return "";
  const t = new Date(iso);
  return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
};
export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return "";
  const t = new Date(iso);
  const sameYear = t.getFullYear() === new Date().getFullYear();
  return `${t.getDate()} ${MONTHS[t.getMonth()]}${sameYear ? "" : ` ${t.getFullYear()}`}, ${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
export const fmtShort = (iso?: string | null) => {
  if (!iso) return "";
  const t = new Date(iso);
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`;
};
export const limitText = (v: number | null | undefined) => (v === null || v === undefined ? "Unlimited" : num(v));
/** What a feature value reads as: Off, On, a number or Unlimited. */
export const valueText = (type: string, enabled: boolean, limit: number | null | undefined) =>
  !enabled ? "Off" : type === "limit" ? limitText(limit) : "On";
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");

// ── Page frame ─────────────────────────────────────────────────────────
export type Crumb = [label: string, to?: string];
export const CrumbsContext = createContext<(c: Crumb[]) => void>(() => {});

/** Sets the top bar's trail and the tab title for this screen. */
export function useCrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
    const last = (JSON.parse(key) as Crumb[]).at(-1)?.[0];
    document.title = last ? `${last}, OmniPost staff console` : "OmniPost staff console";
  }, [key, set]);
}

export function PageHead({
  title,
  accent,
  lede,
  actions,
  meta,
}: {
  title: string;
  /** An italic word after the title, as in the customer app: "Plans and limits · Product". */
  accent?: string;
  lede?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="head">
      <div className="head__text">
        <h1>
          {title}
          {accent && <em> · {accent}</em>}
        </h1>
        {lede && <p>{lede}</p>}
        {meta && <div className="head__meta">{meta}</div>}
      </div>
      {actions && <div className="head__actions">{actions}</div>}
    </div>
  );
}

// ── Chips ──────────────────────────────────────────────────────────────
type Tone = "ok" | "bad" | "person" | "cool";
export const Chip = ({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span className={tone ? `chip chip--${tone}` : "chip"} title={title}>{children}</span>
);
export const WsStatus = ({ status }: { status: string }) =>
  status === "suspended" ? <Chip tone="bad">Suspended</Chip> : <Chip tone="ok">Active</Chip>;

// ── Data regions: loading, empty, error, full ──────────────────────────
export function Skeleton({ rows = 5, what }: { rows?: number; what: string }) {
  return (
    <div className="skel" aria-busy="true">
      <span className="visually-hidden">Loading {what}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}><span /><span /><span /><span /></div>
      ))}
    </div>
  );
}

export function ErrorState({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="state state--error" role="alert">
      <h3>{notFound ? `${titleCase(what)} not found` : `Could not load ${what}`}</h3>
      <p>{error instanceof ApiError ? error.message : "The admin API did not answer. Check that the backend is running, then try again."}</p>
      {onRetry && !notFound && <button className="btn" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Region<T>({
  q, what, rows, empty, isEmpty, children,
}: {
  q: UseQueryResult<T>;
  what: string;
  rows?: number;
  empty?: { title: string; text?: string; action?: ReactNode };
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (q.isPending) return <Skeleton rows={rows} what={what} />;
  if (q.isError) return <ErrorState what={what} error={q.error} onRetry={() => void q.refetch()} />;
  if (empty && isEmpty?.(q.data)) return <EmptyState {...empty} />;
  return <>{children(q.data)}</>;
}

// ── Controls ───────────────────────────────────────────────────────────
export function Switch({ checked, label, onClick, disabled, title }: { checked: boolean; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button className="switch" type="button" role="switch" aria-checked={checked} onClick={onClick} disabled={disabled} title={title}>
      <span className="switch__track" aria-hidden="true" />
      {label}
    </button>
  );
}

export function Seg({ legend, value, options, onChange }: { legend: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <fieldset className="seg end">
      <legend>{legend}</legend>
      {options.map(([v, t], i) => (
        <Fragment key={v}>
          <input type="radio" name={id} id={`${id}-${i}`} value={v} checked={value === v} onChange={() => onChange(v)} />
          <label htmlFor={`${id}-${i}`}>{t}</label>
        </Fragment>
      ))}
    </fieldset>
  );
}

export function SelectField({ label, value, options, onChange, name }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; name?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select className="select" id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>
  );
}

export function Pager({ page, limit, total, onPage, noun }: { page: number; limit: number; total: number; onPage: (p: number) => void; noun: string }) {
  const last = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="panel__foot">
      <span>{total === 0 ? `No ${noun}` : `${num(from)} to ${num(to)} of ${num(total)} ${noun}`}</span>
      <div className="pager">
        <button className="btn" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="mono small">Page {page} of {last}</span>
        <button className="btn" type="button" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

// ── Phone tables ───────────────────────────────────────────────────
/**
 * Copies each column head onto its cells as `data-label`, so admin.css can
 * draw a row as a block of labelled values on a phone instead of a table
 * that scrolls sideways. A head that is only visually hidden (an actions
 * column) gives no label. Group rows (one cell spanning the row) are skipped.
 */
export function labelTableCells(root: HTMLElement) {
  root.querySelectorAll<HTMLTableElement>("table.table:not(.matrix)").forEach((table) => {
    const heads = [...table.querySelectorAll<HTMLTableCellElement>("thead th")].map((th) =>
      th.querySelector(".visually-hidden") && !th.textContent?.replace(th.querySelector(".visually-hidden")!.textContent ?? "", "").trim()
        ? ""
        : (th.textContent ?? "").trim(),
    );
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const cells = [...tr.children] as HTMLElement[];
      if (cells.length === 1 && (cells[0] as HTMLTableCellElement).colSpan > 1) return;
      cells.forEach((cell, i) => {
        const want = heads[i] ?? "";
        if (cell.dataset.label !== want) cell.dataset.label = want;
      });
    });
  });
}

// ── Before and after ───────────────────────────────────────────────────
export type DiffRow = [field: string, before: string, after: string];

export function Diff({ rows, caption }: { rows: DiffRow[]; caption?: string }) {
  if (!rows.length) return null;
  return (
    <table className="diff">
      {caption && <caption className="visually-hidden">{caption}</caption>}
      <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="was">{a ? <span>{a}</span> : null}</td>
            <td className="now">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "none";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Audit `changes` as rows. Admin routes store {before, after}; anything else is shown as it is. */
export function changeRows(changes: Record<string, unknown>): { rows: DiffRow[]; context: string[] } {
  const before = (changes.before ?? null) as Record<string, unknown> | null;
  const after = (changes.after ?? null) as Record<string, unknown> | null;
  const context = Object.entries(changes)
    .filter(([k]) => k !== "before" && k !== "after")
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${show(v)}`);
  if (!before && !after) return { rows: [], context };
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const rows: DiffRow[] = keys.map((k) => [
    k.replace(/_/g, " "),
    before && k in before ? show(before[k]) : "",
    after && k in after ? show(after[k]) : after === null ? "removed" : "",
  ]);
  return { rows, context };
}

const ACTION_TEXT: Record<string, string> = {
  CREATE: "created", UPDATE: "updated", DELETE: "removed", PUBLISH: "published", SUBMIT: "submitted",
  APPROVE: "approved", REJECT: "rejected", SCHEDULE: "scheduled", CONNECT: "connected", DISCONNECT: "disconnected",
  INVITE: "added", ROLE_CHANGE: "changed the role on", VIEW: "opened", SUSPEND: "suspended", REACTIVATE: "reactivated",
  PLAN_CHANGE: "changed the plan of", FEATURE_CHANGE: "changed a feature on", SETTING_CHANGE: "changed",
  OWNERSHIP_TRANSFER: "transferred ownership of", SETUP_LINK: "issued a setup link for",
  FORCE_LOGOUT: "signed out every session of", ALERT_UPDATE: "updated an alert on",
  SHARE_LINK: "shared a client approval link for", REVOKE_LINK: "revoked a client approval link for",
  ASSIGN: "changed the reviewer of", CONTACT_CHANGE: "changed a client contact on",
};
export const AUDIT_ACTIONS = Object.keys(ACTION_TEXT);

const ENTITY_TEXT: Record<string, string> = {
  Workspace: "a workspace", WorkspaceMember: "a member", WorkspaceFeatureOverride: "a workspace feature",
  User: "a login", Plan: "a plan", PlanFeature: "a plan value", Feature: "a feature switch",
  PlatformSetting: "a platform setting", CaptionTemplate: "a Smart Template", Post: "a post",
  BrandContact: "a client contact",
};

export function TrailItem({ a }: { a: AuditRow }) {
  const workspaceName = useWorkspaceNames()(a.workspace_id);
  const staff = !!a.actor_platform_role;
  const { rows, context } = changeRows(a.changes as Record<string, unknown>);
  const entityLink = a.entity_type === "User" ? `/admin/users/${a.entity_id}` : null;
  return (
    <li>
      <time dateTime={a.created_at}>{fmtDateTime(a.created_at)}</time>
      <div className="trail__body">
        <div className="trail__line">
          <b className={staff ? "person" : "ink2"}>{a.user_name || a.user_email}</b>
          <span>{ACTION_TEXT[a.action] ?? a.action.toLowerCase()}</span>
          {entityLink ? <Link className="link" to={entityLink}>{ENTITY_TEXT[a.entity_type] ?? a.entity_type}</Link> : <span>{ENTITY_TEXT[a.entity_type] ?? a.entity_type}</span>}
          {context.length > 0 && <span className="muted">({context.join(", ")})</span>}
          {staff && <Chip tone="person">Staff</Chip>}
          {a.workspace_id && <Link className="link small" to={`/admin/workspaces/${a.workspace_id}`}>{workspaceName ?? "Open workspace"}</Link>}
        </div>
        {a.reason && <p className="trail__reason">{a.reason}</p>}
        {rows.length > 0 && (
          <details>
            <summary>What changed</summary>
            <Diff rows={rows} />
          </details>
        )}
        <span className="meta">
          <span className="mono">{a.action}</span> on {a.entity_type}, <span className="mono">{a.entity_id.slice(0, 8)}</span>
          {a.ip_address ? <>, from <span className="mono">{a.ip_address}</span></> : null}
        </span>
      </div>
    </li>
  );
}
