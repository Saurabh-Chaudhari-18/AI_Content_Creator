import {
  Briefcase,
  CalendarDays,
  Check,
  ChevronsUpDown,
  House,
  Infinity as InfinityIcon,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Settings2,
  ShieldCheck,
  SquarePen,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch } from "react-router";

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
import { accountHealth } from "@/lib/accountHealth";
import { useAuth } from "@/lib/auth";
import { brandStyle, initials } from "@/lib/brandColor";
import { ROLE_LABEL } from "@/lib/format";
import { platformEnabled, useAccounts, useFeatures, useMyRole, useWorkspacePosts } from "@/lib/queries";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

import { NotificationBell } from "./NotificationBell";

type NavItem = { to: string; label: string; short?: string; icon: LucideIcon; end?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/posts", label: "Posts", icon: SquarePen },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/accounts", label: "Social accounts", short: "Accounts", icon: Link2 },
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
  // Work out "active" here rather than via NavLink's function className: the tooltip's
  // Slot merges className as plain strings and would stringify the function.
  const isActive = useMatch({ path: item.to, end: item.end ?? false }) !== null;
  return (
    <RailTip label={item.label}>
      <Link
        to={item.to}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(railButton, isActive && "bg-surface-active text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] hover:bg-surface-active")}
      >
        {isActive && <span aria-hidden="true" className="absolute top-3 bottom-3 -left-3 w-[3px] rounded-r bg-primary" />}
        <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </RailTip>
  );
}

/** Theme + sign out; shared by the sidebar, the rail and the phone header. `wide` is the sidebar's name card. */
function AccountMenu({ side, wide = false }: { side: "right" | "bottom"; wide?: boolean }) {
  const { user, logout, setThemePreference } = useAuth();
  const { theme } = useTheme();
  const role = useMyRole();
  const avatar = (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
      {initials(user?.full_name) || "?"}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          wide ? "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left hover:bg-surface-hover" : "rounded-full",
          focusRing,
        )}
        aria-label={`Account menu for ${user?.full_name ?? "you"}`}
      >
        {avatar}
        {wide && (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{user?.full_name}</span>
            <span className="truncate text-xs text-muted-foreground">{role ? ROLE_LABEL[role] : " "}</span>
          </span>
        )}
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
        {user?.platform_role === "super_admin" && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck aria-hidden="true" /> Staff console
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The "Showing" filter: all brands or one brand. Its tile wears the brand's colour. `wide` is the sidebar's labelled button. */
function BrandMenu({ side, compact = false, wide = false }: { side: "right" | "bottom"; compact?: boolean; wide?: boolean }) {
  const { brands, brandId, setBrandId } = useWorkspace();
  const current = brands.find((b) => b.id === brandId);
  const tile = current ? initials(current.name) : <LayoutGrid className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={current ? `Showing ${current.name}. Switch brand` : "Showing all brands. Switch brand"}
        style={current && !wide ? brandStyle(current) : undefined}
        className={cn(
          wide
            ? "flex min-h-[58px] w-full items-center gap-3 rounded-xl border bg-card px-3 text-left transition-colors duration-150 hover:bg-surface-hover"
            : cn(
                "grid place-items-center rounded-[10px] text-xs font-medium transition-colors duration-150",
                compact ? "size-9" : "size-10",
                current ? "brand-tile" : "border bg-card text-muted-foreground hover:text-foreground",
              ),
          focusRing,
        )}
      >
        {wide ? (
          <>
            <span
              style={current ? brandStyle(current) : undefined}
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg text-xs font-medium",
                current ? "brand-tile" : "border bg-background text-muted-foreground",
              )}
            >
              {tile}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="eyebrow" style={{ fontSize: 11 }}>
                Brand
              </span>
              <span className="truncate font-semibold">{current?.name ?? "All brands"}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        ) : (
          tile
        )}
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
  const { workspace, workspaces } = useWorkspace();
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
      <WorkspaceMenuContent side={side} />
    </DropdownMenu>
  );
}

function WorkspaceMenuContent({ side }: { side: "right" | "bottom" }) {
  const { workspace, workspaces, setWorkspaceId } = useWorkspace();
  return (
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
  );
}

/** Sidebar top: the product mark and name, with the workspace under it (a switcher when there are several). */
function SidebarWorkspace() {
  const { workspace, workspaces } = useWorkspace();
  const body = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-eyebrow/60 bg-accent text-eyebrow">
        <InfinityIcon className="size-5" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="font-display text-[21px] font-semibold text-foreground">OmniPost</span>
        <span className="truncate text-xs text-muted-foreground">{workspace?.name ?? " "}</span>
      </span>
    </span>
  );
  if (workspaces.length <= 1) {
    return (
      <Link to="/" aria-label="OmniPost home" className={cn("flex rounded-xl px-1 py-1 no-underline", focusRing)}>
        {body}
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Workspace: ${workspace?.name ?? ""}. Switch workspace`}
        className={cn("flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-surface-hover", focusRing)}
      >
        {body}
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <WorkspaceMenuContent side="right" />
    </DropdownMenu>
  );
}

/** Counts shown next to sidebar items: posts waiting for approval, accounts that need fixing. */
function useNavCounts() {
  const pending = useWorkspacePosts({ status: "pending_approval", limit: 1 });
  const accounts = useAccounts();
  const features = useFeatures();
  const toFix = (accounts.data ?? []).filter(
    (a) => accountHealth(a, platformEnabled(features.data, a.platform)).tone !== "success",
  ).length;
  return { pending: pending.data?.total ?? 0, toFix };
}

type SideItem = { to: string; label: string; icon: LucideIcon; active: boolean; badge?: ReactNode };

function SideLink({ item }: { item: SideItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] no-underline transition-colors duration-150",
        item.active
          ? "btn-depth font-semibold text-primary-foreground"
          : "font-medium text-secondary-foreground hover:bg-surface-hover hover:text-foreground",
        focusRing,
      )}
    >
      <Icon className="size-[19px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge}
    </Link>
  );
}

function Count({ children, label, active, tone }: { children: ReactNode; label: string; active: boolean; tone: "warning" | "danger" }) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-xs font-bold",
        active
          ? "border-white/40 text-primary-foreground"
          : tone === "warning"
            ? "border-warning-border bg-warning-soft text-warning"
            : "border-danger-border bg-danger-soft text-danger",
      )}
    >
      {children}
    </span>
  );
}

/** Desktop sidebar (lg and up): every section labelled, counts where something needs you. */
function Sidebar() {
  const { pathname, search } = useLocation();
  const { pending, toFix } = useNavCounts();
  const status = new URLSearchParams(search).get("status");
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  const approving = pathname === "/posts" && status === "pending_approval";

  const main: SideItem[] = [
    { to: "/", label: "Home", icon: House, active: pathname === "/" },
    {
      to: "/posts?status=pending_approval",
      label: "To approve",
      icon: ListChecks,
      active: approving,
      badge:
        pending > 0 ? (
          <Count label={`${pending} waiting for approval`} active={approving} tone="warning">
            {pending}
          </Count>
        ) : undefined,
    },
    { to: "/posts", label: "All posts", icon: SquarePen, active: under("/posts") && !approving },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, active: under("/calendar") },
    { to: "/templates", label: "Templates", icon: LayoutTemplate, active: under("/templates") },
  ];
  const accountsActive = under("/accounts") || under("/social-accounts");
  const workspaceItems: SideItem[] = [
    {
      to: "/accounts",
      label: "Social accounts",
      icon: Link2,
      active: accountsActive,
      badge:
        toFix > 0 ? (
          <Count label={`${toFix} need fixing`} active={accountsActive} tone="danger">
            {toFix}
          </Count>
        ) : undefined,
    },
    { to: "/brands", label: "Brands", icon: Briefcase, active: under("/brands") },
    { to: "/settings", label: "Settings", icon: Settings2, active: under("/settings") },
  ];

  return (
    <aside
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col gap-5 overflow-y-auto border-r bg-surface-subtle px-4 py-5 lg:flex"
    >
      <SidebarWorkspace />
      <BrandMenu side="right" wide />
      <nav aria-label="Sections" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          {main.map((item) => (
            <SideLink key={item.label} item={item} />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <span className="px-3.5 pb-1 text-xs font-semibold text-muted-foreground">Workspace</span>
          {workspaceItems.map((item) => (
            <SideLink key={item.label} item={item} />
          ))}
        </div>
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-1 border-t pt-4">
        <AccountMenu side="right" wide />
        <NotificationBell side="right" />
      </div>
    </aside>
  );
}

export function AppShell() {
  const { workspace } = useWorkspace();

  return (
    <TooltipProvider>
      {/* overflow-x-clip (not hidden) so decorative bleeds never cause sideways scroll and sticky headers still work */}
      <div className="min-h-svh overflow-x-clip pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] md:pb-0 md:pl-16 lg:pl-[264px]">
        {/* ── Desktop: the labelled sidebar ──────────────────────── */}
        <Sidebar />

        {/* ── Tablet: the icon rail ──────────────────────────────── */}
        <aside aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center justify-between border-r bg-surface-subtle py-4 md:flex lg:hidden">
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
            <NotificationBell side="right" />
            <RailLink item={SETTINGS} />
            <AccountMenu side="right" />
          </div>
        </aside>

        {/* ── Phone: compact top bar ─────────────────────────────── */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface-subtle px-4 md:hidden">
          <WorkspaceMark side="bottom" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace?.name ?? "…"}</span>
          <BrandMenu side="bottom" compact />
          <NotificationBell side="bottom" />
          <AccountMenu side="bottom" />
        </header>

        <Outlet />

        {/* ── Phone: bottom bar, five items; the rest under More ──── */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 border-t bg-surface-subtle pb-[env(safe-area-inset-bottom)] md:hidden">
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
