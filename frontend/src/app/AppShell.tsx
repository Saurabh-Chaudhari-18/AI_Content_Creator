import {
  Briefcase,
  CalendarDays,
  Check,
  House,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Settings2,
  SquarePen,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { brandStyle, initials } from "@/lib/brandColor";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

type NavItem = { to: string; label: string; short?: string; icon: LucideIcon; end?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/posts", label: "Posts", icon: SquarePen },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/accounts", label: "Connected accounts", short: "Accounts", icon: Link2 },
  { to: "/brands", label: "Brands", icon: Briefcase },
];
const SETTINGS: NavItem = { to: "/settings", label: "Settings", icon: Settings2 };
const PHONE_BAR = [NAV[0]!, NAV[1]!, NAV[2]!, NAV[4]!];
const PHONE_MORE = [NAV[3]!, NAV[5]!, SETTINGS];

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const railButton = cn(
  "relative grid size-10 place-items-center rounded-[10px] text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground",
  focusRing,
);

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <RailTip label={item.label}>
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={item.label}
        className={({ isActive }) =>
          cn(railButton, isActive && "bg-surface-active text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] hover:bg-surface-active")
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span aria-hidden="true" className="absolute top-3 bottom-3 -left-3 w-[3px] rounded-r bg-primary" />}
            <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </>
        )}
      </NavLink>
    </RailTip>
  );
}

/** Theme + sign out; shared by the rail and the phone header. */
function AccountMenu({ side }: { side: "right" | "bottom" }) {
  const { user, logout, setThemePreference } = useAuth();
  const { theme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("grid size-9 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground", focusRing)}
        aria-label={`Account menu for ${user?.full_name ?? "you"}`}
      >
        {initials(user?.full_name) || "?"}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" sideOffset={10} className="w-60">
        <DropdownMenuLabel className="flex flex-col font-normal">
          <span className="font-medium">{user?.full_name}</span>
          <span className="text-xs text-muted-foreground">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setThemePreference(v as Theme)}>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden="true" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden="true" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden="true" /> Match my device
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The "Showing" filter: all brands or one brand. Its tile wears the brand's colour. */
function BrandMenu({ side, compact = false }: { side: "right" | "bottom"; compact?: boolean }) {
  const { brands, brandId, setBrandId } = useWorkspace();
  const current = brands.find((b) => b.id === brandId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={current ? `Showing ${current.name}. Switch brand` : "Showing all brands. Switch brand"}
        style={current ? brandStyle(current) : undefined}
        className={cn(
          "grid place-items-center rounded-[10px] text-xs font-medium transition-colors duration-150",
          compact ? "size-9" : "size-10",
          current ? "brand-tile" : "border bg-card text-muted-foreground hover:text-foreground",
          focusRing,
        )}
      >
        {current ? initials(current.name) : <LayoutGrid className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={10} className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Showing</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setBrandId(ALL_BRANDS)} className="gap-3 py-2">
          <span className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground">
            <LayoutGrid className="size-4" aria-hidden="true" />
          </span>
          <span className="flex-1">All brands</span>
          {brandId === ALL_BRANDS && <Check className="text-primary" aria-label="Selected" />}
        </DropdownMenuItem>
        {brands.map((b) => (
          <DropdownMenuItem key={b.id} onSelect={() => setBrandId(b.id)} className="gap-3 py-2">
            <span style={brandStyle(b)} className="brand-tile grid size-8 place-items-center rounded-lg text-xs font-medium">
              {initials(b.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{b.name}</span>
              {b.industry && <span className="block truncate text-xs text-muted-foreground">{b.industry}</span>}
            </span>
            {brandId === b.id && <Check className="text-primary" aria-label="Selected" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The workspace mark; it switches workspace when there is more than one. */
function WorkspaceMark({ side }: { side: "right" | "bottom" }) {
  const { workspace, workspaces, setWorkspaceId } = useWorkspace();
  const name = workspace?.name ?? "OmniPost";
  const mark = (
    <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground">
      {initials(workspace?.name).slice(0, 1) || "O"}
    </span>
  );
  if (workspaces.length <= 1) {
    return (
      <RailTip label={name}>
        <NavLink to="/" aria-label={`${name} home`} className={cn("rounded-[10px]", focusRing)}>
          {mark}
        </NavLink>
      </RailTip>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Workspace: ${name}. Switch workspace`} className={cn("rounded-[10px]", focusRing)}>
        {mark}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={10} className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Workspace</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={workspace?.id} onValueChange={setWorkspaceId}>
          {workspaces.map((w) => (
            <DropdownMenuRadioItem key={w.id} value={w.id}>
              {w.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const { workspace } = useWorkspace();

  return (
    <TooltipProvider>
      <div className="min-h-svh pb-20 md:pb-0 md:pl-16">
        {/* ── Desktop: the icon rail ─────────────────────────────── */}
        <aside aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center justify-between border-r bg-surface-subtle py-4 md:flex">
          <div className="flex w-full flex-col items-center gap-4">
            <WorkspaceMark side="right" />
            <BrandMenu side="right" />
            <span aria-hidden="true" className="h-px w-8 bg-border" />
            <nav aria-label="Sections" className="flex flex-col items-center gap-1">
              {NAV.map((item) => (
                <RailLink key={item.to} item={item} />
              ))}
            </nav>
          </div>
          <div className="flex flex-col items-center gap-3">
            <RailLink item={SETTINGS} />
            <AccountMenu side="right" />
          </div>
        </aside>

        {/* ── Phone: compact top bar ─────────────────────────────── */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface-subtle px-4 md:hidden">
          <WorkspaceMark side="bottom" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace?.name ?? "…"}</span>
          <BrandMenu side="bottom" compact />
          <AccountMenu side="bottom" />
        </header>

        <Outlet />

        {/* ── Phone: bottom bar, five items; the rest under More ──── */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t bg-surface-subtle pb-[env(safe-area-inset-bottom)] md:hidden">
          {PHONE_BAR.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn("flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground no-underline", isActive && "text-foreground")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn("size-5", isActive && "text-primary")} strokeWidth={1.5} aria-hidden="true" />
                    {item.short ?? item.label}
                  </>
                )}
              </NavLink>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <MoreHorizontal className="size-5" strokeWidth={1.5} aria-hidden="true" />
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-52">
              {PHONE_MORE.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.to} asChild>
                    <NavLink to={item.to} className="no-underline">
                      <Icon aria-hidden="true" /> {item.label}
                    </NavLink>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </TooltipProvider>
  );
}
