/**
 * Warm-up before the tests. On a cold start the dev server pre-builds the app's
 * libraries on the first page load and then reloads the page, which can break
 * whichever test happens to load first. Load the app once here instead.
 */
import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of ["/login", "/verify", "/"]) {
      await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
    }
  } finally {
    await browser.close();
  }
}
