/**
 * Public certificate check: /verify/<number>. No account needed.
 * Shows only what proves the certificate is genuine — never the post itself.
 * Plan: docs/approval_reminders_certificate_plan.md §3 (R3).
 */
import { CircleAlert, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Schemas } from "@/lib/api";
import { PLATFORM_NAME } from "@/lib/format";
import { usePublicPageChrome } from "@/lib/publicPage";
import { cn } from "@/lib/utils";
import { PRODUCT_INITIAL, PRODUCT_NAME } from "@/lib/product";

type PublicCertificate = Schemas["PublicCertificateResponse"];
type Lookup = { state: "idle" | "loading" } | { state: "found"; cert: PublicCertificate } | { state: "missing" | "error"; message: string };

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });

async function lookUp(id: string): Promise<Lookup> {
  try {
    const res = await fetch(`/api/v1/public/certificates/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (res.ok) return { state: "found", cert: (await res.json()) as PublicCertificate };
    if (res.status === 404) return { state: "missing", message: "We couldn’t find a certificate with that number." };
    if (res.status === 429) return { state: "error", message: "Too many checks. Please wait a minute and try again." };
    return { state: "error", message: "Something went wrong. Please try again." };
  } catch {
    return { state: "error", message: "Can’t reach the server. Check your connection and try again." };
  }
}

export function VerifyCertificatePage() {
  usePublicPageChrome("Check an approval certificate");
  const { id } = useParams();
  const navigate = useNavigate();
  const [typed, setTyped] = useState(id ?? "");
  const [result, setResult] = useState<Lookup>({ state: id ? "loading" : "idle" });

  useEffect(() => {
    if (!id) return;
    let live = true;
    setResult({ state: "loading" });
    lookUp(id).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [id]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = typed.trim();
    if (value) navigate(`/verify/${encodeURIComponent(value.toUpperCase())}`);
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-10 pb-20">
        <header className="flex flex-col gap-2">
          <p className="m-0 flex items-center gap-2 text-sm font-medium text-primary">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">{PRODUCT_INITIAL}</span>
            {PRODUCT_NAME}
          </p>
          <h1 className="m-0 font-serif text-4xl leading-tight font-normal">Check an approval certificate</h1>
          <p className="m-0 text-sm text-muted-foreground">
            Type the number printed on the certificate, for example K7Q2-M9XD-4TPA. You’ll see whether it’s genuine.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="cert-number">Certificate number</Label>
            <Input
              id="cert-number"
              value={typed}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className="h-11 font-mono uppercase"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <Button type="submit" className="h-11" disabled={!typed.trim()}>
            <Search aria-hidden="true" /> Check
          </Button>
        </form>

        <div aria-live="polite">
          {result.state === "loading" && <p className="m-0 text-sm text-muted-foreground">Checking…</p>}
          {(result.state === "missing" || result.state === "error") && (
            <section className="flex items-start gap-3 rounded-[var(--radius-tile)] border border-warning-border bg-card px-5 py-4">
              <CircleAlert className="mt-0.5 size-5 flex-none text-warning" aria-hidden="true" />
              <div className="text-sm">
                <p className="m-0 font-medium">{result.message}</p>
                {result.state === "missing" && (
                  <p className="m-0 mt-1 text-muted-foreground">
                    Check the number for typing mistakes. If it’s right, the certificate isn’t genuine, or the agency has turned checking off.
                  </p>
                )}
              </div>
            </section>
          )}
          {result.state === "found" && <Genuine cert={result.cert} />}
        </div>
      </main>
    </div>
  );
}

function Genuine({ cert }: { cert: PublicCertificate }) {
  const current = cert.status === "current";
  const rows: [string, string][] = [
    ["Number", cert.id],
    ["Issued by", cert.agency_name],
    ["Brand", cert.brand_name],
    ["Approved by", cert.approver_kind === "client" ? `${cert.approved_by} (client)` : cert.approved_by],
    ["Approved on", when.format(new Date(cert.approved_at))],
    ["Version", String(cert.version)],
  ];
  return (
    <section className={cn("rounded-[var(--radius-tile)] border bg-card", current ? "border-success-border" : "border-warning-border")}>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <span className={cn("grid size-10 place-items-center rounded-full", current ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="m-0 text-base font-medium">This certificate is genuine</h2>
          <p className="m-0 text-sm text-muted-foreground">
            {current
              ? "It is the current approval for this post."
              : cert.status === "post_deleted"
                ? "The post has since been deleted; the record of its approval is kept."
                : "The post changed after this approval, so a newer approval replaces it."}
          </p>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Fingerprint</dt>
        <dd className="m-0 font-mono text-xs leading-5 break-all">{cert.fingerprint}</dd>
        <dt className="text-muted-foreground">Published</dt>
        <dd className="m-0">
          {cert.published.length === 0
            ? "Not yet"
            : cert.published
                .map((p) => `${PLATFORM_NAME[String(p.platform)] ?? String(p.platform)}, ${p.published_at ? when.format(new Date(String(p.published_at))) : ""}`)
                .join(" · ")}
        </dd>
      </dl>
      <p className="m-0 border-t px-5 py-3 text-xs text-muted-foreground">
        The fingerprint identifies the exact words, hashtags and media that were approved. Compare it with the one on the certificate you
        were given: if they match, nothing was changed after approval.
      </p>
    </section>
  );
}
