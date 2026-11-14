import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useParams } from "react-router";

import {
  adminSend, useAdmin, useFeatures, usePlans,
  type AdminBrand, type AdminMember, type AdminPostList, type AdminSocialAccount, type AdminWorkspaceDetail,
  type AuditList, type UsageRow, type WorkspaceFeature, type WorkspaceFeatures,
} from "../api";
import { useSlip, type Vals } from "../ChangeSlip";
import {
  Chip, ErrorState, fmtDate, fmtDateTime, fmtShort, limitText, num, Pager, PageHead, Region,
  SelectField, Skeleton, TrailItem, useCrumbs, valueText, WsStatus,
} from "../ui";
import { planOptions } from "./WorkspacesPage";

const TABS: [string, string][] = [
  ["features", "Features"], ["members", "Members"], ["posts", "Posts"],
  ["accounts", "Brands and accounts"], ["usage", "Usage"], ["activity", "Activity"],
];

export function WorkspaceDetailPage() {
  const { id = "", tab = "features" } = useParams();
  const ws = useAdmin<AdminWorkspaceDetail>(["workspace", id], `/workspaces/${id}`);
  const members = useAdmin<AdminMember[]>(["workspace", id, "members"], `/workspaces/${id}/members`);
  const plans = usePlans();
  const openSlip = useSlip();
  const tabLabel = TABS.find((t) => t[0] === tab)?.[1] ?? "Features";
  useCrumbs([["Workspaces", "/admin/workspaces"], [ws.data?.name ?? "Workspace", `/admin/workspaces/${id}`], [tabLabel]]);

  if (ws.isPending) return <Skeleton rows={6} what="the workspace" />;
  if (ws.isError) return <ErrorState what="workspace" error={ws.error} onRetry={() => void ws.refetch()} />;
  const w = ws.data;
  const entity = `Workspace, ${w.name}`;
  const path = `/workspaces/${w.id}`;

  const changePlan = () => openSlip({
    title: `Change the plan of ${w.name}`,
    lede: "Limits change at their next request. Overrides stay in place.",
    fields: [{ name: "plan_key", label: "New plan", type: "select", options: planOptions(plans.data), value: w.plan_key, wide: true }],
    diff: (v) => [v.plan_key !== w.plan_key && ["plan", w.plan_key, v.plan_key]],
    blocked: (v) => (v.plan_key === w.plan_key ? "Pick a different plan." : null),
    action: "PLAN_CHANGE", entity, workspace: true, method: "PATCH", path, confirm: "Change plan",
    submit: (v, reason) => adminSend("PATCH", path, { plan_key: v.plan_key }, reason).then(() => undefined),
  });
  const rename = () => openSlip({
    title: `Rename ${w.name}`,
    fields: [{ name: "name", label: "Name", value: w.name, required: true, wide: true, maxLength: 255 }],
    diff: (v) => [v.name.trim() !== w.name && ["name", w.name, v.name.trim()]],
    blocked: (v) => (v.name.trim() === w.name ? "Type the new name." : null),
    action: "UPDATE", entity, workspace: true, method: "PATCH", path, confirm: "Rename",
    submit: (v, reason) => adminSend("PATCH", path, { name: v.name.trim() }, reason).then(() => undefined),
  });
  const others = (members.data ?? []).filter((m) => m.user_id !== w.owner_id);
  const transfer = () => openSlip({
    title: `Transfer ownership of ${w.name}`,
    lede: "The new owner must already be a member. The old owner stays on as an admin.",
    fields: [{ name: "user", label: "New owner", type: "select", wide: true, value: others[0]?.user_id ?? "", options: others.length ? others.map((m) => [m.user_id, `${m.full_name}, ${m.email}`]) : [["", "No other members yet"]] }],
    diff: (v) => [["owner", w.owner_email, others.find((m) => m.user_id === v.user)?.email ?? ""]],
    blocked: () => (others.length ? null : "Add the new owner as a member first."),
    action: "OWNERSHIP_TRANSFER", entity, workspace: true, method: "POST", path: `${path}/transfer-ownership`, confirm: "Transfer ownership",
    submit: (v, reason) => adminSend("POST", `${path}/transfer-ownership`, { new_owner_user_id: v.user }, reason).then(() => undefined),
  });
  const suspend = () => openSlip({
    title: `Suspend ${w.name}`,
    lede: "Members can still sign in and read. Nothing can be created, scheduled or published until you reactivate it. Nothing is deleted.",
    diff: () => [["status", "active", "suspended"]],
    action: "SUSPEND", entity, workspace: true, method: "POST", path: `${path}/suspend`, confirm: "Suspend workspace", danger: true,
    submit: (_v, reason) => adminSend("POST", `${path}/suspend`, {}, reason).then(() => undefined),
  });
  const reactivate = () => openSlip({
    title: `Reactivate ${w.name}`,
    lede: "Members can create and publish again straight away.",
    diff: () => [["status", "suspended", "active"]],
    action: "REACTIVATE", entity, workspace: true, method: "POST", path: `${path}/reactivate`, confirm: "Reactivate workspace",
    submit: (_v, reason) => adminSend("POST", `${path}/reactivate`, {}, reason).then(() => undefined),
  });

  return (
    <>
      <PageHead
        title={w.name}
        meta={<><span className="mono cool">{w.slug}</span><WsStatus status={w.status} /><Chip>{w.plan_name}</Chip></>}
        actions={
          <>
            <button className="btn" type="button" onClick={rename}>Rename</button>
            <button className="btn" type="button" onClick={changePlan}>Change plan</button>
            <button className="btn" type="button" onClick={transfer}>Transfer ownership</button>
            {w.status === "suspended"
              ? <button className="btn btn--primary" type="button" onClick={reactivate}>Reactivate</button>
              : <button className="btn btn--bad" type="button" onClick={suspend}>Suspend</button>}
          </>
        }
      />
      {w.status === "suspended" && (
        <div className="note note--bad" role="status">
          <div>
            <b>Suspended{w.suspended_at ? ` on ${fmtDate(w.suspended_at)}` : ""}.</b>{w.suspended_reason ? ` “${w.suspended_reason}”` : ""} Members can sign in and read; nothing can be created or published until you reactivate it.
          </div>
        </div>
      )}
      <dl className="facts panel">
        <div><dt>Owner</dt><dd><Link className="link" to={`/admin/users/${w.owner_id}`}>{w.owner_name}</Link><br /><span className="small muted">{w.owner_email}</span></dd></div>
        <div><dt>Plan</dt><dd>{w.plan_name} <span className="mono small cool">{w.plan_key}</span></dd></div>
        <div><dt>Content</dt><dd><span className="mono">{w.brand_count}</span> {w.brand_count === 1 ? "brand" : "brands"}, <span className="mono">{num(w.post_count)}</span> posts, <span className="mono">{w.social_account_count}</span> social accounts</dd></div>
        <div><dt>Created</dt><dd className="mono cool">{fmtDate(w.created_at)}</dd></div>
        {w.approvals && (
          <div>
            <dt>Client approvals, {w.approvals.window_days} days</dt>
            <dd>
              <span className="mono">{num(w.approvals.links_created)}</span> links sent → <span className="mono">{num(w.approvals.links_opened)}</span> opened →{" "}
              <span className="mono">{num(w.approvals.client_approved)}</span> approved, <span className="mono">{num(w.approvals.client_changes_requested)}</span> changes,{" "}
              <span className="mono">{num(w.approvals.links_expired_unanswered)}</span> expired
              <br />
              <span className="small muted">
                Median reply {w.approvals.median_client_response_minutes == null ? "—" : `${Math.round(w.approvals.median_client_response_minutes)} min`} ·{" "}
                {w.approvals.on_behalf_percent == null ? "no assigned approvals" : `${w.approvals.on_behalf_percent}% approved on someone’s behalf`} ·{" "}
                <span className="mono">{w.approvals.saved_contacts}</span> saved client contacts
              </span>
            </dd>
          </div>
        )}
      </dl>
      <nav className="tabs" aria-label="Workspace sections">
        {TABS.map(([k, t]) => (
          <NavLink key={k} to={`/admin/workspaces/${w.id}/${k}`} aria-current={k === tab ? "page" : undefined}>
            {t}{k === "members" && <span className="mono"> {w.member_count}</span>}
          </NavLink>
        ))}
      </nav>
      {tab === "members" ? <MembersTab w={w} members={members} />
        : tab === "posts" ? <PostsTab w={w} />
        : tab === "accounts" ? <AccountsTab w={w} />
        : tab === "usage" ? <UsageTab w={w} />
        : tab === "activity" ? <ActivityTab w={w} />
        : <FeaturesTab w={w} />}
    </>
  );
}

type TabProps = { w: AdminWorkspaceDetail };

// ── Features ─────────────────────────────────────────────────────────
function FeaturesTab({ w }: TabProps) {
  const q = useAdmin<WorkspaceFeatures>(["workspace", w.id, "features"], `/workspaces/${w.id}/features`);
  const openSlip = useSlip();
  const entity = (f: WorkspaceFeature) => `Workspace, ${w.name}, ${f.key}`;

  const override = (f: WorkspaceFeature) => {
    const cur = f.override ?? { enabled: f.plan_enabled, limit: f.plan_limit, expires_at: null };
    const fpath = `/workspaces/${w.id}/features/${f.key}`;
    const nowText = (v: Vals) => (v.enabled === "on" ? (f.value_type === "limit" ? limitText(v.limit === "" ? null : Number(v.limit)) : "On") : "Off");
    openSlip({
      title: `${f.override ? "Edit the override on" : "Override"} ${f.name}`,
      lede: `For ${w.name} only. Their plan gives ${valueText(f.value_type, f.plan_enabled, f.plan_limit)}.`,
      fields: [
        { name: "enabled", label: "They get", type: "select", options: [["on", "On"], ["off", "Off"]], value: cur.enabled ? "on" : "off" },
        ...(f.value_type === "limit" ? [{ name: "limit", label: "Limit", type: "number" as const, min: 0, value: cur.limit === null || cur.limit === undefined ? "" : String(cur.limit), help: "Leave empty for unlimited.", show: (v: Vals) => v.enabled === "on" }] : []),
        { name: "until", label: "Until", type: "date", value: cur.expires_at ? cur.expires_at.slice(0, 10) : "", help: "Leave empty to keep it until removed. Use a date for a trial.", wide: f.value_type !== "limit" },
      ],
      diff: (v) => [
        [f.name.toLowerCase(), valueText(f.value_type, f.enabled, f.limit), nowText(v)],
        !!v.until && ["until", cur.expires_at ? fmtDate(cur.expires_at) : "none", fmtDate(`${v.until}T23:59:59`)],
      ],
      blocked: (v) => (v.enabled === "on" && v.limit !== undefined && v.limit !== "" && (!/^\d+$/.test(v.limit)) ? "The limit must be a whole number, 0 or more." : null),
      action: "FEATURE_CHANGE", entity: entity(f), workspace: true, method: "PUT", path: fpath, confirm: "Save override",
      submit: (v, reason) => adminSend("PUT", fpath, {
        enabled: v.enabled === "on",
        limit: f.value_type === "limit" && v.enabled === "on" && v.limit !== "" ? Number(v.limit) : null,
        expires_at: v.until ? new Date(`${v.until}T23:59:59`).toISOString() : null,
      }, reason).then(() => undefined),
    });
  };
  const remove = (f: WorkspaceFeature) => {
    const fpath = `/workspaces/${w.id}/features/${f.key}`;
    openSlip({
      title: `Remove the override on ${f.name}`,
      lede: `${w.name} goes back to what the ${w.plan_name} plan gives.`,
      diff: () => [[f.name.toLowerCase(), valueText(f.value_type, f.enabled, f.limit), valueText(f.value_type, f.plan_enabled, f.plan_limit)]],
      action: "FEATURE_CHANGE", entity: entity(f), workspace: true, method: "DELETE", path: fpath, confirm: "Remove override", danger: true,
      submit: (_v, reason) => adminSend("DELETE", fpath, {}, reason).then(() => undefined),
    });
  };

  return (
    <section className="panel" aria-labelledby="h-feat">
      <div className="panel__head"><h2 id="h-feat">What this workspace gets</h2><p>Global switch first, then an override, then the plan. Changes apply on their next request.</p></div>
      <Region q={q} what="features" rows={8}>
        {(d) => {
          const cats = [...new Set(d.features.map((f) => f.category))];
          return (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th scope="col">Feature</th><th scope="col">Their plan gives</th><th scope="col">They get now</th><th scope="col">Decided by</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {cats.map((c) => [
                    <tr className="group" key={c}><td colSpan={5}>{c}</td></tr>,
                    ...d.features.filter((f) => f.category === c).map((f) => {
                      const planV = valueText(f.value_type, f.plan_enabled, f.plan_limit);
                      const now = valueText(f.value_type, f.enabled, f.limit);
                      return (
                        <tr key={f.key}>
                          <td><div className="name"><span className="ink2">{f.name}</span><span className="mono">{f.key}</span></div></td>
                          <td className={`mono ${f.source === "override" && now !== planV ? "strike" : "muted"}`}>{planV}</td>
                          <td className={`mono ${f.enabled ? "" : "muted"}`}>{now}</td>
                          <td>
                            {f.source === "global_off" ? <Chip>Off for everyone</Chip>
                              : f.override && !f.override.expired ? (
                                <div className="name">
                                  <span><Chip tone="person">Override{f.override.expires_at ? ` until ${fmtShort(f.override.expires_at)}` : ""}</Chip></span>
                                  <span>Set {fmtDate(f.override.updated_at)}: “{f.override.reason}”</span>
                                </div>
                              ) : f.override?.expired ? (
                                <div className="name"><span><Chip>Plan</Chip> <Chip tone="bad">Override expired {fmtShort(f.override.expires_at)}</Chip></span></div>
                              ) : <Chip>Plan</Chip>}
                          </td>
                          <td>
                            <div className="actions-cell">
                              {f.override ? (
                                <>
                                  <button className="btn btn--ghost" type="button" onClick={() => override(f)}>Edit</button>
                                  <button className="btn btn--ghost btn--bad" type="button" onClick={() => remove(f)}>Remove</button>
                                </>
                              ) : (
                                <button className="btn btn--ghost" type="button" onClick={() => override(f)} disabled={f.source === "global_off"} title={f.source === "global_off" ? "Switched off for everyone. Turn it on in Feature switches first." : undefined}>Override</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
              </table>
            </div>
          );
        }}
      </Region>
    </section>
  );
}

// ── Members ──────────────────────────────────────────────────────────
function MembersTab({ w, members }: TabProps & { members: UseQueryResult<AdminMember[]> }) {
  const openSlip = useSlip();
  const base = `/workspaces/${w.id}/members`;
  const roles: [string, string][] = [["member", "Member"], ["admin", "Admin"]];
  const add = () => openSlip({
    title: `Add a member to ${w.name}`,
    lede: "The person must already have a login. To create one, use New login on the Logins screen.",
    fields: [{ name: "email", label: "Email", type: "email", required: true }, { name: "role", label: "Role", type: "select", options: roles, value: "member" }],
    diff: (v) => [["member", "", v.email], ["role", "", v.role]],
    action: "INVITE", entity: `Workspace, ${w.name}`, workspace: true, method: "POST", path: base, confirm: "Add member",
    submit: (v, reason) => adminSend("POST", base, { email: v.email.trim(), role: v.role }, reason).then(() => undefined),
  });
  const role = (m: AdminMember) => openSlip({
    title: `Change the role of ${m.full_name}`,
    fields: [{ name: "role", label: "Role", type: "select", options: roles, value: m.role, wide: true }],
    diff: (v) => [v.role !== m.role && ["role", m.role, v.role]],
    blocked: (v) => (v.role === m.role ? "Pick a different role." : null),
    action: "ROLE_CHANGE", entity: `Member, ${m.email}`, workspace: true, method: "PATCH", path: `${base}/${m.user_id}`, confirm: "Change role",
    submit: (v, reason) => adminSend("PATCH", `${base}/${m.user_id}`, { role: v.role }, reason).then(() => undefined),
  });
  const remove = (m: AdminMember) => openSlip({
    title: `Remove ${m.full_name} from ${w.name}`,
    lede: "Their login stays; they lose access to this workspace. Posts they wrote stay.",
    diff: () => [["member", m.email, "removed"]],
    action: "DELETE", entity: `Member, ${m.email}`, workspace: true, method: "DELETE", path: `${base}/${m.user_id}`, confirm: "Remove member", danger: true,
    submit: (_v, reason) => adminSend("DELETE", `${base}/${m.user_id}`, {}, reason).then(() => undefined),
  });
  return (
    <section className="panel" aria-labelledby="h-mem">
      <div className="panel__head"><h2 id="h-mem">Members</h2><button className="btn" type="button" onClick={add}>Add member</button></div>
      <Region q={members} what="members" rows={4}>
        {(list) => (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col">Login</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.user_id}>
                    <td><div className="name"><Link to={`/admin/users/${m.user_id}`}>{m.full_name}</Link><span>{m.email}</span></div></td>
                    <td>{m.role === "owner" ? <Chip tone="person">Owner</Chip> : <Chip>{m.role === "admin" ? "Admin" : "Member"}</Chip>}</td>
                    <td className="mono cool">{fmtDate(m.joined_at)}</td>
                    <td>{m.is_active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Deactivated</Chip>}</td>
                    <td>
                      <div className="actions-cell">
                        {m.role === "owner" ? (
                          <button className="btn btn--ghost" type="button" disabled title="Transfer ownership to change the owner">Change role</button>
                        ) : (
                          <>
                            <button className="btn btn--ghost" type="button" onClick={() => role(m)}>Change role</button>
                            <button className="btn btn--ghost btn--bad" type="button" onClick={() => remove(m)}>Remove</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Region>
    </section>
  );
}

// ── Posts (read-only) ────────────────────────────────────────────────
const POST_STATUS: Record<string, [string, "ok" | "bad" | "person" | "cool" | undefined]> = {
  draft: ["Draft", undefined], pending_approval: ["Waiting for approval", "person"], approved: ["Approved", "cool"],
  scheduled: ["Scheduled", "cool"], publishing: ["Publishing", "cool"], published: ["Published", "ok"],
  partially_published: ["Partly published", "bad"], failed: ["Failed", "bad"],
};
function PostsTab({ w }: TabProps) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  // Each load is recorded as a staff view, so keep results for a while.
  const q = useAdmin<AdminPostList>(["workspace", w.id, "posts"], `/workspaces/${w.id}/posts`, { status, page, limit: 25 }, { staleTime: 5 * 60_000 });
  return (
    <>
      <div className="note">Read-only. You can see this workspace’s posts but never write, approve or publish one. Opening this list is recorded in the audit trail as a staff view.</div>
      <div className="toolbar">
        <SelectField label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[["", "Any status"], ...Object.entries(POST_STATUS).map(([k, [t]]): [string, string] => [k, t])]} />
      </div>
      <section className="panel" aria-label="Posts">
        <Region q={q} what="posts" rows={5} isEmpty={(d) => d.items.length === 0} empty={{ title: status ? "No posts with that status" : "No posts yet", text: status ? "Pick another status." : "This workspace has not written a post." }}>
          {(d) => (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th scope="col">Post</th><th scope="col">Brand</th><th scope="col">Author</th><th scope="col">Status</th><th scope="col" className="num">Media</th><th scope="col">Scheduled or published</th></tr></thead>
                  <tbody>
                    {d.items.map((p) => (
                      <tr key={p.id}>
                        <td><div className="name"><span className="ink2">{p.title || p.caption.slice(0, 60) || "Untitled"}</span><span>{p.caption.slice(0, 90)}</span></div></td>
                        <td className="small">{p.brand_name}</td>
                        <td className="small">{p.author_email}</td>
                        <td><Chip tone={POST_STATUS[p.status]?.[1]}>{POST_STATUS[p.status]?.[0] ?? p.status}</Chip></td>
                        <td className="num">{p.media_count}</td>
                        <td className="mono cool">{fmtDateTime(p.published_at ?? p.scheduled_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} limit={25} total={d.total} noun="posts" onPage={setPage} />
            </>
          )}
        </Region>
      </section>
    </>
  );
}

// ── Brands and accounts ──────────────────────────────────────────────
function AccountsTab({ w }: TabProps) {
  const accounts = useAdmin<AdminSocialAccount[]>(["workspace", w.id, "accounts"], `/workspaces/${w.id}/social-accounts`);
  const brands = useAdmin<AdminBrand[]>(["workspace", w.id, "brands"], `/workspaces/${w.id}/brands`);
  return (
    <div className="grid-2">
      <section className="panel" aria-labelledby="h-acc">
        <div className="panel__head"><h2 id="h-acc">Connected social accounts</h2><p>Tokens are never shown: this console’s database role cannot read them.</p></div>
        <Region q={accounts} what="social accounts" rows={3} isEmpty={(d) => d.length === 0} empty={{ title: "No accounts connected", text: "The workspace has not connected Facebook, Instagram or LinkedIn yet." }}>
          {(list) => (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th scope="col">Account</th><th scope="col">Health</th><th scope="col">Token expires</th><th scope="col">Connected</th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id}>
                      <td><div className="name"><span className="ink2">{a.account_name}</span><span>{a.platform} {a.account_type ?? ""}</span></div></td>
                      <td>{!a.is_active ? <Chip>Disconnected</Chip> : a.needs_reauth ? <Chip tone="bad">Needs reconnecting</Chip> : <Chip tone="ok">Healthy</Chip>}</td>
                      <td className={`mono ${a.needs_reauth ? "over" : "cool"}`}>{a.token_expires_at ? fmtDate(a.token_expires_at) : "Does not expire"}</td>
                      <td className="mono cool">{fmtDate(a.connected_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Region>
      </section>
      <section className="panel" aria-labelledby="h-brands">
        <div className="panel__head"><h2 id="h-brands">Brands</h2></div>
        <Region q={brands} what="brands" rows={2} isEmpty={(d) => d.length === 0} empty={{ title: "No brands yet", text: "Brands are created by the workspace in the customer app." }}>
          {(list) => (
            <table className="table">
              <thead><tr><th scope="col">Brand</th><th scope="col">Industry</th></tr></thead>
              <tbody>{list.map((b) => <tr key={b.id}><td className="ink2">{b.name}</td><td className="small">{b.industry ?? ""}</td></tr>)}</tbody>
            </table>
          )}
        </Region>
      </section>
    </div>
  );
}

// ── Usage ────────────────────────────────────────────────────────────
function UsageTab({ w }: TabProps) {
  const q = useAdmin<UsageRow>(["workspace", w.id, "usage"], `/workspaces/${w.id}/usage`);
  const features = useFeatures();
  return (
    <Region q={q} what="usage" rows={2}>
      {(r) => {
        const cell = (label: string, used: number, key: string) => {
          const lim = r.limits[key];
          const over = r.over_limit.includes(key);
          return (
            <div className="reading" key={key}>
              <dt>{label}</dt>
              <dd className={over ? "is-bad" : undefined}>{num(used)}</dd>
              <p className="sub">of <span className="mono">{lim === 0 ? "0 (off)" : limitText(lim)}</span></p>
            </div>
          );
        };
        const name = (k: string) => features.data?.find((f) => f.key === k)?.name ?? k;
        return (
          <>
            {r.usage_mismatch && (
              <div className="note note--bad" role="status">
                <div><b>The posts table holds more posts than the usage log recorded this month.</b> Log <span className="mono">{r.posts_logged_this_month}</span>, table <span className="mono">{r.posts_in_table_this_month}</span>. Some code path created posts without logging them, so limits were checked against the lower number.</div>
              </div>
            )}
            {r.over_limit.length > 0 && (
              <div className="note note--bad" role="status"><div><b>Over a limit:</b> {r.over_limit.map(name).join(", ")}. A limit was lowered after the fact, or a check is being bypassed.</div></div>
            )}
            <dl className="readings">
              {cell("Posts this month", r.posts_in_table_this_month, "max_posts_per_month")}
              {cell("Social accounts", r.social_accounts, "max_social_accounts")}
              {cell("Brands", r.brands, "max_brands")}
              {cell("Members", r.members, "max_members")}
              {cell("Media stored, MB", Math.round(r.media_stored_mb), "max_storage_mb")}
            </dl>
            <p className="small muted">Last 30 days: <span className="mono">{r.posts_created}</span> posts created, <span className="mono">{r.posts_published}</span> published, <span className="mono">{num(Math.round(r.media_uploaded_mb))}</span> MB uploaded.</p>
          </>
        );
      }}
    </Region>
  );
}

// ── Activity ─────────────────────────────────────────────────────────
function ActivityTab({ w }: TabProps) {
  const [page, setPage] = useState(1);
  const q = useAdmin<AuditList>(["audit", "ws", w.id], "/audit", { workspace_id: w.id, page, limit: 25 });
  return (
    <section className="panel" aria-labelledby="h-act">
      <div className="panel__head"><h2 id="h-act">Activity in this workspace</h2><p>Staff actions also show in the customer’s own audit log, marked as platform staff.</p></div>
      <Region q={q} what="activity" rows={3} isEmpty={(d) => d.items.length === 0} empty={{ title: "No recorded activity", text: "Changes by this workspace’s members and by staff appear here." }}>
        {(d) => (
          <>
            <ol className="trail">{d.items.map((a) => <TrailItem key={a.id} a={a} />)}</ol>
            <Pager page={page} limit={25} total={d.total} noun="entries" onPage={setPage} />
          </>
        )}
      </Region>
    </section>
  );
}

