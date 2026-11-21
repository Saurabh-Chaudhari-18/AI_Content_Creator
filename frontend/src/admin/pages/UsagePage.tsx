import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { apiBlob, ApiError } from "@/lib/api";

import { useAdmin, useFeatures, usePlans, type UsageReport } from "../api";
import { Chip, num, Pager, PageHead, Region, Seg, SelectField, Switch, useCrumbs } from "../ui";

const LIMIT = 50;

export function UsagePage() {
  useCrumbs([["Usage"]]);
  const [params, setParams] = useSearchParams();
  const days = params.get("days") ?? "30";
  const plan = params.get("plan") ?? "";
  const status = params.get("status") ?? "";
  const problems = params.get("problems") === "1";
  const page = Number(params.get("page") ?? "1") || 1;
  const query = { days: Number(days), plan, status, problems_only: problems || undefined };
  const q = useAdmin<UsageReport>(["usage"], "/usage", { ...query, page, limit: LIMIT });
  const plans = usePlans();
  const features = useFeatures();
  const navigate = useNavigate();
  const [download, setDownload] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!("page" in next)) p.delete("page");
    setParams(p);
  };
  const featureName = (k: string) => features.data?.find((f) => f.key === k)?.name ?? k;
  const planName = (k: string) => plans.data?.find((p) => p.key === k)?.name ?? k;

  async function downloadCsv() {
    setDownload({ busy: true, error: "" });
    try {
      const blob = await apiBlob("/admin/usage", { query: { ...query, format: "csv" } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `usage-${days}-days.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDownload({ busy: false, error: "" });
    } catch (err) {
      setDownload({ busy: false, error: err instanceof ApiError ? err.message : "The download did not start. Try again." });
    }
  }

  return (
    <>
      <PageHead title="Usage" accent="Watch" lede="Usage per workspace for billing, and the check that catches a workspace getting more than its plan allows." />
      <div className="toolbar">
        <Seg legend="Period" value={days} onChange={(v) => update({ days: v === "30" ? "" : v })} options={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"]]} />
        <SelectField label="Plan" value={plan} onChange={(v) => update({ plan: v })} options={[["", "Any plan"], ...(plans.data ?? []).map((p): [string, string] => [p.key, p.name])]} />
        <SelectField label="Status" value={status} onChange={(v) => update({ status: v })} options={[["", "Active or suspended"], ["active", "Active"], ["suspended", "Suspended"]]} />
        <div className="end"><Switch checked={problems} label="Only workspaces to check" onClick={() => update({ problems: problems ? "" : "1" })} /></div>
        <div className="toolbar__end">
          <span className={download.error ? "small over" : "small muted"} role="status">{download.error}</span>
          <button className="btn" type="button" onClick={() => void downloadCsv()} disabled={download.busy} aria-busy={download.busy || undefined}>Download CSV</button>
        </div>
      </div>
      <section className="panel" aria-label="Usage per workspace">
        <Region
          q={q}
          what="usage"
          rows={8}
          isEmpty={(d) => d.items.length === 0}
          empty={problems
            ? { title: "Every workspace is inside its limits", text: "Nothing is over a limit and every usage log matches the posts table.", action: <Link className="btn" to="/admin/usage">Show every workspace</Link> }
            : { title: "No workspaces match", text: "Change the plan or status filter." }}
        >
          {(d) => (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Workspace</th><th scope="col" className="num">Created</th><th scope="col" className="num">Published</th>
                      <th scope="col" className="num">Uploaded, MB</th><th scope="col" className="num">Stored, MB</th><th scope="col" className="num">Accounts</th>
                      <th scope="col" className="num">Month, log</th><th scope="col" className="num">Month, table</th><th scope="col">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((r) => {
                      const flagged = r.over_limit.length > 0 || r.usage_mismatch;
                      return (
                        <tr key={r.workspace_id} className={flagged ? "is-flagged" : undefined} data-href onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(`/admin/workspaces/${r.workspace_id}/usage`); }}>
                          <td><div className="name"><Link to={`/admin/workspaces/${r.workspace_id}/usage`}>{r.workspace_name}</Link><span>{planName(r.plan_key)}{r.status === "suspended" ? ", suspended" : ""}</span></div></td>
                          <td className="num">{num(r.posts_created)}</td>
                          <td className="num">{num(r.posts_published)}</td>
                          <td className="num">{num(Math.round(r.media_uploaded_mb))}</td>
                          <td className={`num${r.over_limit.includes("max_storage_mb") ? " over" : ""}`}>{num(Math.round(r.media_stored_mb))}</td>
                          <td className={`num${r.over_limit.includes("max_social_accounts") ? " over" : ""}`}>{r.social_accounts}</td>
                          <td className="num">{r.posts_logged_this_month}</td>
                          <td className={`num${r.usage_mismatch || r.over_limit.includes("max_posts_per_month") ? " over" : ""}`}>{r.posts_in_table_this_month}</td>
                          <td>
                            {r.over_limit.map((k) => <Chip key={k} tone="bad">{featureName(k)} over</Chip>)}{" "}
                            {r.usage_mismatch && <Chip tone="bad">Mismatch</Chip>}
                            {!flagged && <Chip tone="ok">Fine</Chip>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} limit={LIMIT} total={d.total} noun="workspaces" onPage={(p) => update({ page: String(p) })} />
            </>
          )}
        </Region>
        <div className="panel__foot"><span>Created, published and uploaded cover the last {days} days. Month log and month table should match: when the table is higher, posts were created without being logged.</span></div>
      </section>
    </>
  );
}
