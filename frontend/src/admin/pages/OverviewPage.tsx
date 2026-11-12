import { Link } from "react-router";

import { useAdmin, useOverview, usePlans, usedFor, useFeatures, type AuditList, type UsageReport } from "../api";
import { Chip, num, PageHead, Region, TrailItem, useCrumbs } from "../ui";

export function OverviewPage() {
  useCrumbs([["Overview"]]);
  const overview = useOverview();
  const plans = usePlans();
  const features = useFeatures();
  const problems = useAdmin<UsageReport>(["usage-problems-list"], "/usage", { problems_only: true, limit: 10 });
  const staff = useAdmin<AuditList>(["audit-staff"], "/audit", { staff_only: true, limit: 5 });
  const featureName = (key: string) => features.data?.find((f) => f.key === key)?.name ?? key;
  const planName = (key: string) => plans.data?.find((p) => p.key === key)?.name ?? key;

  return (
    <>
      <PageHead
        title="What needs a look today"
        lede="Workspaces over a limit, or with posts the usage log did not record, come first. Every figure is counted live from the database."
      />

      <Region q={overview} what="the overview" rows={2}>
        {(o) => (
          <dl className="readings">
            <div className="reading"><dt>Workspaces</dt><dd>{num(o.workspaces_total)}</dd><p className="sub"><span className="mono">{o.workspaces_suspended}</span> suspended</p></div>
            <div className="reading"><dt>Logins</dt><dd>{num(o.users_total)}</dd><p className="sub"><span className="mono">{num(o.users_signed_in_last_30_days)}</span> signed in, 30 days</p></div>
            <div className="reading"><dt>Published, 30 days</dt><dd>{num(o.posts_published_last_30_days)}</dd><p className="sub">of <span className="mono">{num(o.posts_created_last_30_days)}</span> created</p></div>
            <div className="reading"><dt>Failed publishing jobs</dt><dd className={o.jobs_failed ? "is-bad" : undefined}>{num(o.jobs_failed)}</dd><p className="sub"><span className="mono">{o.jobs_needing_review}</span> waiting for review</p></div>
            <div className="reading"><dt>Open alerts</dt><dd>{num(o.open_alerts)}</dd><p className="sub">{o.open_alerts ? "From the nightly check" : "The nightly check is not built yet"}</p></div>
          </dl>
        )}
      </Region>

      <div className="grid-2">
        <section className="panel" aria-labelledby="h-watch">
          <div className="panel__head"><h2 id="h-watch">Watchlist</h2><p>From the usage check, this calendar month</p></div>
          <Region
            q={problems}
            what="the watchlist"
            rows={3}
            isEmpty={(d) => d.items.length === 0}
            empty={{ title: "Every workspace is inside its limits", text: "Nothing is over a limit and every usage log matches the posts table." }}
          >
            {(d) => (
              <ul className="watch">
                {d.items.map((r) => (
                  <li key={r.workspace_id}>
                    <div className="watch__what">
                      <b><Link className="link" to={`/admin/workspaces/${r.workspace_id}/usage`}>{r.workspace_name}</Link></b>
                      <span className="small muted">{planName(r.plan_key)} plan{r.status === "suspended" ? ", suspended" : ""}</span>
                    </div>
                    <div className="small ink2 watch__checks">
                      {r.over_limit.map((k) => (
                        <div key={k}>{featureName(k)}: <span className="mono over">{num(usedFor(r, k) ?? 0)}</span> of <span className="mono">{num(r.limits[k] ?? 0)}</span></div>
                      ))}
                      {r.usage_mismatch && (
                        <div>Posts this month: log <span className="mono">{r.posts_logged_this_month}</span>, table <span className="mono over">{r.posts_in_table_this_month}</span></div>
                      )}
                    </div>
                    <div>
                      {r.over_limit.length > 0 && <Chip tone="bad">Over a limit</Chip>} {r.usage_mismatch && <Chip tone="bad">Usage mismatch</Chip>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Region>
          <div className="panel__foot">
            <span>Over a limit means a limit was lowered after the fact, or a check is being bypassed.</span>
            <Link className="link" to="/admin/usage?problems=1">Open usage</Link>
          </div>
        </section>

        <section className="panel" aria-labelledby="h-plans">
          <div className="panel__head"><h2 id="h-plans">Workspaces by plan</h2><Link className="link small" to="/admin/plans">Plans and limits</Link></div>
          <div className="panel__body">
            <Region q={overview} what="plan counts" rows={3}>
              {(o) => {
                const entries = Object.entries(o.workspaces_by_plan).sort((a, b) => b[1] - a[1]);
                const max = Math.max(1, ...entries.map(([, v]) => v));
                return (
                  <dl className="bars">
                    {entries.map(([key, v]) => (
                      <div key={key}>
                        <dt>{planName(key)}</dt>
                        <dd className="track"><span className="fill" style={{ ["--v" as string]: (v / max).toFixed(3) }} /></dd>
                        <dd className="val">{v}</dd>
                      </div>
                    ))}
                  </dl>
                );
              }}
            </Region>
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="h-staff">
        <div className="panel__head"><h2 id="h-staff">Latest staff actions</h2><Link className="link small" to="/admin/audit?staff=1">Full audit trail</Link></div>
        <Region
          q={staff}
          what="staff actions"
          rows={4}
          isEmpty={(d) => d.items.length === 0}
          empty={{ title: "No staff actions yet", text: "Every change made from this console is listed here with its reason." }}
        >
          {(d) => <ol className="trail">{d.items.map((a) => <TrailItem key={a.id} a={a} />)}</ol>}
        </Region>
      </section>
    </>
  );
}
