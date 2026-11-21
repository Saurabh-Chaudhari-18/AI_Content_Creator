import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { initMonitoring } from "@/lib/monitoring";
import { ThemeProvider } from "@/lib/theme";

import App from "./App";
import "./index.css";

initMonitoring();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the API on 4xx: those won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// A data router (not <BrowserRouter>) so screens can use useBlocker to stop
// navigation away from unsaved edits. App keeps its own <Routes> inside.
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AuthProvider>
        <App />
      </AuthProvider>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
