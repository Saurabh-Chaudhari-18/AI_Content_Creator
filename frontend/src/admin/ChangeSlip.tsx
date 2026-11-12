/**
 * The change slip: every change made from the staff console goes through it.
 *
 * It shows what changes (before and after), asks for the reason the backend
 * requires on every admin write, and previews the audit row that will be
 * written, before anything is sent.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { useAdminChange } from "./api";
import { Diff, fmtDateTime, type DiffRow } from "./ui";

export type Vals = Record<string, string>;

export type SlipField = {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "select" | "textarea";
  options?: [string, string][];
  value?: string;
  required?: boolean;
  help?: string;
  wide?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  /** Show this field only when it applies. */
  show?: (v: Vals) => boolean;
};

export type SlipConfig = {
  title: string;
  lede?: string;
  fields?: SlipField[];
  diff?: (v: Vals) => (DiffRow | null | false)[];
  action: string;
  entity: string;
  /** The change is also shown in the customer's own audit log. */
  workspace?: boolean;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  confirm: string;
  danger?: boolean;
  /** Why the change cannot be sent yet, or null. */
  blocked?: (v: Vals) => string | null;
  /** Sends the change. Return a node to show a result (a setup link) instead of closing. */
  submit: (v: Vals, reason: string) => Promise<ReactNode | void>;
};

const SlipContext = createContext<(c: SlipConfig) => void>(() => {});
export const useSlip = () => useContext(SlipContext);

const REASON_MIN = 3;
const REASON_MAX = 500;

export function SlipProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SlipConfig | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const open = useCallback((c: SlipConfig) => {
    setConfig(c);
    setOpenCount((n) => n + 1);
  }, []);
  return (
    <SlipContext.Provider value={open}>
      {children}
      {config && <Slip key={openCount} config={config} onClosed={() => setConfig(null)} />}
    </SlipContext.Provider>
  );
}

function Slip({ config: c, onClosed }: { config: SlipConfig; onClosed: () => void }) {
  const { user } = useAuth();
  const refresh = useAdminChange();
  const ref = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const [vals, setVals] = useState<Vals>(() => Object.fromEntries((c.fields ?? []).map((f) => [f.name, f.value ?? ""])));
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "error" | "busy"; text: string }>({ kind: "idle", text: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode>(null);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal(); // StrictMode runs this twice; a second showModal would throw
    const first = d.querySelector<HTMLElement>(".slip__fields input, .slip__fields select, .slip__fields textarea");
    (first ?? reasonRef.current)?.focus();
  }, []);

  const fields = (c.fields ?? []).filter((f) => !f.show || f.show(vals));
  const rows = (c.diff?.(vals) ?? []).filter(Boolean) as DiffRow[];
  const blocked = c.blocked?.(vals) ?? null;
  const busy = status.kind === "busy";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const missing = fields.find((f) => f.required && !vals[f.name]?.trim());
    if (missing) {
      setInvalid(missing.name);
      setStatus({ kind: "error", text: `${missing.label} is needed.` });
      formRef.current?.querySelector<HTMLElement>(`[name="${missing.name}"]`)?.focus();
      return;
    }
    if (reason.trim().length < REASON_MIN) {
      setInvalid("reason");
      setStatus({ kind: "error", text: "Give a short reason for this change. It goes in the audit trail." });
      reasonRef.current?.focus();
      return;
    }
    setInvalid(null);
    setStatus({ kind: "busy", text: "Saving…" });
    try {
      const out = await c.submit(vals, reason.trim());
      void refresh();
      if (out) {
        setResult(out);
        setStatus({ kind: "idle", text: "" });
      } else {
        ref.current?.close();
      }
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof ApiError ? err.message : "That did not go through. Try again in a minute." });
    }
  }

  const set = (name: string, v: string) => {
    setVals((old) => ({ ...old, [name]: v }));
    if (invalid === name) setInvalid(null);
  };

  return (
    <dialog className="slip" ref={ref} aria-labelledby={`${uid}-t`} onClose={onClosed}>
      {result ? (
        <div className="slip__result">
          <div className="slip__head"><h2 id={`${uid}-t`}>{c.title}</h2><p>Done. Recorded in the audit trail with your reason.</p></div>
          <div className="slip__body">{result}</div>
          <div className="slip__foot"><div className="btns"><button className="btn btn--primary" type="button" onClick={() => ref.current?.close()}>Done</button></div></div>
        </div>
      ) : (
        <form ref={formRef} onSubmit={onSubmit} noValidate>
          <div className="slip__head">
            <h2 id={`${uid}-t`}>{c.title}</h2>
            {c.lede && <p>{c.lede}</p>}
          </div>
          <div className="slip__body">
            {fields.length > 0 && (
              <div className="slip__fields">
                {fields.map((f) => <FieldInput key={f.name} f={f} value={vals[f.name] ?? ""} invalid={invalid === f.name} onChange={(v) => set(f.name, v)} />)}
              </div>
            )}
            <Diff rows={rows} caption="What changes" />
            <div className="field">
              <label htmlFor={`${uid}-r`}>Reason</label>
              <textarea
                ref={reasonRef}
                className="textarea"
                id={`${uid}-r`}
                name="reason"
                rows={3}
                maxLength={REASON_MAX}
                placeholder="Why are you making this change? The customer may read it."
                aria-invalid={invalid === "reason" || undefined}
                aria-describedby={`${uid}-s`}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (status.kind === "error" && e.target.value.trim().length >= REASON_MIN) setStatus({ kind: "idle", text: "" });
                  if (invalid === "reason") setInvalid(null);
                }}
              />
              <span className="help"><span className="counter">{reason.length} of {REASON_MAX}</span></span>
            </div>
            <div className="record" aria-live="polite">
              <span className="label">Recorded in the audit trail as</span>
              <span className="line">
                <b className="person">{user?.full_name ?? "You"}</b>
                <span className="mono cool">{c.action}</span>
                <span>{c.entity}</span>
              </span>
              <span className="why">{reason.trim() ? `“${reason.trim()}”` : ""}</span>
              {c.workspace && <span className="label">Also shown in this customer’s own audit log, marked as platform staff.</span>}
            </div>
            <span className="endpoint">{c.method} /api/v1/admin{c.path}</span>
          </div>
          <div className="slip__foot">
            <p className={status.kind === "error" ? "slip__status is-error" : "slip__status"} id={`${uid}-s`} role="status">{blocked ?? status.text}</p>
            <div className="btns">
              <button className="btn" type="button" onClick={() => ref.current?.close()}>Cancel</button>
              <button className={c.danger ? "btn btn--bad" : "btn btn--primary"} type="submit" disabled={!!blocked || busy} aria-busy={busy || undefined}>
                {c.confirm}
              </button>
            </div>
          </div>
        </form>
      )}
    </dialog>
  );
}

function FieldInput({ f, value, invalid, onChange }: { f: SlipField; value: string; invalid: boolean; onChange: (v: string) => void }) {
  const id = useId();
  const cls = f.wide || f.type === "textarea" ? "field field--wide" : "field";
  return (
    <div className={cls}>
      <label htmlFor={id}>{f.label}</label>
      {f.type === "select" ? (
        <select className="select" id={id} name={f.name} value={value} onChange={(e) => onChange(e.target.value)}>
          {(f.options ?? []).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      ) : f.type === "textarea" ? (
        <textarea className="textarea" id={id} name={f.name} rows={5} maxLength={f.maxLength} value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          className="input"
          id={id}
          name={f.name}
          type={f.type ?? "text"}
          inputMode={f.type === "number" ? "numeric" : undefined}
          min={f.min}
          max={f.max}
          maxLength={f.maxLength}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <span className="help">{f.help ?? ""}</span>
    </div>
  );
}

/** Shown once after a login is created or a new link is issued: only its hash is stored. */
export function SetupLinkResult({ link, email, expiresAt }: { link: string; email: string; expiresAt: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const id = useId();
  return (
    <div className="setup-link">
      <div className="note note--person"><div><b>Copy this link now.</b> It is shown once; only its hash is stored. Send it to {email} yourself. It expires <span className="mono">{fmtDateTime(expiresAt)}</span>.</div></div>
      <div className="field">
        <label htmlFor={id}>Set-password link</label>
        <div className="setting__row">
          <input className="input mono" id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn"
            type="button"
            onClick={() => navigator.clipboard.writeText(link).then(() => setCopied("done"), () => setCopied("failed"))}
          >
            Copy
          </button>
        </div>
        <span className="help" role="status">{copied === "done" ? "Copied." : copied === "failed" ? "Could not copy. Select the link and copy it by hand." : ""}</span>
      </div>
    </div>
  );
}
