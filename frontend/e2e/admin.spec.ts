/**
 * The staff console, page by page and workflow by workflow.
 *
 * Changes that affect the whole platform (plans, the default plan, global
 * feature switches, platform settings) run in one browser only (chrome) and
 * always put things back: every browser shares one test database, so the
 * same test running in two browsers at once would flip the same switch. The
 * pages themselves are opened in every browser.
 */
import { expect, test, type Page } from "@playwright/test";

import { confirmSlip, expectNoSideways, finishSlip, newAccount, newBrandAndPost, open, signIn, watchErrors } from "./helpers";
import { STAFF } from "./paths";

const STAFF_HOME = /What needs a look|Workspaces|Logins/;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function staffSignIn(page: Page) {
  await signIn(page, STAFF, STAFF_HOME);
}

async function opens(page: Page, path: string, heading: RegExp | string) {
  await open(page, path);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSideways(page, path);
}

function onlyIn(project: string) {
  test.skip(test.info().project.name !== project, `Platform-wide change: runs in ${project} only (shared test database).`);
}

// ── Every page ─────────────────────────────────────────────────────────
test("every staff page opens cleanly", async ({ page, request }) => {
  test.slow();
  const errors = watchErrors(page);
  const customer = await newAccount(request, "Priya Pages");
  await newBrandAndPost(request, customer);
  await staffSignIn(page);

  const product: [string, RegExp][] = [
    ["/admin", /What needs a look/],
    ["/admin/workspaces", /^Workspaces/],
    ["/admin/users", /^Logins/],
    ["/admin/plans", /Plans and limits/],
    ["/admin/features", /Feature switches/],
    ["/admin/templates", /Smart Templates/],
    ["/admin/usage", /^Usage/],
    ["/admin/audit", /Audit trail/],
    ["/admin/settings", /Platform settings/],
  ];
  for (const [path, heading] of product) await opens(page, path, heading);

  // One workspace, every tab.
  for (const tab of ["features", "members", "posts", "accounts", "usage", "activity"]) {
    await opens(page, `/admin/workspaces/${customer.workspaceId}/${tab}`, /Priya Pages/);
  }
  // The customer's post is listed for staff (viewing it is recorded in their audit log).
  await open(page, `/admin/workspaces/${customer.workspaceId}/posts`);
  await expect(page.getByText("Morning croissants").first()).toBeVisible();
  expect(errors, "script errors").toEqual([]);
});

// ── Workspaces ─────────────────────────────────────────────────────────
test("workspace: create, rename, plan, trial, members, ownership, suspend", async ({ page, request }) => {
  test.slow();
  const errors = watchErrors(page);
  const owner = await newAccount(request, "Wendy Owner");
  const teammate = await newAccount(request, "Tara Teammate");
  const name = `Studio ${unique()}`;
  await staffSignIn(page);

  // Create a workspace for an existing login.
  await open(page, "/admin/workspaces");
  await page.getByRole("button", { name: "New workspace" }).first().click();
  await confirmSlip(page, "Create workspace", { "Workspace name": name, "Owner email": owner.email });
  await finishSlip(page);
  await expect(page.getByRole("heading", { name }).first()).toBeVisible();
  const workspaceId = new URL(page.url()).pathname.split("/")[3];
  expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);

  // Rename.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await confirmSlip(page, "Rename", { Name: `${name} Renamed` });
  await finishSlip(page);
  await expect(page.getByRole("heading", { name: `${name} Renamed` }).first()).toBeVisible();

  // Change the plan to Pro (the seeded plan with room for a team; Free allows
  // one member, and the console rightly refuses a second one there).
  await page.getByRole("button", { name: "Change plan" }).click();
  const planSelect = page.locator("dialog[open]").getByLabel("New plan", { exact: true });
  await planSelect.selectOption("pro");
  await confirmSlip(page, "Change plan");
  await finishSlip(page);
  await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();

  // A trial: override one feature with an end date, then remove the override.
  await open(page, `/admin/workspaces/${workspaceId}/features`);
  const row = page.getByRole("row").filter({ hasText: "usage_export" });
  await row.getByRole("button", { name: /Override|Edit/ }).first().click();
  const until = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const slip = page.locator("dialog[open]");
  await slip.getByLabel("They get", { exact: true }).selectOption({ label: "On" });
  await slip.getByLabel("Until", { exact: true }).fill(until);
  await confirmSlip(page, "Save override");
  await finishSlip(page);
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await confirmSlip(page, "Remove override");
  await finishSlip(page);
  await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // Members: add, change role.
  await open(page, `/admin/workspaces/${workspaceId}/members`);
  await page.getByRole("button", { name: "Add member" }).click();
  await confirmSlip(page, "Add member", { Email: teammate.email });
  await finishSlip(page);
  const member = page.getByRole("row").filter({ hasText: teammate.email });
  await expect(member).toBeVisible();
  await member.getByRole("button", { name: "Change role" }).click();
  await confirmSlip(page, "Change role", { Role: "Admin" });
  await finishSlip(page);
  await expect(member.getByText("Admin")).toBeVisible();

  // Transfer ownership to the teammate.
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await confirmSlip(page, "Transfer ownership", { "New owner": `Tara Teammate, ${teammate.email}` });
  await finishSlip(page);
  await expect(page.getByRole("row").filter({ hasText: teammate.email }).getByText("Owner")).toBeVisible();

  // Suspend, then reactivate.
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await confirmSlip(page, "Suspend workspace");
  await finishSlip(page);
  await expect(page.getByText(/Suspended/).first()).toBeVisible();
  await page.getByRole("button", { name: "Reactivate", exact: true }).click();
  await confirmSlip(page, "Reactivate workspace");
  await finishSlip(page);
  await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();

  // The customer side agrees: the teammate now owns the workspace.
  const theirs = await (await request.get("/api/v1/workspaces", { headers: { Authorization: `Bearer ${teammate.token}` } })).json();
  expect(theirs.map((w: { id: string }) => w.id)).toContain(workspaceId);
  expect(errors, "script errors").toEqual([]);
});

// ── Logins: the actions not covered in accounts.spec.ts ─────────────────
test("login: sign out everywhere, reactivate, staff role on and off", async ({ page, request }) => {
  test.slow();
  const errors = watchErrors(page);
  const person = await newAccount(request, `Sam ${unique()}`);
  await staffSignIn(page);
  await open(page, `/admin/users?q=${encodeURIComponent(person.email)}`);
  await page.getByRole("link", { name: /^Sam / }).first().click();
  await expect(page.getByText(person.email).first()).toBeVisible();

  // Signing up opened one session: end it.
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await confirmSlip(page, "Sign out everywhere");
  await finishSlip(page);
  await expect(page.getByText("No open sessions")).toBeVisible();

  // Deactivate, then reactivate: they can sign in again.
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await confirmSlip(page, "Deactivate login");
  await finishSlip(page);
  await page.getByRole("button", { name: "Reactivate", exact: true }).click();
  await confirmSlip(page, "Reactivate login");
  await finishSlip(page);
  const login = await request.post("/api/v1/auth/login", { data: { email: person.email, password: person.password } });
  expect(login.status()).toBe(200);

  // Make them platform staff, then remove it again.
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "Super admin" });
  await page.getByRole("button", { name: "Change role" }).click();
  await confirmSlip(page, "Change role");
  await finishSlip(page);
  await expect(page.getByText("Super admin").first()).toBeVisible();
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "Customer (no platform role)" });
  await page.getByRole("button", { name: "Change role" }).click();
  await confirmSlip(page, "Change role");
  await finishSlip(page);
  await expect(page.getByRole("button", { name: "Change role" })).toBeDisabled();
  const me = await (await request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${(await login.json()).access_token}` } })).json();
  expect(me.platform_role).toBeNull();
  expect(errors, "script errors").toEqual([]);
});

// ── Product: plans, switches, settings, templates ──────────────────────
test("plans: create, edit, set a value, make default and back, retire", async ({ page }) => {
  onlyIn("chrome");
  test.slow();
  const errors = watchErrors(page);
  const key = `e2e_${unique()}`;
  const name = `E2E Plan ${key.slice(4)}`;
  await staffSignIn(page);
  await open(page, "/admin/plans");
  // Plans are columns: each plan's header cell holds its name, key and buttons.
  const planHead = (text: string) => page.locator("thead th").filter({ hasText: text }).first();
  const DEFAULT = "Default for new sign-ups";
  const currentDefault = page.locator("thead th").filter({ hasText: DEFAULT }).first();
  await expect(currentDefault).toBeVisible();
  const originalKey = await currentDefault.locator("span.mono").first().innerText();

  // Create (copying the default plan's values, so it changes nothing for anyone).
  await page.getByRole("button", { name: "New plan" }).first().click();
  await confirmSlip(page, "Create plan", { Name: name, Key: key });
  await finishSlip(page);
  const row = planHead(key);
  await expect(row).toBeVisible();

  // Make it the default, then give the default back at once.
  await row.getByRole("button", { name: "Make default" }).click();
  await confirmSlip(page, "Make default");
  await finishSlip(page);
  await expect(row.getByText(DEFAULT)).toBeVisible();
  await planHead(originalKey).getByRole("button", { name: "Make default" }).click();
  await confirmSlip(page, "Make default");
  await finishSlip(page);
  await expect(planHead(originalKey).getByText(DEFAULT)).toBeVisible();
  await expect(row.getByRole("button", { name: "Make default" })).toBeVisible();

  // Edit the name, and one feature value of the (no longer default) plan.
  await row.getByRole("button", { name: "Edit" }).click();
  await confirmSlip(page, "Save plan", { Name: `${name} Edited` });
  await finishSlip(page);
  await expect(page.getByText(`${name} Edited`).first()).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^Brands on ${name} Edited: .*Change$`) }).click();
  await confirmSlip(page, "Save value", { Limit: "7" });
  await finishSlip(page);
  await expect(page.getByRole("button", { name: new RegExp(`^Brands on ${name} Edited: 7`) })).toBeVisible();

  // Retire it.
  await row.getByRole("button", { name: "Retire" }).click();
  await confirmSlip(page, "Retire plan");
  await finishSlip(page);
  await expect(row.getByRole("button", { name: "Bring back" })).toBeVisible();
  expect(errors, "script errors").toEqual([]);
});

test("global feature switch and a platform setting, then put back", async ({ page }) => {
  onlyIn("chrome");
  test.slow();
  const errors = watchErrors(page);
  await staffSignIn(page);

  // Usage export: off for everyone, then on again.
  await open(page, "/admin/features");
  const sw = page.getByRole("row").filter({ hasText: "usage_export" }).getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await confirmSlip(page, "Turn off");
  await finishSlip(page);
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await confirmSlip(page, "Turn on");
  await finishSlip(page);
  await expect(sw).toHaveAttribute("aria-checked", "true");

  // A setting nothing in the tests depends on: the link-volume alert threshold.
  await open(page, "/admin/settings");
  const setting = page.locator(".setting").filter({ hasText: "link_volume_alert_threshold" });
  const input = setting.getByLabel("Value");
  const before = await input.inputValue();
  const next = String(Number(before) === 300 ? 301 : 300);
  await input.fill(next);
  await setting.getByRole("button", { name: "Change" }).click();
  await confirmSlip(page, "Change setting");
  await finishSlip(page);
  await expect(setting.getByText("Last changed")).toBeVisible();
  await input.fill(before);
  await setting.getByRole("button", { name: "Change" }).click();
  await confirmSlip(page, "Change setting");
  await finishSlip(page);
  await expect(input).toHaveValue(before);
  expect(errors, "script errors").toEqual([]);
});

test("templates: create, edit, switch off", async ({ page }) => {
  onlyIn("chrome");
  test.slow();
  const errors = watchErrors(page);
  const title = `E2E Fresh bread ${unique()}`;
  await staffSignIn(page);
  await open(page, "/admin/templates");
  await page.getByRole("button", { name: "New template" }).first().click();
  await confirmSlip(page, "Create template", {
    Title: title, Industry: "bakery", Template: "Fresh {product} every morning at {place}!",
  });
  await finishSlip(page);

  await page.getByRole("button", { name: title }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill(`${title} v2`);
  await page.getByRole("switch", { name: /Customers can use it/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await confirmSlip(page, "Save template");
  await finishSlip(page);
  await expect(page.getByRole("heading", { name: `${title} v2` })).toBeVisible();
  expect(errors, "script errors").toEqual([]);
});
