import { adminSend, useFeatures, type AdminFeature } from "../api";
import { useSlip } from "../ChangeSlip";
import { PageHead, Region, Switch, useCrumbs } from "../ui";

export function FeaturesPage() {
  useCrumbs([["Feature switches"]]);
  const q = useFeatures();
  const openSlip = useSlip();

  const toggle = (f: AdminFeature) => {
    const next = !f.global_enabled;
    openSlip({
      title: `${next ? "Turn on" : "Turn off"} ${f.name} for everyone`,
      lede: next
        ? "Workspaces whose plan or override gives it get it on their next request."
        : "Every workspace loses it on its next request, whatever its plan or override says. Work already queued still runs.",
      diff: () => [["for everyone", f.global_enabled ? "on" : "off", next ? "on" : "off"]],
      action: "FEATURE_CHANGE", entity: `Feature, ${f.key}`, method: "PATCH", path: `/features/${f.key}`,
      confirm: next ? "Turn on" : "Turn off", danger: !next,
      submit: (_v, reason) => adminSend("PATCH", `/features/${f.key}`, { global_enabled: next }, reason).then(() => undefined),
    });
  };

  return (
    <>
      <PageHead
        title="Feature switches"
        lede="The switch above every plan. Off here means off for every workspace, whatever their plan or override says. The list itself comes from code; only the switch is changed here."
      />
      <section className="panel" aria-label="Global feature switches">
        <Region q={q} what="features" rows={8} isEmpty={(d) => d.length === 0} empty={{ title: "No features registered", text: "Features are added in app/core/features.py and created at startup." }}>
          {(list) => {
            const cats = [...new Set(list.map((f) => f.category))];
            return (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th scope="col">Feature</th><th scope="col">Kind</th><th scope="col">What it does</th><th scope="col">For everyone</th></tr></thead>
                  <tbody>
                    {cats.map((c) => [
                      <tr className="group" key={c}><td colSpan={4}>{c}</td></tr>,
                      ...list.filter((f) => f.category === c).map((f) => (
                        <tr key={f.key}>
                          <td><div className="name"><span className="ink2">{f.name}</span><span className="mono">{f.key}</span></div></td>
                          <td className="small">{f.value_type === "limit" ? "Limit" : "On or off"}</td>
                          <td className="small">{f.description}</td>
                          <td><Switch checked={f.global_enabled} label={f.global_enabled ? "On" : "Off"} onClick={() => toggle(f)} /></td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Region>
      </section>
      <p className="small muted">Turning a feature off stops new use only. Posts already queued still publish, and an existing approval rule is never relaxed.</p>
    </>
  );
}
