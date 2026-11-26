/** The staff console's frame: sidebar, top bar, and the change slip. */
import "@fontsource-variable/host-grotesk";
import "@fontsource-variable/atkinson-hyperlegible-mono";
import "./admin.css";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { useAuth } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/product";

import { useAdmin, useOverview, type UsageReport } from "./api";
import { SlipProvider } from "./ChangeSlip";
import { CrumbsContext, labelTableCells, type Crumb } from "./ui";

const GROUPS: [string, [string, string][]][] = [
  ["Watch", [["/admin", "Overview"], ["/admin/usage", "Usage"], ["/admin/audit", "Audit trail"]]],
  ["Customers", [["/admin/workspaces", "Workspaces"], ["/admin/users", "Logins"]]],
  ["Product", [["/admin/plans", "Plans and limits"], ["/admin/features", "Feature switches"], ["/admin/templates", "Smart Templates"], ["/admin/settings", "Platform settings"]]],
];

export function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const overview = useOverview();
  const problems = useAdmin<UsageReport>(["usage-problems"], "/usage", { problems_only: true, limit: 1 });
  const problemCount = problems.data?.total ?? 0;

  // A new screen: close the menu and start at the top.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // On a phone each table row is drawn as a block of labelled values (admin.css);
  // the labels are the column heads, copied onto every cell as they render.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const label = () => labelTableCells(main);
    label();
    const mo = new MutationObserver(label);
    mo.observe(main, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const v = searchRef.current?.value.trim() ?? "";
    if (!v) return;
    navigate(v.includes("@") ? `/admin/users?q=${encodeURIComponent(v)}` : `/admin/workspaces?q=${encodeURIComponent(v)}`);
  }

  return (
    <div className="staff" data-theme="staff">
      <a className="skip" href="#admin-main">Skip to content</a>
      <div className={menuOpen ? "app is-menu-open" : "app"} onClick={(e) => { if (menuOpen && !(e.target as HTMLElement).closest(".side, .menu-btn")) setMenuOpen(false); }}>
        <aside className="side" id="admin-side" aria-label="Staff console">
          <Link className="brand" to="/admin" aria-label={`${PRODUCT_NAME} staff console, overview`}>
            <span className="brand__mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 8.5a4.5 4.5 0 1 0 0 7c1.8-1.4 5.2-5.6 7-7a4.5 4.5 0 1 1 0 7c-1.8-1.4-5.2-5.6-7-7z" />
              </svg>
            </span>
            <span className="brand__text">
              <b>{PRODUCT_NAME}</b>
              <span>Staff console</span>
            </span>
          </Link>
          <nav className="nav" aria-label="Main">
            {GROUPS.map(([group, links]) => (
              <ul className="nav__group" key={group} aria-label={group}>
                <li className="nav__label" aria-hidden="true">{group}</li>
                {links.map(([to, label]) => (
                  <li key={to}>
                    <NavLink to={to} end={to === "/admin"}>
                      {label}
                      {to === "/admin/usage" && problemCount > 0 && (
                        <span className="count" aria-label={`${problemCount} workspaces to check`}>{problemCount}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            ))}
          </nav>
          <div className="side__foot">
            <div className="whoami">
              <span className="whoami__avatar" aria-hidden="true">
                {(user?.full_name ?? "?")
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]!.toUpperCase())
                  .join("")}
              </span>
              <span className="muted">Signed in as staff</span>
              <b>{user?.full_name}</b>
              {overview.data && <span className="mono" title="The PostgreSQL role this API runs as">{overview.data.database_role}</span>}
            </div>
            <button className="btn btn--ghost" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          <header className="bar">
            <button className="btn btn--ghost menu-btn" type="button" aria-controls="admin-side" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>Menu</button>
            <ol className="crumbs" aria-label="You are here">
              {crumbs.map(([label, to], i) => (
                <li key={`${label}-${i}`} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {to && i < crumbs.length - 1 ? <Link to={to}>{label}</Link> : label}
                </li>
              ))}
            </ol>
            <div className="bar__end">
              <form className="search" role="search" onSubmit={onSearch}>
                <label className="visually-hidden" htmlFor="admin-q">Find a workspace or login</label>
                <input ref={searchRef} className="input" id="admin-q" name="q" type="search" placeholder="Find a workspace or login" autoComplete="off" />
                <kbd aria-hidden="true">Ctrl K</kbd>
              </form>
            </div>
          </header>
          <main className="page" id="admin-main" ref={mainRef} tabIndex={-1}>
            <CrumbsContext.Provider value={setCrumbs}>
              <SlipProvider>
                <Outlet />
              </SlipProvider>
            </CrumbsContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
