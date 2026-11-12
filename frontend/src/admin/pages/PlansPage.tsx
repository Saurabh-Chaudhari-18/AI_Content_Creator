import { adminSend, useFeatures, usePlans, type AdminFeature, type AdminPlan } from "../api";
import { useSlip, type Vals } from "../ChangeSlip";
import { Chip, limitText, PageHead, Region, useCrumbs, valueText } from "../ui";

export function PlansPage() {
  useCrumbs([["Plans and limits"]]);
  const plans = usePlans();
  const features = useFeatures();
  const openSlip = useSlip();

  const create = () => openSlip({
    title: "New plan",
    lede: "Start from another plan’s values, then adjust them in the table.",
    fields: [
      { name: "name", label: "Name", required: true, maxLength: 100 },
      { name: "key", label: "Key", required: true, maxLength: 50, help: "Lowercase letters, digits and underscores. Never renamed later." },
      { name: "copy_from_key", label: "Copy values from", type: "select", wide: true, value: plans.data?.find((p) => p.is_default)?.key ?? "", options: [["", "Start with everything off"], ...(plans.data ?? []).map((p): [string, string] => [p.key, p.name])] },
      { name: "description", label: "Description", type: "textarea", maxLength: 1000 },
    ],
    diff: (v) => [["plan", "", v.key], ["values from", "", v.copy_from_key || "nothing"]],
    blocked: (v) => (v.key && !/^[a-z][a-z0-9_]{1,49}$/.test(v.key) ? "The key starts with a letter and uses lowercase letters, digits and underscores." : null),
    action: "CREATE", entity: "Plan", method: "POST", path: "/plans", confirm: "Create plan",
    submit: (v, reason) => adminSend("POST", "/plans", { key: v.key, name: v.name.trim(), description: v.description.trim() || null, copy_from_key: v.copy_from_key || null }, reason).then(() => undefined),
  });

  const makeDefault = (p: AdminPlan) => openSlip({
    title: `Make ${p.name} the default`,
    lede: "New sign-ups get this plan. Existing workspaces keep theirs.",
    diff: () => [["default plan", plans.data?.find((x) => x.is_default)?.key ?? "", p.key]],
    action: "UPDATE", entity: `Plan, ${p.key}`, method: "POST", path: `/plans/${p.id}/make-default`, confirm: "Make default",
    submit: (_v, reason) => adminSend("POST", `/plans/${p.id}/make-default`, {}, reason).then(() => undefined),
  });

  const setActive = (p: AdminPlan, active: boolean) => openSlip({
    title: `${active ? "Bring back" : "Retire"} ${p.name}`,
    lede: active ? "It can be given to workspaces again." : `Its ${p.workspace_count} workspaces keep it, but no new workspace can be given it.`,
    diff: () => [["plan", active ? "retired" : "active", active ? "active" : "retired"]],
    action: "UPDATE", entity: `Plan, ${p.key}`, method: "PATCH", path: `/plans/${p.id}`, confirm: active ? "Bring back" : "Retire plan", danger: !active,
    submit: (_v, reason) => adminSend("PATCH", `/plans/${p.id}`, { is_active: active }, reason).then(() => undefined),
  });

  const edit = (p: AdminPlan) => openSlip({
    title: `Edit ${p.name}`,
    fields: [
      { name: "name", label: "Name", value: p.name, required: true, maxLength: 100 },
      { name: "sort_order", label: "Order in lists", type: "number", value: String(p.sort_order) },
      { name: "description", label: "Description", type: "textarea", value: p.description ?? "", maxLength: 1000 },
    ],
    diff: (v) => [
      v.name.trim() !== p.name && ["name", p.name, v.name.trim()],
      v.sort_order !== String(p.sort_order) && ["order", String(p.sort_order), v.sort_order],
      v.description.trim() !== (p.description ?? "") && ["description", p.description ?? "", v.description.trim()],
    ],
    blocked: (v) => (v.name.trim() === p.name && v.sort_order === String(p.sort_order) && v.description.trim() === (p.description ?? "") ? "Change a field first." : !/^-?\d+$/.test(v.sort_order) ? "Order is a whole number." : null),
    action: "UPDATE", entity: `Plan, ${p.key}`, method: "PATCH", path: `/plans/${p.id}`, confirm: "Save plan",
    submit: (v, reason) => adminSend("PATCH", `/plans/${p.id}`, { name: v.name.trim(), sort_order: Number(v.sort_order), description: v.description.trim() || null }, reason).then(() => undefined),
  });

  const setValue = (p: AdminPlan, f: AdminFeature) => {
    const cur = p.features[f.key] ?? { enabled: false, limit: null };
    const fpath = `/plans/${p.id}/features/${f.key}`;
    const nowText = (v: Vals) => (v.enabled === "on" ? (f.value_type === "limit" ? limitText(v.limit === "" ? null : Number(v.limit)) : "On") : "Off");
    openSlip({
      title: `${f.name} on the ${p.name} plan`,
      lede: `Reaches ${p.workspace_count} workspaces at their next request, except those with an override.${f.global_enabled ? "" : " It stays off for everyone until its global switch is on."}`,
      fields: [
        { name: "enabled", label: "Value", type: "select", options: [["on", "On"], ["off", "Off"]], value: cur.enabled ? "on" : "off", wide: f.value_type !== "limit" },
        ...(f.value_type === "limit" ? [{ name: "limit", label: "Limit", type: "number" as const, min: 0, value: cur.limit === null || cur.limit === undefined ? "" : String(cur.limit), help: "Leave empty for unlimited.", show: (v: Vals) => v.enabled === "on" }] : []),
      ],
      diff: (v) => [nowText(v) !== valueText(f.value_type, cur.enabled, cur.limit) && [f.name.toLowerCase(), valueText(f.value_type, cur.enabled, cur.limit), nowText(v)]],
      blocked: (v) => (nowText(v) === valueText(f.value_type, cur.enabled, cur.limit) ? "Pick a different value." : v.enabled === "on" && v.limit && !/^\d+$/.test(v.limit) ? "The limit must be a whole number, 0 or more." : null),
      action: "FEATURE_CHANGE", entity: `Plan, ${p.key}, ${f.key}`, method: "PUT", path: fpath, confirm: "Save value",
      submit: (v, reason) => adminSend("PUT", fpath, { enabled: v.enabled === "on", limit: f.value_type === "limit" && v.enabled === "on" && v.limit !== "" ? Number(v.limit) : null }, reason).then(() => undefined),
    });
  };

  return (
    <>
      <PageHead
        title="Plans and limits"
        lede="What each plan gives. A change reaches every workspace on that plan at its next request, except where a workspace has an override."
        actions={<button className="btn btn--primary" type="button" onClick={create}>New plan</button>}
      />
      <section className="panel" aria-label="Plan and feature table">
        <Region q={plans} what="plans" rows={10} isEmpty={(d) => d.length === 0} empty={{ title: "No plans yet", text: "Create the first plan. Every workspace needs one.", action: <button className="btn btn--primary" type="button" onClick={create}>New plan</button> }}>
          {(list) => (
            <Region q={features} what="features" rows={10}>
              {(feats) => {
                const cats = [...new Set(feats.map((f) => f.category))];
                return (
                  <div className="table-scroll">
                    <table className="table matrix">
                      <thead>
                        <tr>
                          <th scope="col">Feature</th>
                          {list.map((p) => (
                            <th scope="col" className="plan" key={p.id}>
                              <div className="plan-head">
                                <b>{p.name}</b>
                                <span className="mono">{p.key}</span>
                                <span className="small muted"><span className="mono">{p.workspace_count}</span> workspaces</span>
                                <span>
                                  {p.is_default && <Chip tone="person">Default for new sign-ups</Chip>}
                                  {!p.is_active && <Chip>Retired</Chip>}
                                </span>
                                <span className="plan-actions">
                                  <button className="btn btn--ghost" type="button" onClick={() => edit(p)}>Edit</button>
                                  {!p.is_default && p.is_active && <button className="btn btn--ghost" type="button" onClick={() => makeDefault(p)}>Make default</button>}
                                  {!p.is_default && <button className={p.is_active ? "btn btn--ghost btn--bad" : "btn btn--ghost"} type="button" onClick={() => setActive(p, !p.is_active)}>{p.is_active ? "Retire" : "Bring back"}</button>}
                                </span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cats.map((c) => [
                          <tr className="group" key={c}><td colSpan={list.length + 1}>{c}</td></tr>,
                          ...feats.filter((f) => f.category === c).map((f) => (
                            <tr key={f.key}>
                              <th scope="row" className="rowhead"><div className="name"><span className="ink2">{f.name}</span><span className="mono">{f.key}{f.global_enabled ? "" : ", off for everyone"}</span></div></th>
                              {list.map((p) => {
                                const v = p.features[f.key] ?? { enabled: false, limit: null };
                                const t = valueText(f.value_type, v.enabled, v.limit);
                                return (
                                  <td key={p.id}>
                                    <button className={`cell ${!v.enabled ? "is-off" : f.value_type === "boolean" ? "is-on" : ""}`} type="button" onClick={() => setValue(p, f)} aria-label={`${f.name} on ${p.name}: ${t}. Change`}>{t}</button>
                                  </td>
                                );
                              })}
                            </tr>
                          )),
                        ])}
                      </tbody>
                    </table>
                  </div>
                );
              }}
            </Region>
          )}
        </Region>
        <div className="panel__foot"><span>Select a value to change it. Retired plans keep their workspaces but cannot be given to new ones.</span></div>
      </section>
    </>
  );
}
