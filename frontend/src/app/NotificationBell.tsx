/** In-app notifications (D10): an unread badge polled every 30 s, a list on click. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { approvalKeys, useNotifications, useUnreadCount, type AppNotification } from "@/lib/approvals";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

export function NotificationBell({ side, className }: { side: "right" | "bottom"; className?: string }) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const count = unread.data?.unread ?? 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: approvalKeys.unread(workspace?.id) });
    qc.invalidateQueries({ queryKey: approvalKeys.notifications(workspace?.id) });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/workspaces/${workspace!.id}/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api(`/workspaces/${workspace!.id}/notifications/read-all`, { method: "POST" }),
    onSuccess: refresh,
  });

  function openItem(n: AppNotification) {
    if (!n.read_at) markRead.mutate(n.id);
    setOpen(false);
    if (n.post_id) navigate(`/posts/${n.post_id}`);
  }

  const items = list.data?.items ?? [];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        className={cn(
          "relative grid size-10 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        <Bell className="size-5" strokeWidth={1.5} aria-hidden="true" />
        {count > 0 && (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={side === "right" ? "end" : "end"} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        {/* Every action is a menu item, so arrow keys reach it and Enter opens it
            (plain buttons inside a menu can't be reached from the keyboard). */}
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-sm font-medium">Notifications</span>
          <DropdownMenuItem
            disabled={!count || markAll.isPending}
            onSelect={(e) => {
              e.preventDefault(); // keep the list open
              markAll.mutate();
            }}
          >
            <CheckCheck aria-hidden="true" /> Mark all as read
          </DropdownMenuItem>
        </div>
        <div className="max-h-[60svh] overflow-y-auto">
          {list.isLoading && <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {!list.isLoading && items.length === 0 && (
            <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. Approvals and client answers show up here.</p>
          )}
          {items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onSelect={() => openItem(n)}
              className="items-start rounded-none border-b px-3 py-2.5 last:border-b-0 focus:bg-surface-hover focus:text-foreground"
            >
              <span aria-hidden="true" className={cn("mt-1.5 size-2 flex-none rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm leading-5", !n.read_at && "font-medium")}>{n.message}</span>
                <time dateTime={n.created_at} className="block text-xs text-muted-foreground">
                  {formatDateTime(n.created_at)}
                </time>
              </span>
              {!n.read_at && <span className="sr-only">Unread</span>}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
