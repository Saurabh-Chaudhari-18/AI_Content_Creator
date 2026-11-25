import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

export async function signIn(page: Page, a: Account) {
  await open(page, "/login");
  await page.getByLabel("Email").fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(a.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Your Studio/ })).toBeVisible();
}

/** Uncaught script errors break a screen; collect them so a test can fail on them. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
