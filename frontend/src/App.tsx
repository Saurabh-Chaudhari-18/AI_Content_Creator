import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { AppShell } from "@/app/AppShell";
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
  const { status } = useAuth();
  if (status === "loading") return <FullPageLoading />;
  if (status === "signed-in") return <Navigate to="/" replace />;
  return children;
}

const page = (el: ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={page(<HomePage />)} />
        <Route path="posts" element={page(<PostsPage />)} />
        <Route path="posts/new" element={page(<PostStudioPage />)} />
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
  );
}
