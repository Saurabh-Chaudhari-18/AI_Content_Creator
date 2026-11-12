import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { adminSend, useAdmin, usePlans, type AdminPlan, type AdminWorkspaceDetail, type AdminWorkspaceList } from "../api";
import { useSlip, type SlipConfig } from "../ChangeSlip";
import { Chip, fmtDate, Pager, PageHead, Region, Seg, SelectField, WsStatus, useCrumbs } from "../ui";

const LIMIT = 25;

export const planOptions = (plans: AdminPlan[] | undefined): [string, string][] =>
  (plans ?? []).filter((p) => p.is_active).map((p) => [p.key, `${p.name} (${p.key})`]);

export function newWorkspaceSlip(plans: AdminPlan[] | undefined, onDone: (id: string) => void): SlipConfig {
  const def = plans?.find((p) => p.is_default)?.key ?? "";
  return {
    title: "New workspace",
    lede: "The owner must already have a login. To create both at once, use New login on the Logins screen.",
    fields: [
      { name: "name", label: "Workspace name", required: true, wide: true, maxLength: 255 },
      { name: "owner_email", label: "Owner email", type: "email", required: true },
      { name: "plan_key", label: "Plan", type: "select", options: planOptions(plans), value: def },
    ],
    diff: (v) => [["workspace", "", v.name || "new workspace"], ["owner", "", v.owner_email], ["plan", "", v.plan_key]],
    action: "CREATE",
    entity: "Workspace",
    method: "POST",
    path: "/workspaces",
    confirm: "Create workspace",
    submit: async (v, reason) => {
      const ws = await adminSend<AdminWorkspaceDetail>("POST", "/workspaces", { name: v.name.trim(), owner_email: v.owner_email.trim(), plan_key: v.plan_key || null }, reason);
      onDone(ws.id);
    },
  };
}

export function WorkspacesPage() {
  useCrumbs([["Workspaces"]]);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const plan = params.get("plan") ?? "";
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const [term, setTerm] = useState(q);
  const plans = usePlans();
  const list = useAdmin<AdminWorkspaceList>(["workspaces"], "/workspaces", { search: q, plan, status, page, limit: LIMIT });
  const openSlip = useSlip();
  const navigate = useNavigate();

  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!("page" in next)) p.delete("page");
    setParams(p);
  };
  const filtered = !!(q || plan || status);
  const create = () => openSlip(newWorkspaceSlip(plans.data, (id) => navigate(`/admin/workspaces/${id}`)));

  return (
    <>
      <PageHead
        title="Workspaces"
        lede="Every customer workspace. Workspaces are never deleted here: suspend one instead, so its posts and media stay."
        actions={<button className="btn btn--primary" type="button" onClick={create}>New workspace</button>}
      />
      <form className="toolbar" role="search" aria-label="Filter workspaces" onSubmit={(e: FormEvent) => { e.preventDefault(); update({ q: term.trim() }); }}>
        <div className="field field--grow">
          <label htmlFor="ws-q">Name, slug or owner email</label>
          <input className="input" id="ws-q" type="search" value={term} onChange={(e) => setTerm(e.target.value)} onBlur={() => term.trim() !== q && update({ q: term.trim() })} autoComplete="off" />
        </div>
        <SelectField label="Plan" value={plan} onChange={(v) => update({ plan: v })} options={[["", "Any plan"], ...(plans.data ?? []).map((p): [string, string] => [p.key, p.name])]} />
        <Seg legend="Status" value={status} onChange={(v) => update({ status: v })} options={[["", "All"], ["active", "Active"], ["suspended", "Suspended"]]} />
      </form>
      <section className="panel" aria-label="Workspace list">
        <Region
          q={list}
          what="workspaces"
          rows={8}
          isEmpty={(d) => d.items.length === 0}
          empty={filtered
            ? { title: "No workspace matches", text: "Nothing has that name, slug or owner email with these filters.", action: <Link className="btn" to="/admin/workspaces">Clear filters</Link> }
            : { title: "No workspaces yet", text: "Create the first one for a customer, or wait for someone to sign up.", action: <button className="btn btn--primary" type="button" onClick={create}>New workspace</button> }}
        >
          {(d) => (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th scope="col">Workspace</th><th scope="col">Owner</th><th scope="col">Plan</th><th scope="col" className="num">Members</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
                  <tbody>
                    {d.items.map((w) => (
                      <tr key={w.id} data-href onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(`/admin/workspaces/${w.id}`); }}>
                        <td><div className="name"><Link to={`/admin/workspaces/${w.id}`}>{w.name}</Link><span className="mono">{w.slug}</span></div></td>
                        <td><div className="name"><span className="ink2 small">{w.owner_name}</span><span>{w.owner_email}</span></div></td>
                        <td><Chip>{w.plan_name}</Chip></td>
                        <td className="num">{w.member_count}</td>
                        <td><WsStatus status={w.status} /></td>
                        <td className="mono cool">{fmtDate(w.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} limit={LIMIT} total={d.total} noun="workspaces" onPage={(p) => update({ page: String(p) })} />
            </>
          )}
        </Region>
      </section>
    </>
  );
}
