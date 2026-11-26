/**
 * Browser tests (Playwright). Run from the frontend folder:
 *   npx playwright test                 every browser
 *   npx playwright test --project=iphone
 *   npx playwright show-report          the last run, with screenshots of failures
 *
 * Two servers are started for the run (or reused if already up locally):
 * - the API on :8010 with its own database `ai_content_e2e` (e2e/start_api.py),
 *   so test accounts never mix with the demo data;
 * - the web app on :5199, proxying /api to that API.
 * Needs PostgreSQL and Redis running (docker compose up -d postgres redis).
 */
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { E2E_DIR, PYTHON } from "./e2e/paths";

const CI = !!process.env.CI;
const WEB_PORT = 5199;
const API_PORT = 8010;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The dev server serves every source file separately, which is slow in
  // Firefox and WebKit. These limits are about that, not the app's real speed.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 2,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // Safari's engine (WebKit). Close to Safari on a Mac and an iPhone, not identical.
    { name: "safari", use: { ...devices["Desktop Safari"] } },
    // The Edge installed on this computer (not available on the CI machines).
    ...(CI ? [] : [{ name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } }]),
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
  ],
  webServer: [
    {
      command: `"${PYTHON}" "${path.resolve(E2E_DIR, "start_api.py")}"`,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
