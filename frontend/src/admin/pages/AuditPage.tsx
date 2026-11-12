import { Link, useSearchParams } from "react-router";

import { useAdmin, type AdminWorkspaceList, type AuditList } from "../api";
import { AUDIT_ACTIONS, Pager, PageHead, Region, SelectField, Switch, titleCase, TrailItem, useCrumbs } from "../ui";

const LIMIT = 50;

export function AuditPage() {
  useCrumbs([["Audit trail"]]);
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const ws = params.get("ws") ?? "";
  const staff = params.get("staff") === "1";
  const since = params.get("since") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const q = useAdmin<AuditList>(["audit"], "/audit", {
    action, workspace_id: ws, staff_only: staff || undefined,
    since: since ? new Date(`${since}T00:00:00`).toISOString() : undefined, page, limit: LIMIT,
  });
  const workspaces = useAdmin<AdminWorkspaceList>(["ws-names"], "/workspaces", { limit: 200 }, { staleTime: 5 * 60_000 });
  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!("page" in next)) p.delete("page");
    setParams(p);
  };
  const filtered = !!(action || ws || staff || since);

  return (
    <>
      <PageHead title="Audit trail" lede="Every change on the platform, newest first, with who made it and why. Rows can be added but never changed or deleted." />
      <div className="toolbar">
        <SelectField label="Action" value={action} onChange={(v) => update({ action: v })} options={[["", "Any action"], ...AUDIT_ACTIONS.map((a): [string, string] => [a, titleCase(a)])]} />
        <SelectField label="Workspace" value={ws} onChange={(v) => update({ ws: v })} options={[["", "Any workspace"], ...(workspaces.data?.items ?? []).map((w): [string, string] => [w.id, w.name])]} />
        <div className="field">
          <label htmlFor="au-since">Since</label>
          <input className="input" id="au-since" type="date" value={since} onChange={(e) => update({ since: e.target.value })} />
        </div>
        <div className="end"><Switch checked={staff} label="Staff actions only" onClick={() => update({ staff: staff ? "" : "1" })} /></div>
      </div>
      <section className="panel" aria-label="Audit entries">
        <Region
          q={q}
          what="the audit trail"
          rows={6}
          isEmpty={(d) => d.items.length === 0}
          empty={filtered
            ? { title: "No entries match", text: "Nothing was recorded with these filters.", action: <Link className="btn" to="/admin/audit">Clear filters</Link> }
            : { title: "Nothing recorded yet", text: "Every change made by customers and staff is listed here." }}
        >
          {(d) => (
            <>
              <ol className="trail">{d.items.map((a) => <TrailItem key={a.id} a={a} />)}</ol>
              <Pager page={page} limit={LIMIT} total={d.total} noun="entries" onPage={(p) => update({ page: String(p) })} />
            </>
          )}
        </Region>
      </section>
    </>
  );
}
