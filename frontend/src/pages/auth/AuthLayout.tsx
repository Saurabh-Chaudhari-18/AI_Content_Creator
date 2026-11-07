import type { ReactNode } from "react";

import { ApprovalSeal } from "@/pages/posts/Seal";

/** Sign-in / register frame: the "Sign in" artboard of the chosen design. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center px-4 py-10 sm:px-7">
      <main className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-4 md:grid-cols-12">
        <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-[var(--radius-tile)] border bg-card p-8 md:col-span-7 md:row-span-2 md:p-9">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground">O</span>
            <span className="text-base font-semibold">OmniPost</span>
          </div>
          <ApprovalSeal
            hash="e82f4c1b9a7d03e65f28c4b1d9e07a3f6b25c8d14e9f702a6b3c58d1e4f791a"
            version={2}
            state="approved"
            className="pointer-events-none absolute top-6 right-6 hidden size-28 opacity-90 md:block"
          />
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl leading-tight font-medium tracking-tight md:text-[40px]">
              Plan, approve and publish every brand’s posts — in one place.
            </h1>
            <p className="text-base text-muted-foreground">
              For small businesses and the agencies that run their social media.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-[var(--radius-tile)] border bg-card p-8 md:col-span-5 md:row-span-3 md:p-9">
          {children}
        </section>

        <section className="flex flex-col gap-1.5 rounded-[var(--radius-tile)] border border-info-border bg-info-soft p-5 text-info md:col-span-3">
          <h2 className="text-[15px] font-semibold">Approval you can prove</h2>
          <p className="text-[13px]">See who approved the exact words and photo — and get a certificate for it.</p>
        </section>
        <section className="flex flex-col gap-1.5 rounded-[var(--radius-tile)] border border-warning-border bg-warning-soft p-5 text-warning md:col-span-4">
          <h2 className="text-[15px] font-semibold">Never fails silently</h2>
          <p className="text-[13px]">
            We warn you before a connection expires and tell you plainly if a post didn’t go out. No double posts.
          </p>
        </section>
      </main>
    </div>
  );
}
