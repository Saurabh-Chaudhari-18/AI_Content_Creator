import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { adminSend, useAdmin, usePlans, type AdminPlan, type AdminUserList, type AdminWorkspaceList, type SetupLink } from "../api";
import { SetupLinkResult, useSlip, type SlipConfig } from "../ChangeSlip";
import { Chip, fmtDateTime, Pager, PageHead, Region, SelectField, useCrumbs } from "../ui";
import { planOptions } from "./WorkspacesPage";

const LIMIT = 25;

function newLoginSlip(plans: AdminPlan[] | undefined, workspaces: AdminWorkspaceList | undefined): SlipConfig {
  return {
    title: "New login",
    lede: "They get a link to choose their own password. It is shown once after you confirm.",
    fields: [
      { name: "full_name", label: "Full name", required: true, maxLength: 255 },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "dest", label: "Workspace", type: "select", wide: true, value: "new",
        options: [["new", "A new workspace of their own (they become owner)"], ["none", "No workspace for now"], ...(workspaces?.items ?? []).map((w): [string, string] => [w.id, `Join ${w.name}`])],
      },
      { name: "new_workspace_name", label: "New workspace name", required: true, maxLength: 255, show: (v) => v.dest === "new" },
      { name: "plan_key", label: "Plan", type: "select", options: planOptions(plans), value: plans?.find((p) => p.is_default)?.key ?? "", show: (v) => v.dest === "new" },
      { name: "role", label: "Role", type: "select", options: [["member", "Member"], ["admin", "Admin"]], value: "member", show: (v) => v.dest !== "new" && v.dest !== "none" },
    ],
    diff: (v) => [
      ["login", "", v.email],
      v.dest === "new" && ["new workspace", "", v.new_workspace_name || ""],
      v.dest !== "new" && v.dest !== "none" && ["joins", "", `${workspaces?.items.find((w) => w.id === v.dest)?.name ?? ""} as ${v.role}`],
    ],
    action: "CREATE", entity: "User", method: "POST", path: "/users", confirm: "Create login",
    submit: async (v, reason) => {
      const body: Record<string, unknown> = { email: v.email.trim(), full_name: v.full_name.trim() };
      if (v.dest === "new") Object.assign(body, { new_workspace_name: v.new_workspace_name.trim(), plan_key: v.plan_key || null });
      else if (v.dest !== "none") Object.assign(body, { workspace_id: v.dest, role: v.role });
      const res = await adminSend<SetupLink>("POST", "/users", body, reason);
      return <SetupLinkResult link={res.setup_link} email={res.email} expiresAt={res.expires_at} />;
    },
  };
}

export function UsersPage() {
  useCrumbs([["Logins"]]);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const who = params.get("who") ?? "";
  const active = params.get("active") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const [term, setTerm] = useState(q);
  const list = useAdmin<AdminUserList>(["users"], "/users", {
    search: q, staff: who === "staff" ? true : who === "customers" ? false : undefined,
    active: active === "" ? undefined : active === "true", page, limit: LIMIT,
  });
  const plans = usePlans();
  const workspaces = useAdmin<AdminWorkspaceList>(["ws-names"], "/workspaces", { limit: 200 }, { staleTime: 5 * 60_000 });
  const openSlip = useSlip();
  const navigate = useNavigate();
  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!("page" in next)) p.delete("page");
    setParams(p);
  };
  const create = () => openSlip(newLoginSlip(plans.data, workspaces.data));
  const filtered = !!(q || who || active);

  return (
    <>
      <PageHead
        title="Logins"
        accent="Customers"
        lede="Everyone who can sign in, customers and staff. A new login gets a set-password link that is shown once."
        actions={<button className="btn btn--primary" type="button" onClick={create}>New login</button>}
      />
      <form className="toolbar" role="search" aria-label="Filter logins" onSubmit={(e: FormEvent) => { e.preventDefault(); update({ q: term.trim() }); }}>
        <div className="field field--grow">
          <label htmlFor="u-q">Name or email</label>
          <input className="input" id="u-q" type="search" value={term} onChange={(e) => setTerm(e.target.value)} onBlur={() => term.trim() !== q && update({ q: term.trim() })} autoComplete="off" />
        </div>
        <SelectField label="Who" value={who} onChange={(v) => update({ who: v })} options={[["", "Everyone"], ["customers", "Customers"], ["staff", "Platform staff"]]} />
        <SelectField label="Login" value={active} onChange={(v) => update({ active: v })} options={[["", "Active or not"], ["true", "Active"], ["false", "Deactivated"]]} />
      </form>
      <section className="panel" aria-label="Login list">
        <Region
          q={list}
          what="logins"
          rows={8}
          isEmpty={(d) => d.items.length === 0}
          empty={filtered
            ? { title: "No login matches", text: "Nobody has that name or email with these filters.", action: <Link className="btn" to="/admin/users">Clear filters</Link> }
            : { title: "No logins yet", action: <button className="btn btn--primary" type="button" onClick={create}>New login</button> }}
        >
          {(d) => (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th scope="col">Person</th><th scope="col" className="num">Workspaces</th><th scope="col">Platform role</th><th scope="col">Last sign-in</th><th scope="col">Login</th></tr></thead>
                  <tbody>
                    {d.items.map((u) => (
                      <tr key={u.id} data-href onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(`/admin/users/${u.id}`); }}>
                        <td><div className="name"><Link to={`/admin/users/${u.id}`}>{u.full_name}</Link><span>{u.email}</span></div></td>
                        <td className="num">{u.workspace_count}</td>
                        <td>{u.platform_role ? <Chip tone="person">Super admin</Chip> : <span className="muted small">Customer</span>}</td>
                        <td className="mono cool">{u.last_login_at ? fmtDateTime(u.last_login_at) : <span className="muted">Never</span>}</td>
                        <td>{u.is_active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Deactivated</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} limit={LIMIT} total={d.total} noun="logins" onPage={(p) => update({ page: String(p) })} />
            </>
          )}
        </Region>
      </section>
    </>
  );
}
