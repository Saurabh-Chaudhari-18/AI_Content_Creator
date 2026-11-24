import { Printer } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";

import { SafeImage } from "@/components/SafeImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { useCertificate, verifyUrl, type Certificate } from "@/lib/approvals";
import { PLATFORM_NAME, ROLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRODUCT_INITIAL, PRODUCT_NAME } from "@/lib/product";

/** "e82f…91a" — the readable short form of a content fingerprint. */
export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 4)}…${hash.slice(-3)}` : "";
}

/**
 * The approval seal: the post's content fingerprint pressed into indigo wax.
 * "waiting" is the empty seal while a post waits for approval.
 */
export function ApprovalSeal({
  hash,
  version,
  state,
  stamp = false,
  className,
}: {
  hash: string;
  version: number;
  state: "approved" | "waiting";
  stamp?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ring = state === "approved"
    ? `APPROVED · V${version} · ${shortHash(hash).toUpperCase()} · ${PRODUCT_NAME.toUpperCase()} ·`
    : `AWAITING APPROVAL · V${version} · ${shortHash(hash).toUpperCase()} ·`;
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label={state === "approved" ? `Approval seal for version ${version}, fingerprint ${shortHash(hash)}` : "Seal waiting for approval"}
      className={cn("seal", stamp && "seal-stamp", state === "waiting" && "[filter:none]", className)}
    >
      <defs>
        <radialGradient id={`wax-${id}`} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#a5abff" />
          <stop offset="0.45" stopColor="#6366f1" />
          <stop offset="1" stopColor="#312e81" />
        </radialGradient>
        <path id={`ring-${id}`} d="M60,60 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0" />
      </defs>
      {state === "approved" ? (
        <>
          <circle cx="60" cy="60" r="57" fill={`url(#wax-${id})`} />
          <circle cx="60" cy="60" r="57" fill="none" stroke="#c7cbff" strokeOpacity="0.35" />
          <circle cx="60" cy="60" r="50" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeDasharray="1.5 3" />
          <circle cx="60" cy="60" r="31" fill="#4338ca" fillOpacity="0.45" stroke="#ffffff" strokeOpacity="0.3" />
          <text fill="#eef0ff" fontFamily="JetBrains Mono Variable, monospace" fontSize="8.6" fontWeight="500" letterSpacing="1.9">
            <textPath href={`#ring-${id}`}>{ring}</textPath>
          </text>
          {/* stamp glyph */}
          <g transform="translate(48 44)" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 22h14" />
            <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
            <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.69 0-3 1-3 3s1 2 1 3.5V13" />
          </g>
          <text x="60" y="80" textAnchor="middle" fill="#e0e3ff" fontFamily="JetBrains Mono Variable, monospace" fontSize="7" letterSpacing="1">
            SEALED
          </text>
        </>
      ) : (
        <>
          <circle cx="60" cy="60" r="57" className="fill-surface-subtle" />
          <circle cx="60" cy="60" r="57" fill="none" stroke="#fbbf24" strokeOpacity="0.5" strokeDasharray="3 4" />
          <circle cx="60" cy="60" r="31" fill="none" className="stroke-border" />
          <text fill="#f59e0b" fontFamily="JetBrains Mono Variable, monospace" fontSize="8.6" letterSpacing="1.9">
            <textPath href={`#ring-${id}`}>{ring}</textPath>
          </text>
          <g transform="translate(48 48)" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-muted-foreground">
            <path d="M5 22h14" />
            <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
            <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.69 0-3 1-3 3s1 2 1 3.5V13" />
          </g>
        </>
      )}
    </svg>
  );
}

type CertificateView = Certificate;

const certDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function fmt(iso: string | null | undefined, style: Intl.DateTimeFormat = certDate): string {
  return iso ? style.format(new Date(iso)) : "—";
}

/** "3 h 20 min", "2 days 4 h" — how long a decision took. */
function duration(fromIso: string | null | undefined, toIso: string | null | undefined): string | null {
  if (!fromIso || !toIso) return null;
  const min = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `${Math.floor(h / 24)} days${h % 24 ? ` ${h % 24} h` : ""}`;
}

const TRAIL_TEXT: Record<string, string> = {
  submitted: "Sent for approval",
  approved: "Approved",
  rejected: "Changes requested",
  invalidated: "Back to draft",
  reassigned: "Reviewer changed",
};

type Approval = {
  brand_name?: string;
  workspace_name?: string;
  submitted_by?: string | null;
  submitted_at?: string | null;
  due_at?: string | null;
  approver?: { name: string; kind: string; role: string | null };
  assigned_name?: string | null;
  acted_by_assignee?: boolean | null;
  link?: { recipient_name: string; sent_by: string; sent_at: string; first_viewed_at: string | null; decided_at: string | null } | null;
  reminders?: { system: number; manual: number };
  backfilled?: boolean;
};

type Content = { title?: string | null; caption?: string; hashtags?: string[]; cta?: string | null; platforms?: { platform: string; text: string }[] };

function CertificateBody({ cert, onCopy }: { cert: CertificateView; onCopy: () => void }) {
  const a = cert.approval as Approval;
  const c = cert.content as Content;
  const tags = (c.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const approver = a.approver;
  const approverText = approver
    ? approver.kind === "client"
      ? `${approver.name} (client, through an approval link)`
      : `${approver.name}${approver.role ? `, ${ROLE_LABEL[approver.role] ?? approver.role}` : ""}`
    : "—";
  const onTime = a.due_at ? new Date(cert.approved_at) <= new Date(a.due_at) : null;
  const rows: [string, string][] = [
    ["Brand", a.brand_name ?? "—"],
    ["Post", `${c.title || "Untitled post"} · version ${cert.version}`],
    ["Sent by", `${a.submitted_by ?? "—"}${a.submitted_at ? ` · ${fmt(a.submitted_at)}` : ""}`],
  ];
  if (a.due_at) rows.push(["Needed by", `${fmt(a.due_at)}${onTime === null ? "" : onTime ? " · approved in time" : " · approved after the deadline"}`]);
  rows.push(["Approved by", approverText]);
  if (a.acted_by_assignee === false && a.assigned_name) rows.push(["On behalf of", a.assigned_name]);
  rows.push(["Approved on", fmt(cert.approved_at)]);
  const took = duration(a.submitted_at, cert.approved_at);
  if (took) rows.push(["Time to approve", took]);
  const reminders = a.reminders && a.reminders.system + a.reminders.manual > 0
    ? [a.reminders.system && `${a.reminders.system} automatic`, a.reminders.manual && `${a.reminders.manual} sent by the team`].filter(Boolean).join(", ")
    : null;
  if (reminders) rows.push(["Reminders", reminders]);

  return (
    <article className="overflow-hidden rounded-2xl bg-[#fbfaf6] shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)] print:rounded-none print:shadow-none">
      <header className="flex items-start justify-between gap-6 px-6 pt-8 sm:px-10 sm:pt-10">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-[#3730a3]">
            <span className="grid size-6 place-items-center rounded-md bg-[#4f46e5] text-xs text-white">{PRODUCT_INITIAL}</span>
              {PRODUCT_NAME}
          </p>
          <DialogTitle className="mt-6 font-serif text-4xl leading-[1.05] font-normal tracking-[-0.02em] text-[#141a29] sm:text-[44px]">
            Approval certificate
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-[#4b5565]">Proof of exactly what was approved, by whom, and when</DialogDescription>
          <p className="m-0 mt-3 font-mono text-xs tracking-wide text-[#3730a3]">No. {cert.id}</p>
        </div>
        <ApprovalSeal hash={cert.fingerprint} version={cert.version} state="approved" className="-mt-2 hidden size-[136px] flex-none sm:block" />
      </header>

      {cert.status !== "current" && (
        <p className="mx-6 mt-6 rounded-lg border border-[#e8c98a] bg-[#fdf3dc] px-4 py-2.5 text-sm text-[#7a4a00] sm:mx-10">
          {cert.status === "post_deleted"
            ? "The post has since been deleted. This record of the approval is kept."
            : `Superseded: the post changed after this approval${cert.superseded_by ? ` and was approved again (No. ${cert.superseded_by})` : ""}.`}
        </p>
      )}

      <section className="mx-6 mt-8 rounded-xl border border-[#e5e2da] bg-white p-4 [break-inside:avoid] sm:mx-10">
        <p className="m-0 text-xs text-[#6b7487]">Approved content</p>
        {cert.media.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {cert.media.map((m) =>
              m.url ? (
                <SafeImage
                  key={m.order}
                  src={m.url}
                  alt={m.alt_text ?? ""}
                  className="size-20 rounded-lg object-cover"
                  fallback={
                    <span className="grid size-20 place-items-center rounded-lg border border-dashed border-[#d6d2c8] text-center text-[10px] text-[#6b7487]">
                      {m.media_type} {m.order + 1}
                      <br />
                      couldn’t load
                    </span>
                  }
                />
              ) : (
                <span key={m.order} className="grid size-20 place-items-center rounded-lg border border-dashed border-[#d6d2c8] text-center text-[10px] text-[#6b7487]">
                  {m.media_type} {m.order + 1}
                  <br />
                  removed
                </span>
              ),
            )}
          </div>
        )}
        <p className="m-0 mt-2 text-sm leading-5 whitespace-pre-line text-[#141a29]">{c.caption}</p>
        {tags && <p className="m-0 mt-1 text-sm text-[#3d5bd9]">{tags}</p>}
        {c.cta && <p className="m-0 mt-1 text-sm text-[#141a29]">Call to action: {c.cta}</p>}
      </section>

      {(c.platforms?.length ?? 0) > 0 && (
        <section className="mx-6 mt-4 sm:mx-10">
          <p className="m-0 text-xs text-[#6b7487]">Exactly as it goes out on each channel</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {c.platforms!.map((p) => (
              <div key={p.platform} className="rounded-lg border border-[#e5e2da] bg-white px-3 py-2 [break-inside:avoid]">
                <p className="m-0 text-xs font-medium text-[#3730a3]">{PLATFORM_NAME[p.platform] ?? p.platform}</p>
                <p className="m-0 mt-1 line-clamp-6 text-xs leading-5 whitespace-pre-line text-[#141a29] print:line-clamp-none">{p.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <dl className="mx-6 mt-6 grid grid-cols-[120px_1fr] gap-x-6 gap-y-3 text-sm sm:mx-10 sm:grid-cols-[150px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[#6b7487]">{k}</dt>
            <dd className="m-0 text-[#141a29]">{v}</dd>
          </div>
        ))}
        {a.link && (
          <>
            <dt className="text-[#6b7487]">Client link</dt>
            <dd className="m-0 text-[#141a29]">
              Sent to {a.link.recipient_name} by {a.link.sent_by} on {fmt(a.link.sent_at, shortDate)}
              {a.link.first_viewed_at ? `, first opened ${fmt(a.link.first_viewed_at, shortDate)}` : ""}
              {a.link.decided_at ? `, answered ${fmt(a.link.decided_at, shortDate)}` : ""}
            </dd>
          </>
        )}
        <dt className="text-[#6b7487]">Fingerprint</dt>
        <dd className="m-0 font-mono text-xs leading-5 break-all text-[#141a29]">{cert.fingerprint}</dd>
      </dl>

      {cert.trail.length > 0 && (
        <section className="mx-6 mt-6 [break-inside:avoid] sm:mx-10">
          <p className="m-0 text-xs text-[#6b7487]">Review history</p>
          <ol className="m-0 mt-2 flex flex-col gap-1.5 p-0">
            {(cert.trail as unknown as { action: string; by: string; at: string; note: string | null; via_link: boolean }[]).map((s, i) => (
              <li key={i} className="flex list-none flex-wrap gap-x-3 text-xs text-[#141a29]">
                <span className="w-32 flex-none font-mono text-[#6b7487]">{fmt(s.at, shortDate)}</span>
                <span>
                  {TRAIL_TEXT[s.action] ?? s.action} · {s.by}
                  {s.via_link ? " (client link)" : ""}
                  {s.note ? <span className="text-[#6b7487]"> — “{s.note}”</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mx-6 mt-6 [break-inside:avoid] sm:mx-10">
        <p className="m-0 text-xs text-[#6b7487]">Published</p>
        {cert.published.length === 0 ? (
          <p className="m-0 mt-1 text-sm text-[#4b5565]">Not published yet.</p>
        ) : (
          <ul className="m-0 mt-2 flex flex-col gap-1.5 p-0">
            {cert.published.map((p, i) => (
              <li key={i} className="flex list-none flex-wrap items-baseline gap-x-2 text-sm text-[#141a29]">
                <span className="font-medium">{PLATFORM_NAME[p.platform] ?? p.platform}</span>
                {p.account_name && <span className="text-[#6b7487]">{p.account_name}</span>}
                <span>
                  {p.status === "completed"
                    ? `went out ${fmt(p.published_at, shortDate)}`
                    : p.status === "needs_review"
                      ? "outcome unknown, being checked"
                      : p.status === "failed"
                        ? "didn’t publish"
                        : "waiting to publish"}
                </span>
                {p.matched_fingerprint && <span className="text-xs text-[#15803d]">· matched the approved fingerprint</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#3d5bd9] print:hidden">
                    View post
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mx-6 mt-8 mb-8 flex flex-wrap items-end justify-between gap-6 border-t border-[#e5e2da] pt-5 sm:mx-10 sm:mb-10">
        <p className="m-0 max-w-md text-xs leading-5 text-[#4b5565]">
          The fingerprint is a SHA-256 of the caption, hashtags, call to action, media and per-channel wording. {PRODUCT_NAME} checks it again right
          before publishing. If anything changed, nothing is published and the post returns for approval.
          {cert.verification_enabled && (
            <>
              {" "}
              Anyone can check this certificate at <span className="font-mono break-all text-[#3730a3]">{verifyUrl(cert.id)}</span>
            </>
          )}
        </p>
        <div className="flex flex-col items-end gap-1">
          <p className="m-0 flex-none font-mono text-xs text-[#6b7487]">Issued {fmt(cert.issued_at, shortDate)}</p>
          {a.backfilled && <p className="m-0 text-[10px] text-[#6b7487]">Issued from the approval record</p>}
          {cert.verification_enabled && (
            <button type="button" onClick={onCopy} className="no-print text-xs text-[#3d5bd9] underline-offset-2 hover:underline">
              Copy verify link
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

/** The approval certificate, built by the server from the approval record.
 * "Print or save as PDF" prints only this sheet. */
export function ApprovalCertificate({ open, onOpenChange, postId }: { open: boolean; onOpenChange: (o: boolean) => void; postId: string }) {
  const cert = useCertificate(postId, open);
  async function copyVerify() {
    if (!cert.data) return;
    try {
      await navigator.clipboard.writeText(verifyUrl(cert.data.id));
      toast.success("Verify link copied.");
    } catch {
      toast.error("Couldn’t copy the link.");
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="cert-print max-h-[92svh] gap-0 overflow-y-auto border-0 bg-transparent p-0 text-[#1a2030] shadow-none sm:max-w-[760px]"
      >
        {cert.isLoading ? (
          <div className="rounded-2xl bg-[#fbfaf6] p-10 text-sm text-[#4b5565]">
            <DialogTitle className="sr-only">Approval certificate</DialogTitle>
            <DialogDescription>Loading the certificate…</DialogDescription>
          </div>
        ) : cert.isError || !cert.data ? (
          <div className="rounded-2xl bg-[#fbfaf6] p-10 text-sm text-[#4b5565]">
            <DialogTitle className="sr-only">Approval certificate</DialogTitle>
            <DialogDescription>
              {cert.error instanceof ApiError ? cert.error.message : "Couldn’t load the certificate. Try again in a moment."}
            </DialogDescription>
          </div>
        ) : (
          <CertificateBody cert={cert.data} onCopy={copyVerify} />
        )}
        <div className="no-print mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 text-foreground" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="btn-depth h-10" disabled={!cert.data} onClick={() => window.print()}>
            <Printer aria-hidden="true" /> Print or save as PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
