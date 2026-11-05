import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ALL_BRANDS, useWorkspace } from "@/lib/workspace";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/posts", label: "Posts" },
  { to: "/calendar", label: "Calendar" },
  { to: "/templates", label: "Templates" },
  { to: "/accounts", label: "Accounts" },
  { to: "/brands", label: "Brands" },
  { to: "/settings", label: "Settings" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { workspace, workspaces, setWorkspaceId, brands, brandId, setBrandId } = useWorkspace();

  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-7">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-[9px] bg-primary font-bold text-primary-foreground"
            >
              {workspace ? initials(workspace.name).slice(0, 1) : "·"}
            </span>
            {workspaces.length > 1 ? (
              <Select value={workspace?.id} onValueChange={setWorkspaceId}>
                <SelectTrigger aria-label="Workspace" className="h-9 border-0 px-1 font-semibold shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-semibold">{workspace?.name ?? "…"}</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span aria-hidden="true">Showing</span>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger aria-label="Showing brand" className="h-9 min-w-36 font-semibold text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANDS}>All brands</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Wide screens: one row. Narrower: the menu gets its own row and scrolls sideways instead of wrapping. */}
          <nav
            aria-label="Main"
            className="order-last -mx-1 flex w-full gap-0.5 overflow-x-auto px-1 xl:order-none xl:mx-0 xl:w-auto xl:flex-1 xl:px-0"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "shrink-0 rounded-lg px-3 py-2.5 whitespace-nowrap text-secondary-foreground no-underline transition-colors hover:bg-muted",
                    isActive && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="ml-auto size-9 rounded-full font-semibold xl:ml-0"
                aria-label={`Account menu for ${user?.full_name ?? "you"}`}
              >
                {user ? initials(user.full_name) : "?"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col font-normal">
                <span className="font-semibold">{user?.full_name}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                <DropdownMenuRadioItem value="light">
                  <Sun aria-hidden="true" /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon aria-hidden="true" /> Dark
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
        </div>
      </header>

      <Outlet />
    </div>
  );
}
