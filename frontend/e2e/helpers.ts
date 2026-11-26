import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { E2E_DIR, PYTHON } from "./paths";

export type Account = { email: string; password: string; token: string; workspaceId: string };

let counter = 0;

/** A fresh one-person workspace (its owner may approve their own posts). */
export async function newAccount(request: APIRequestContext, name = "Test Owner"): Promise<Account> {
  const email = `e2e-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = "e2e-password-123";
  const r = await request.post("/api/v1/auth/register", { data: { email, password, full_name: name } });
  expect(r.status(), await r.text()).toBe(201);
  const token = (await r.json()).access_token as string;
  const ws = await request.get("/api/v1/workspaces", { headers: { Authorization: `Bearer ${token}` } });
  return { email, password, token, workspaceId: (await ws.json())[0].id };
}

export async function newBrandAndPost(request: APIRequestContext, a: Account, caption = "Fresh croissants every morning. Come early!") {
  const headers = { Authorization: `Bearer ${a.token}` };
  const brand = await (await request.post(`/api/v1/workspaces/${a.workspaceId}/brands`, {
    headers, data: { name: "Sunrise Bakery", industry: "bakery" },
  })).json();
  const post = await request.post(`/api/v1/brands/${brand.id}/posts`, {
    headers, data: { title: "Morning croissants", caption, hashtags: ["bakery", "fresh"] },
  });
  expect(post.status(), await post.text()).toBe(201);
  return { brandId: brand.id as string, postId: (await post.json()).id as string };
}

/** Open a page. Retries once when the browser drops a navigation that started
 * while the app was still changing its own address (seen in Firefox). */
export async function open(page: Page, path: string) {
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  } catch (e) {
    if (!/NS_ERROR_FAILURE|NS_BINDING_ABORTED|interrupted/.test(String(e))) throw e;
    await page.waitForLoadState("domcontentloaded");
    await page.goto(path, { waitUntil: "domcontentloaded" });
  }
}

export async function signIn(page: Page, a: { email: string; password: string }, landsOn: RegExp = /Your Studio/) {
  await open(page, "/login");
  await page.getByLabel("Email").fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  const landed = page.getByRole("heading", { name: landsOn }).first();
  const refused = page.getByRole("alert");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Safari's engine sometimes drops a click while the page is still settling:
  // if neither the next screen nor an error appears, press the button again.
  try {
    await expect(landed.or(refused).first()).toBeVisible({ timeout: 15_000 });
  } catch {
    if (await page.getByRole("button", { name: "Sign in" }).isEnabled()) {
      await page.getByRole("button", { name: "Sign in" }).click();
    }
  }
  await expect(landed).toBeVisible();
  // Let the first screen finish loading: leaving it mid-request makes Safari
  // report the cancelled request as a script error.
  await page.waitForLoadState("networkidle");
}

/** The newest queued email of one kind, read from the test database (no mail provider needed). */
export function readEmail(to: string, kind: string): string {
  return execFileSync(PYTHON, [path.join(E2E_DIR, "read_email.py"), to, kind], { encoding: "utf-8" });
}

/** The first link in an email that matches a pattern. */
export function linkIn(text: string, pattern: RegExp): string {
  const found = text.match(pattern);
  expect(found, `no link matching ${pattern} in the email`).not.toBeNull();
  return found![0];
}

/** Fill the staff console's change slip (its reason is required) and confirm.
 * Returns the slip, still open when it shows a result (a setup link). */
export async function confirmSlip(page: Page, confirm: string, fields: Record<string, string> = {}): Promise<Locator> {
  const slip = page.locator("dialog[open]");
  await expect(slip).toBeVisible();
  for (const [label, value] of Object.entries(fields)) {
    const field = slip.getByLabel(label, { exact: true });
    // Dropdowns take the visible option text; everything else is typed.
    if ((await field.evaluate((e) => e.tagName)) === "SELECT") await field.selectOption({ label: value });
    else await field.fill(value);
  }
  await slip.getByLabel("Reason", { exact: true }).fill("Browser test");
  await slip.getByRole("button", { name: confirm, exact: true }).click();
  return slip;
}

/** After a change the slip either closes by itself or shows "Done"; end up closed. */
export async function finishSlip(page: Page) {
  const slips = page.locator("dialog[open]");
  const done = slips.getByRole("button", { name: "Done", exact: true });
  await expect.poll(async () => (await slips.count()) === 0 || (await done.isVisible())).toBe(true);
  if (await slips.count()) await done.click();
  await expect(slips).toHaveCount(0);
}

/** Uncaught script errors break a screen; collect them so a test can fail on them. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    // Safari's engine reports a request to our own API that a page change
    // cancelled as "...due to access control checks". That is the browser
    // dropping an unfinished request, not an error in the app.
    if (/\/api\/v1\/\S* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  return errors;
}

/** Nothing sticks out sideways: no page-wide horizontal scrolling. */
export async function expectNoSideways(page: Page, where: string) {
  const { scroll, view } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: window.innerWidth,
  }));
  expect(scroll, `${where} is wider than the screen (${scroll}px > ${view}px)`).toBeLessThanOrEqual(view + 1);
}
