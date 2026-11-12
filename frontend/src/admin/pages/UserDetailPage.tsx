import { useState } from "react";
import { Link, useParams } from "react-router";

import { useAuth } from "@/lib/auth";

import { adminSend, useAdmin, type AdminUserDetail, type AuditList, type SetupLink } from "../api";
import { SetupLinkResult, useSlip } from "../ChangeSlip";
import { Chip, EmptyState, ErrorState, fmtDate, fmtDateTime, PageHead, SelectField, Skeleton, TrailItem, useCrumbs, WsStatus } from "../ui";

export function UserDetailPage() {
  const { id = "" } = useParams();
  const { user: me } = useAuth();
  const q = useAdmin<AdminUserDetail>(["user", id], `/users/${id}`);
  const activity = useAdmin<AuditList>(["audit", "user", id], "/audit", { entity_id: id, limit: 10 });
  const openSlip = useSlip();
  const [role, setRole] = useState<string | null>(null);
  useCrumbs([["Logins", "/admin/users"], [q.data?.full_name ?? "Login"]]);

  if (q.isPending) return <Skeleton rows={6} what="the login" />;
  if (q.isError) return <ErrorState what="login" error={q.error} onRetry={() => void q.refetch()} />;
  const u = q.data;
  const path = `/users/${u.id}`;
  const entity = `User, ${u.email}`;
  const isMe = me?.id === u.id;
  const roleValue = role ?? u.platform_role ?? "";

  const setupLink = () => openSlip({
    title: `Issue a setup link for ${u.full_name}`,
    lede: "Any earlier link stops working. Use it for a first sign-in or a forgotten password. The new link is shown once.",
    diff: () => [["setup link", u.pending_setup_link ? "pending" : "none", "new"]],
    action: "SETUP_LINK", entity, method: "POST", path: `${path}/setup-link`, confirm: "Issue link",
    submit: async (_v, reason) => {
      const res = await adminSend<SetupLink>("POST", `${path}/setup-link`, {}, reason);
      return <SetupLinkResult link={res.setup_link} email={res.email} expiresAt={res.expires_at} />;
    },
  });
  const forceLogout = () => openSlip({
    title: `Sign ${u.full_name} out everywhere`,
    lede: "Every session ends now. Their password does not change.",
    diff: () => [["open sessions", String(u.sessions.length), "0"]],
    action: "FORCE_LOGOUT", entity, method: "POST", path: `${path}/force-logout`, confirm: "Sign out everywhere", danger: true,
    submit: (_v, reason) => adminSend("POST", `${path}/force-logout`, {}, reason).then(() => undefined),
  });
  const setActive = (active: boolean) => openSlip({
    title: `${active ? "Reactivate" : "Deactivate"} ${u.full_name}`,
    lede: active ? "They can sign in again with their old password." : "They are signed out and cannot sign in again. Their workspaces and posts stay.",
    diff: () => [["login", active ? "deactivated" : "active", active ? "active" : "deactivated"]],
    action: "UPDATE", entity, method: "PATCH", path, confirm: active ? "Reactivate login" : "Deactivate login", danger: !active,
    submit: (_v, reason) => adminSend("PATCH", path, { is_active: active }, reason).then(() => undefined),
  });
  const rename = () => openSlip({
    title: `Rename ${u.full_name}`,
    fields: [{ name: "full_name", label: "Full name", value: u.full_name, required: true, wide: true, maxLength: 255 }],
    diff: (v) => [v.full_name.trim() !== u.full_name && ["full name", u.full_name, v.full_name.trim()]],
    blocked: (v) => (v.full_name.trim() === u.full_name ? "Type the new name." : null),
    action: "UPDATE", entity, method: "PATCH", path, confirm: "Rename",
    submit: (v, reason) => adminSend("PATCH", path, { full_name: v.full_name.trim() }, reason).then(() => undefined),
  });
  const changeRole = () => openSlip({
    title: roleValue ? `Make ${u.full_name} a super admin` : `Remove the platform role from ${u.full_name}`,
    lede: roleValue ? "They will see every workspace and can change plans, features and logins." : "They become an ordinary customer login.",
    diff: () => [["platform role", u.platform_role ?? "customer", roleValue || "customer"]],
    action: "ROLE_CHANGE", entity, method: "PUT", path: `${path}/platform-role`, confirm: "Change role", danger: !roleValue,
    submit: (_v, reason) => adminSend("PUT", `${path}/platform-role`, { platform_role: roleValue || null }, reason).then(() => { setRole(null); }),
  });

  return (
    <>
      <PageHead
        title={u.full_name}
        meta={<><span>{u.email}</span>{u.is_active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Deactivated</Chip>}{u.platform_role && <Chip tone="person">Super admin</Chip>}{isMe && <Chip>You</Chip>}</>}
        actions={
          <>
            <button className="btn" type="button" onClick={rename}>Rename</button>
            <button className="btn" type="button" onClick={setupLink} disabled={!u.is_active} title={u.is_active ? undefined : "Reactivate the login first"}>Issue setup link</button>
            <button className="btn" type="button" onClick={forceLogout} disabled={u.sessions.length === 0}>Sign out everywhere</button>
            {u.is_active
              ? <button className="btn btn--bad" type="button" onClick={() => setActive(false)} disabled={isMe} title={isMe ? "You cannot deactivate yourself" : undefined}>Deactivate</button>
              : <button className="btn btn--primary" type="button" onClick={() => setActive(true)}>Reactivate</button>}
          </>
        }
      />
      <dl className="facts panel">
        <div><dt>Last sign-in</dt><dd className="mono cool">{u.last_login_at ? fmtDateTime(u.last_login_at) : "Never"}</dd></div>
        <div><dt>Created</dt><dd className="mono cool">{fmtDate(u.created_at)}</dd></div>
        <div><dt>Workspaces</dt><dd className="mono">{u.memberships.length}</dd></div>
        <div><dt>Open sessions</dt><dd className="mono">{u.sessions.length}</dd></div>
      </dl>
      {u.pending_setup_link && (
        <div className="note note--person" role="status">
          <div><b>A setup link is waiting.</b> Issued <span className="mono">{fmtDateTime(u.pending_setup_link.created_at)}</span>, it expires <span className="mono">{fmtDateTime(u.pending_setup_link.expires_at)}</span>. Links are shown once, so a lost link needs a new one.</div>
        </div>
      )}
      <div className="grid-even">
        <section className="panel" aria-labelledby="h-memb">
          <div className="panel__head"><h2 id="h-memb">Workspaces</h2></div>
          {u.memberships.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th scope="col">Workspace</th><th scope="col">Role</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {u.memberships.map((m) => (
                    <tr key={m.workspace_id}>
                      <td><Link className="link" to={`/admin/workspaces/${m.workspace_id}/members`}>{m.workspace_name}</Link></td>
                      <td>{m.role === "owner" ? <Chip tone="person">Owner</Chip> : <Chip>{m.role === "admin" ? "Admin" : "Member"}</Chip>}</td>
                      <td><WsStatus status={m.workspace_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Not in any workspace" text={u.platform_role ? "Platform staff do not belong to customer workspaces." : "Add this login from a workspace’s Members tab."} />}
        </section>
        <section className="panel" aria-labelledby="h-sess">
          <div className="panel__head"><h2 id="h-sess">Signed-in sessions</h2></div>
          {u.sessions.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th scope="col">Device</th><th scope="col">From</th><th scope="col">Expires</th></tr></thead>
                <tbody>
                  {u.sessions.map((s) => (
                    <tr key={s.id}>
                      <td><div className="name"><span className="ink2">{s.user_agent ? s.user_agent.slice(0, 60) : "Unknown device"}</span><span>Since {fmtDateTime(s.created_at)}</span></div></td>
                      <td className="mono cool">{s.ip_address ?? ""}</td>
                      <td className="mono cool">{fmtDateTime(s.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No open sessions" text="This login is not signed in anywhere." />}
        </section>
      </div>
      <section className="panel" aria-labelledby="h-role">
        <div className="setting">
          <div><h2 id="h-role">Platform role</h2><p className="small muted">A super admin sees every workspace and can change plans, features and logins. Grant it only to platform staff.</p></div>
          <div className="setting__form">
            <SelectField label="Role" value={roleValue} onChange={setRole} options={[["", "Customer (no platform role)"], ["super_admin", "Super admin"]]} />
            <div>
              <button className="btn" type="button" onClick={changeRole} disabled={roleValue === (u.platform_role ?? "") || (isMe && !roleValue)} title={isMe && !roleValue ? "You cannot remove your own role" : undefined}>Change role</button>
            </div>
          </div>
        </div>
      </section>
      <section className="panel" aria-labelledby="h-uact">
        <div className="panel__head"><h2 id="h-uact">Changes to this login</h2></div>
        {activity.isPending ? <Skeleton rows={2} what="changes" />
          : activity.isError ? <ErrorState what="changes" error={activity.error} onRetry={() => void activity.refetch()} />
          : activity.data.items.length ? <ol className="trail">{activity.data.items.map((a) => <TrailItem key={a.id} a={a} />)}</ol>
          : <EmptyState title="No changes recorded" text="Setup links, sign-outs and role changes for this login appear here." />}
      </section>
    </>
  );
}
