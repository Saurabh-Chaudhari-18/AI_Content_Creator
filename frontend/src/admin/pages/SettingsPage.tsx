import { useState, type FormEvent } from "react";

import { adminSend, useAdmin, type AdminSetting } from "../api";
import { useSlip } from "../ChangeSlip";
import { fmtDateTime, PageHead, Region, useCrumbs } from "../ui";

export function SettingsPage() {
  useCrumbs([["Platform settings"]]);
  const q = useAdmin<AdminSetting[]>(["settings"], "/settings");
  return (
    <>
      <PageHead
        title="Platform settings"
        lede="Values the code reads on every request instead of a constant, so a change here applies straight away. New settings are added in app/core/settings_registry.py."
      />
      <section className="panel" aria-label="Settings">
        <Region q={q} what="settings" rows={2} isEmpty={(d) => d.length === 0} empty={{ title: "No settings registered", text: "Settings are added in code and created at startup." }}>
          {(list) => <>{list.map((s) => <SettingRow key={s.key} s={s} />)}</>}
        </Region>
      </section>
    </>
  );
}

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v ?? ""));

function SettingRow({ s }: { s: AdminSetting }) {
  const openSlip = useSlip();
  const [value, setValue] = useState(show(s.value));
  const [error, setError] = useState("");
  const id = `s-${s.key}`;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    let next: unknown = value;
    if (s.value_type === "integer") {
      const n = Number(value);
      if (!/^-?\d+$/.test(value.trim()) || (s.minimum != null && n < s.minimum) || (s.maximum != null && n > s.maximum)) {
        setError(`Use a whole number${s.minimum != null && s.maximum != null ? ` from ${s.minimum} to ${s.maximum}` : ""}.`);
        document.getElementById(id)?.focus();
        return;
      }
      next = n;
    } else if (s.value_type === "boolean") next = value === "on";
    setError("");
    if (show(next) === show(s.value)) { setError("That is already the value."); return; }
    openSlip({
      title: `Change ${s.key.replace(/_/g, " ")}`,
      lede: s.description,
      diff: () => [[s.key.replace(/_/g, " "), show(s.value), show(next)]],
      action: "SETTING_CHANGE", entity: `PlatformSetting, ${s.key}`, method: "PATCH", path: `/settings/${s.key}`, confirm: "Change setting",
      submit: (_v, reason) => adminSend("PATCH", `/settings/${s.key}`, { value: next }, reason).then(() => undefined),
    });
  }

  return (
    <div className="setting">
      <div>
        <h2>{s.description}</h2>
        <p className="key">{s.key}</p>
        <p className="small muted">
          Default <span className="mono">{show(s.default)}</span>
          {s.minimum != null && s.maximum != null && <>, allowed <span className="mono">{s.minimum}</span> to <span className="mono">{s.maximum}</span></>}.
          {s.updated_at && <> Last changed <span className="mono cool">{fmtDateTime(s.updated_at)}</span>.</>}
        </p>
      </div>
      <form className="setting__form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={id}>Value</label>
          <div className="setting__row">
            {s.value_type === "boolean" ? (
              <select className="select" id={id} value={value} onChange={(e) => setValue(e.target.value)}><option value="on">On</option><option value="off">Off</option></select>
            ) : (
              <input className="input mono" id={id} type={s.value_type === "integer" ? "number" : "text"} inputMode={s.value_type === "integer" ? "numeric" : undefined} min={s.minimum ?? undefined} max={s.maximum ?? undefined} value={value} aria-invalid={!!error || undefined} aria-describedby={`${id}-h`} onChange={(e) => setValue(e.target.value)} />
            )}
            <button className="btn" type="submit">Change</button>
          </div>
          <span className={error ? "help is-error" : "help"} id={`${id}-h`} aria-live="polite">{error}</span>
        </div>
      </form>
    </div>
  );
}
