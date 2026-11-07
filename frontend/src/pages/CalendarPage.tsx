import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { PageHeader, StatusBadge, TileTitle } from "@/components/common";
import { BentoGrid, Tile } from "@/components/Tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { POST_STATUS, TONE_CLASS, timeZoneLabel } from "@/lib/format";
import { keys, useWorkspacePosts, type CalendarPost } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { NewPostButton } from "./posts/PostsPage";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 6×7 grid of local dates, starting on the Monday on/before the 1st. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function CalendarPage() {
  const { workspace, brandId, brandName } = useWorkspace();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const days = useMemo(() => monthGrid(month), [month]);
  const rangeStart = days[0]!;
  const rangeEnd = new Date(days[41]!.getFullYear(), days[41]!.getMonth(), days[41]!.getDate(), 23, 59, 59);

  const cal = useQuery({
    queryKey: [...keys.calendar(workspace?.id), brandId, rangeStart.toISOString()],
    queryFn: () =>
      api<CalendarPost[]>(`/workspaces/${workspace!.id}/calendar`, {
        query: {
          start_date: rangeStart.toISOString(),
          end_date: rangeEnd.toISOString(),
          brand_id: brandId === ALL_BRANDS ? undefined : brandId,
        },
      }),
    enabled: !!workspace,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of cal.data ?? []) {
      const at = p.published_at ?? p.scheduled_at;
      if (!at) continue;
      const k = dayKey(new Date(at));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [cal.data]);

  const unscheduled = useWorkspacePosts({ limit: 100 });
  const notOnCalendar = (unscheduled.data?.items ?? []).filter((p) => ["draft", "pending_approval", "approved"].includes(p.status));

  const today = dayKey(new Date());
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <BentoGrid>
      <div className="md:col-span-12">
        <PageHeader eyebrow="Scheduled, published and failed posts by day" title="Calendar" actions={<NewPostButton />} />
      </div>

      <Tile aria-label={monthFmt.format(month)} className="min-w-0 gap-4 md:col-span-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{monthFmt.format(month)}</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const n = new Date();
                setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => (
              <span key={d} className="px-2 text-xs font-semibold text-muted-foreground">
                {d}
              </span>
            ))}
            {days.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const items = byDay.get(k) ?? [];
              return (
                <div
                  key={k}
                  className={cn(
                    "flex min-h-[104px] flex-col gap-1 rounded-xl p-2",
                    inMonth ? "bg-muted/50" : "border border-dashed",
                    k === today && "bg-card ring-2 ring-primary",
                  )}
                >
                  <span className={cn("text-[13px] font-semibold", !inMonth && "font-medium text-muted-foreground", k === today && "text-primary")}>
                    {d.getDate()}
                  </span>
                  {cal.isLoading && inMonth && d.getDate() % 9 === 0 && <Skeleton className="h-5" />}
                  {items.map((p) => {
                    const at = p.published_at ?? p.scheduled_at;
                    const tone = POST_STATUS[p.status]?.tone ?? "neutral";
                    return (
                      <Link
                        key={p.id}
                        to={`/posts/${p.id}`}
                        title={`${p.title || "Untitled"} · ${brandName(p.brand_id)} · ${POST_STATUS[p.status]?.label ?? p.status}`}
                        className={cn("block truncate rounded-md px-1.5 py-0.5 text-xs font-semibold no-underline", TONE_CLASS[tone])}
                      >
                        {at ? timeFmt.format(new Date(at)) : ""} {p.title || "Untitled"}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span><span aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-sm bg-info-soft ring-1 ring-info-border" />Scheduled</span>
          <span><span aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-sm bg-success-soft ring-1 ring-success-border" />Published</span>
          <span><span aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-sm bg-danger-soft ring-1 ring-danger-border" />Didn’t publish</span>
        </div>
      </Tile>

      <div className="flex flex-col gap-4 md:col-span-3">
        <Tile aria-labelledby="notyet-h">
          <TileTitle id="notyet-h">Not on the calendar yet</TileTitle>
          {unscheduled.isLoading ? (
            <Skeleton className="h-24" />
          ) : notOnCalendar.length === 0 ? (
            <p className="m-0 text-muted-foreground">Everything is scheduled.</p>
          ) : (
            <ul className="m-0 flex flex-col gap-2 p-0">
              {notOnCalendar.slice(0, 8).map((p) => (
                <li key={p.id} className="list-none">
                  <Link to={`/posts/${p.id}`} className="flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-foreground no-underline hover:bg-muted/60">
                    <span className="font-semibold">{p.title || "Untitled post"}</span>
                    <StatusBadge status={p.status} className="self-start" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile tone="info">
          <TileTitle>Times are in {timeZoneLabel()}</TileTitle>
          <p className="m-0 text-[13px]">Posts go out from our servers, so your computer can be off.</p>
        </Tile>
      </div>
    </BentoGrid>
  );
}
