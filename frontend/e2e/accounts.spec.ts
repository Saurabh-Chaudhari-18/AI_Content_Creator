/**
 * Logins and passwords, end to end in the browser:
 * - a person resets a forgotten password by email;
 * - platform staff create a login, rename it, send a reset link and
 *   deactivate it, and remove a member from a workspace.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import { confirmSlip, finishSlip, linkIn, newAccount, open, readEmail, signIn, watchErrors } from "./helpers";
import { STAFF } from "./paths";

const STAFF_HOME = /Overview|Workspaces|Logins/;

/** A fresh browser context: someone else on another device. */
async function anotherDevice(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}

async function choosePassword(page: Page, link: string, password: string) {
  await open(page, link);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { name: "Your password is set" })).toBeVisible();
}

async function expectSignInRefused(page: Page, email: string, password: string, message: RegExp) {
  await open(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
}

test("forgot password: email link, new password, sign in", async ({ page, request }) => {
  const errors = watchErrors(page);
  const account = await newAccount(request, "Fiona Forgetful");

  await open(page, "/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  // Wait for the new page, or the email goes into the sign-in page's own box.
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText(/we've sent a link to reset the password/i)).toBeVisible();

  const link = linkIn(readEmail(account.email, "password_reset"), /https?:\/\/\S+\/set-password\?token=\S+/);
  const path = new URL(link).pathname + new URL(link).search;   // the email names the configured site; use this one
  await choosePassword(page, path, "a-brand-new-password-1");

  await expectSignInRefused(page, account.email, account.password, /Incorrect email or password/);
  await signIn(page, { email: account.email, password: "a-brand-new-password-1" });
  // The link works once.
  await open(page, path);
  await page.getByLabel("New password").fill("another-password-22");
  await page.getByLabel("Type it again").fill("another-password-22");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  expect(errors, "script errors").toEqual([]);
});

test("staff: create, sign in, rename, reset password, deactivate", async ({ page, browser, baseURL }) => {
  const errors = watchErrors(page);
  const email = `e2e-made-by-staff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await signIn(page, STAFF, STAFF_HOME);

  // Create the login with a workspace of its own.
  await open(page, "/admin/users");
  await page.getByRole("button", { name: "New login" }).first().click();
  const created = await confirmSlip(page, "Create login", {
    "Full name": "Nina Newcomer", "Email": email, "New workspace name": "Nina's Studio",
  });
  const firstLink = await created.getByLabel("Set-password link").inputValue();
  expect(firstLink).toContain("/set-password?token=");
  await finishSlip(page);

  // The person chooses a password and signs in, on their own device.
  const person = await anotherDevice(browser, baseURL);
  await choosePassword(person, new URL(firstLink).pathname + new URL(firstLink).search, "nina-password-111");
  await signIn(person, { email, password: "nina-password-111" });

  // Staff renames the login.
  await open(page, `/admin/users?q=${encodeURIComponent(email)}`);
  await page.getByRole("link", { name: "Nina Newcomer" }).click();
  await expect(page.getByRole("heading", { name: "Nina Newcomer" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await confirmSlip(page, "Rename", { "Full name": "Nina Renamed" });
  await finishSlip(page);
  await expect(page.getByRole("heading", { name: "Nina Renamed" }).first()).toBeVisible();

  // Staff sends a password-reset (setup) link; the person resets with it.
  await page.getByRole("button", { name: "Issue setup link" }).click();
  const issued = await confirmSlip(page, "Issue link");
  const resetLink = await issued.getByLabel("Set-password link").inputValue();
  await finishSlip(page);
  await choosePassword(person, new URL(resetLink).pathname + new URL(resetLink).search, "nina-password-222");
  await expectSignInRefused(person, email, "nina-password-111", /Incorrect email or password/);
  await signIn(person, { email, password: "nina-password-222" });

  // Staff deactivates the login: the person can no longer sign in.
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await confirmSlip(page, "Deactivate login");
  await finishSlip(page);
  await expect(page.getByText("Deactivated").first()).toBeVisible();
  await expectSignInRefused(person, email, "nina-password-222", /inactive/i);

  await person.context().close();
  expect(errors, "script errors").toEqual([]);
});

test("staff: remove a member from a workspace", async ({ page, request }) => {
  const errors = watchErrors(page);
  const owner = await newAccount(request, "Olivia Owner");
  const member = await newAccount(request, "Manoj Member");
  const added = await request.post(`/api/v1/workspaces/${owner.workspaceId}/members`, {
    headers: { Authorization: `Bearer ${owner.token}` }, data: { email: member.email, role: "member" },
  });
  expect(added.status(), await added.text()).toBe(200);

  await signIn(page, STAFF, STAFF_HOME);
  await open(page, `/admin/workspaces/${owner.workspaceId}/members`);
  const row = page.getByRole("row").filter({ hasText: member.email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await confirmSlip(page, "Remove member");
  await finishSlip(page);
  await expect(page.getByRole("row").filter({ hasText: member.email })).toHaveCount(0);

  // The member no longer belongs to that workspace.
  const theirs = await (await request.get("/api/v1/workspaces", { headers: { Authorization: `Bearer ${member.token}` } })).json();
  expect(theirs.map((w: { id: string }) => w.id)).not.toContain(owner.workspaceId);
  expect(errors, "script errors").toEqual([]);
});
