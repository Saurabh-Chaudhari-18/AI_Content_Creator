import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { adminSend, useAdmin, type AdminTemplate } from "../api";
import { useSlip, type SlipConfig } from "../ChangeSlip";
import { Chip, EmptyState, PageHead, Region, Seg, Switch, useCrumbs, type DiffRow } from "../ui";

const CATEGORIES: [string, string][] = [["promotional", "Promotional"], ["educational", "Educational"], ["engagement", "Engagement"], ["seasonal", "Seasonal"]];
const tags = (s: string) => s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 30);

function newTemplateSlip(onDone: (id: string) => void): SlipConfig {
  return {
    title: "New Smart Template",
    lede: "Customers see it in the library straight away.",
    fields: [
      { name: "title", label: "Title", required: true, maxLength: 255 },
      { name: "industry", label: "Industry", required: true, maxLength: 100, help: "Stored in lowercase, like bakery." },
      { name: "category", label: "Category", type: "select", options: CATEGORIES, value: "promotional" },
      { name: "cta", label: "Suggested call to action", maxLength: 255 },
      { name: "template_text", label: "Template", type: "textarea", required: true, maxLength: 5000, help: "Words in braces, like {product}, are filled in by the customer." },
      { name: "hashtags", label: "Suggested hashtags", wide: true, help: "Up to 30, separated by spaces." },
    ],
    diff: (v) => [["title", "", v.title], ["industry", "", v.industry.trim().toLowerCase()], ["category", "", v.category]],
    action: "CREATE", entity: "CaptionTemplate", method: "POST", path: "/templates", confirm: "Create template",
    submit: async (v, reason) => {
      const t = await adminSend<AdminTemplate>("POST", "/templates", {
        title: v.title.trim(), industry: v.industry.trim(), category: v.category, template_text: v.template_text,
        suggested_hashtags: tags(v.hashtags), suggested_cta: v.cta.trim() || null,
      }, reason);
      onDone(t.id);
    },
  };
}

export function TemplatesPage() {
  useCrumbs([["Smart Templates"]]);
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const show = params.get("show") ?? "all";
  const [term, setTerm] = useState(search);
  const q = useAdmin<AdminTemplate[]>(["templates"], "/templates", { search, active: show === "all" ? undefined : show === "on" });
  const openSlip = useSlip();
  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    setParams(p);
  };
  const create = () => openSlip(newTemplateSlip((id) => update({ id, q: "", show: "" })));
  // On a narrow screen the editor sits below the list: bring it into view when a template is picked.
  const picked = useRef(false);
  const selectedId = params.get("id");
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    if (window.matchMedia("(max-width: 75rem)").matches) document.getElementById("h-tpl")?.scrollIntoView({ block: "start" });
  }, [selectedId]);

  return (
    <>
      <PageHead
        title="Smart Templates"
        lede="One library shared by every customer, who can only read it. Templates are switched off, never deleted; posts already written from one keep their text."
        actions={<button className="btn btn--primary" type="button" onClick={create}>New template</button>}
      />
      <form className="toolbar" role="search" aria-label="Filter templates" onSubmit={(e: FormEvent) => { e.preventDefault(); update({ q: term.trim() }); }}>
        <div className="field field--grow">
          <label htmlFor="tq">Title, industry or text</label>
          <input className="input" id="tq" type="search" value={term} onChange={(e) => setTerm(e.target.value)} onBlur={() => term.trim() !== search && update({ q: term.trim() })} autoComplete="off" />
        </div>
        <Seg legend="Show" value={show} onChange={(v) => update({ show: v === "all" ? "" : v })} options={[["all", "All"], ["on", "In use"], ["off", "Switched off"]]} />
      </form>
      <Region
        q={q}
        what="templates"
        rows={6}
        isEmpty={(d) => d.length === 0}
        empty={search || show !== "all"
          ? { title: "No template matches", text: "Try another word, or show switched-off templates too." }
          : { title: "The library is empty", text: "Add the first template customers will see when they write a post.", action: <button className="btn btn--primary" type="button" onClick={create}>New template</button> }}
      >
        {(list) => {
          const sel = list.find((t) => t.id === params.get("id")) ?? list[0];
          return (
            <div className="md">
              <section className="panel" aria-label="Templates">
                <ul className="list">
                  {list.map((t) => (
                    <li key={t.id}>
                      <button type="button" aria-current={t.id === sel?.id ? "true" : undefined} onClick={() => { picked.current = true; update({ id: t.id }); }}>
                        <b>{t.title}</b>
                        {!t.is_active ? <Chip>Switched off</Chip> : <span />}
                        <span className="sub">{t.industry}, {t.category}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel" aria-labelledby="h-tpl">
                <div className="panel__head"><h2 id="h-tpl">{sel?.title ?? "Template"}</h2></div>
                {sel ? <Editor key={sel.id} t={sel} /> : <EmptyState title="Pick a template" text="Choose one from the list to edit it." />}
              </section>
            </div>
          );
        }}
      </Region>
    </>
  );
}

function Editor({ t }: { t: AdminTemplate }) {
  const openSlip = useSlip();
  const start = {
    industry: t.industry, category: t.category, title: t.title, template_text: t.template_text,
    hashtags: (t.suggested_hashtags ?? []).join(" "), cta: t.suggested_cta ?? "", active: t.is_active,
  };
  const [v, setV] = useState(start);
  const set = (k: keyof typeof start, val: string | boolean) => setV((o) => ({ ...o, [k]: val }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const rows: DiffRow[] = [];
    const body: Record<string, unknown> = {};
    const check = (label: string, key: string, was: string, now: string, value: unknown) => {
      if (was !== now) { rows.push([label, was, now]); body[key] = value; }
    };
    check("industry", "industry", start.industry, v.industry.trim().toLowerCase(), v.industry.trim());
    check("category", "category", start.category, v.category, v.category);
    check("title", "title", start.title, v.title.trim(), v.title.trim());
    check("template", "template_text", start.template_text, v.template_text, v.template_text);
    check("hashtags", "suggested_hashtags", start.hashtags, tags(v.hashtags).join(" "), tags(v.hashtags));
    check("call to action", "suggested_cta", start.cta, v.cta.trim(), v.cta.trim());
    check("customers see it", "is_active", start.active ? "yes" : "no", v.active ? "yes" : "no", v.active);
    openSlip({
      title: `Save “${t.title}”`,
      lede: rows.length ? "Customers see the new version the next time they open the library." : undefined,
      diff: () => rows,
      blocked: () => (rows.length ? null : "Nothing has changed yet. Edit a field first."),
      action: "UPDATE", entity: `CaptionTemplate, ${t.title}`, method: "PATCH", path: `/templates/${t.id}`, confirm: "Save template",
      submit: (_vals, reason) => adminSend("PATCH", `/templates/${t.id}`, body, reason).then(() => undefined),
    });
  }

  return (
    <form className="editor panel__body" onSubmit={onSubmit} noValidate>
      <div className="row">
        <div className="field"><label htmlFor="t-industry">Industry</label><input className="input" id="t-industry" value={v.industry} maxLength={100} onChange={(e) => set("industry", e.target.value)} /></div>
        <div className="field">
          <label htmlFor="t-category">Category</label>
          <select className="select" id="t-category" value={v.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="t-title">Title</label><input className="input" id="t-title" value={v.title} maxLength={255} onChange={(e) => set("title", e.target.value)} /></div>
      <div className="field">
        <label htmlFor="t-text">Template</label>
        <textarea className="textarea" id="t-text" rows={6} maxLength={5000} value={v.template_text} onChange={(e) => set("template_text", e.target.value)} />
        <span className="help">Words in braces, like {"{product}"}, are filled in by the customer.</span>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="t-tags">Suggested hashtags</label><input className="input" id="t-tags" value={v.hashtags} onChange={(e) => set("hashtags", e.target.value)} /><span className="help">Up to 30, separated by spaces.</span></div>
        <div className="field"><label htmlFor="t-cta">Suggested call to action</label><input className="input" id="t-cta" value={v.cta} maxLength={255} onChange={(e) => set("cta", e.target.value)} /></div>
      </div>
      <div className="toolbar">
        <Switch checked={v.active} label={v.active ? "Customers can use it" : "Switched off"} onClick={() => set("active", !v.active)} />
        <div className="toolbar__end"><button className="btn btn--primary" type="submit">Save changes</button></div>
      </div>
    </form>
  );
}
