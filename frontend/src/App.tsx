import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { AppShell } from "@/app/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { WorkspaceProvider } from "@/lib/workspace";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";

// Each screen is its own chunk: the sign-in page doesn't download Post Studio.
const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const PostsPage = lazy(() => import("@/pages/posts/PostsPage").then((m) => ({ default: m.PostsPage })));
const PostStudioPage = lazy(() => import("@/pages/posts/PostStudioPage").then((m) => ({ default: m.PostStudioPage })));
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const AccountsPage = lazy(() => import("@/pages/AccountsPage").then((m) => ({ default: m.AccountsPage })));
const BrandsPage = lazy(() => import("@/pages/BrandsPage").then((m) => ({ default: m.BrandsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SetPasswordPage = lazy(() => import("@/pages/auth/SetPasswordPage").then((m) => ({ default: m.SetPasswordPage })));
// The client approval page is public and tiny: its own chunk.
const ClientApprovalPage = lazy(() => import("@/pages/ClientApprovalPage").then((m) => ({ default: m.ClientApprovalPage })));
// The staff console is its own chunk: customers never download it.
const AdminRoutes = lazy(() => import("@/admin/AdminRoutes"));

function FullPageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <Skeleton className="h-10 w-40" />
    </div>
  );
}

function PageLoading() {
  return (
    <div className="mx-auto grid max-w-[1360px] gap-4 px-4 pt-5 sm:px-7 md:grid-cols-12" role="status" aria-label="Loading">
      <Skeleton className="h-24 md:col-span-12" />
      <Skeleton className="h-64 md:col-span-8" />
      <Skeleton className="h-64 md:col-span-4" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageLoading />;
  if (status === "signed-out") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === "loading") return <FullPageLoading />;
  if (status === "signed-in") return <Navigate to={user?.platform_role === "super_admin" ? "/admin" : "/"} replace />;
  return children;
}

/** The staff console: platform staff only. Everyone else is sent home (the API answers them 404 anyway). */
function RequireStaff({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageLoading />;
  if (status === "signed-out") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user?.platform_role !== "super_admin") return <Navigate to="/" replace />;
  return children;
}

/** A screen inside the app shell: a crash shows a message there, the navigation keeps working. */
function Page({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Keyed by path: navigating away from a crashed screen clears the error.
  // A navigation carrying { keepScreenFrom: <the path it left> } keeps the
  // screen mounted: Post Studio uses it when a new post gets its id, so the
  // editor (and what the user is typing) stays put instead of remounting.
  // Only honoured when we really came from that path (not on a later Back).
  const previous = useRef(location.pathname);
  const keepFrom = (location.state as { keepScreenFrom?: string } | null)?.keepScreenFrom;
  const key = keepFrom && keepFrom === previous.current ? previous.current : location.pathname;
  useEffect(() => {
    previous.current = key;
  }, [key]);
  return (
    <ErrorBoundary key={key}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const page = (el: ReactNode) => <Page>{el}</Page>;

export default function App() {
  return (
    <ErrorBoundary fullPage>
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      {/* Setup links from the staff console point here; open to anyone holding a link. */}
      <Route path="/set-password" element={<Suspense fallback={<FullPageLoading />}><SetPasswordPage /></Suspense>} />
      {/* Client approval links (/a#<token>): no sign-in, the token stays in the fragment. */}
      <Route path="/a" element={<Suspense fallback={<FullPageLoading />}><ClientApprovalPage /></Suspense>} />
      <Route path="/admin/*" element={<RequireStaff><Suspense fallback={<FullPageLoading />}><AdminRoutes /></Suspense></RequireStaff>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={page(<HomePage />)} />
        <Route path="posts" element={page(<PostsPage />)} />
        {/* One route for new and existing posts ("/posts/new" is id "new"), so a
            new post getting its id does not swap the screen out. */}
        <Route path="posts/:id" element={page(<PostStudioPage />)} />
        <Route path="calendar" element={page(<CalendarPage />)} />
        <Route path="templates" element={page(<TemplatesPage />)} />
        <Route path="accounts" element={page(<AccountsPage />)} />
        {/* Facebook's OAuth callback redirects to FRONTEND_URL/social-accounts */}
        <Route path="social-accounts" element={page(<AccountsPage />)} />
        <Route path="brands" element={page(<BrandsPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
