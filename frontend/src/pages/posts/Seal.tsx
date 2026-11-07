import { Printer } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
    ? `APPROVED · V${version} · ${shortHash(hash).toUpperCase()} · OMNIPOST ·`
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

export type CertificateData = {
  brandName: string;
  postTitle: string;
  version: number;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  submittedBy: string;
  approvedBy: string;
  approvedAt: string;
  hash: string;
};

const certDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });

/** A one-page approval certificate. "Print or save as PDF" prints only this page. */
export function ApprovalCertificate({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: CertificateData }) {
  const tags = data.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const rows: [string, string][] = [
    ["Brand", data.brandName],
    ["Post", `${data.postTitle} · version ${data.version}`],
    ["Submitted by", data.submittedBy],
    ["Approved by", data.approvedBy],
    ["Approved on", certDate.format(new Date(data.approvedAt))],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="cert-print gap-0 border-0 bg-transparent p-0 text-[#1a2030] shadow-none sm:max-w-[760px]">
        <article className="overflow-hidden rounded-2xl bg-[#fbfaf6] shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)] print:shadow-none">
          <header className="flex items-start justify-between gap-6 px-6 pt-8 sm:px-10 sm:pt-10">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-[#3730a3]">
                <span className="grid size-6 place-items-center rounded-md bg-[#4f46e5] text-xs text-white">O</span>OmniPost
              </p>
              <DialogTitle className="mt-6 font-serif text-4xl leading-[1.05] font-normal tracking-[-0.02em] text-[#141a29] sm:text-[44px]">
                Approval certificate
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-[#4b5565]">Proof of exactly what was approved, by whom, and when</DialogDescription>
            </div>
            <ApprovalSeal hash={data.hash} version={data.version} state="approved" className="-mt-2 hidden size-[136px] flex-none sm:block" />
          </header>

          <div className="mx-6 mt-8 flex gap-5 rounded-xl border border-[#e5e2da] bg-white p-4 sm:mx-10">
            {data.imageUrl && <img src={data.imageUrl} alt="" className="size-24 flex-none rounded-lg object-cover" />}
            <div className="min-w-0">
              <p className="m-0 text-xs text-[#6b7487]">Approved content</p>
              <p className="m-0 mt-1 text-sm leading-5 whitespace-pre-line text-[#141a29]">{data.caption}</p>
              {tags && <p className="m-0 mt-1 text-sm text-[#3d5bd9]">{tags}</p>}
            </div>
          </div>

          <dl className="mx-6 mt-6 grid grid-cols-[120px_1fr] gap-x-6 gap-y-3 text-sm sm:mx-10 sm:grid-cols-[140px_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[#6b7487]">{k}</dt>
                <dd className="m-0 text-[#141a29]">{v}</dd>
              </div>
            ))}
            <dt className="text-[#6b7487]">Fingerprint</dt>
            <dd className="m-0 font-mono text-xs leading-5 break-all text-[#141a29]">{data.hash}</dd>
          </dl>

          <footer className="mx-6 mt-8 mb-8 flex flex-wrap items-end justify-between gap-6 border-t border-[#e5e2da] pt-5 sm:mx-10 sm:mb-10">
            <p className="m-0 max-w-md text-xs leading-5 text-[#4b5565]">
              The fingerprint is a SHA-256 of the caption, hashtags, call to action, media and per-channel wording. OmniPost checks it
              again right before publishing. If anything changed, nothing is published and the post returns for approval.
            </p>
            <p className="m-0 flex-none font-mono text-xs text-[#6b7487]">No. OP-{data.hash.slice(0, 8).toUpperCase()}</p>
          </footer>
        </article>
        <div className="no-print mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 text-foreground" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="btn-depth h-10" onClick={() => window.print()}>
            <Printer aria-hidden="true" /> Print or save as PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
