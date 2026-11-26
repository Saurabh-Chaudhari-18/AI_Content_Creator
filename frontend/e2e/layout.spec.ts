/**
 * Every main screen opens without script errors and fits the screen: nothing
 * sticks out sideways on phones, tablets or desktops.
 */
import { expect, test } from "@playwright/test";

import { expectNoSideways, newAccount, newBrandAndPost, open, signIn, watchErrors } from "./helpers";

test("public pages fit the screen", async ({ page }) => {
  const errors = watchErrors(page);
  for (const [path, heading] of [
    ["/login", /Welcome back/],
    ["/register", /./],
    ["/forgot-password", /Forgot your password/],
    ["/verify", /Check an approval certificate/],
  ] as const) {
    await open(page, path);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expectNoSideways(page, path);
  }
  expect(errors, "script errors").toEqual([]);
});

test.describe("signed-in screens fit the screen", () => {
  const screens: [string, RegExp][] = [
    ["/", /Your Studio/],
    ["/posts", /All Posts/],
    ["/calendar", /Posting Calendar/],
    ["/templates", /Smart Templates/],
    ["/accounts", /Social Accounts/],
    ["/brands", /Your Brands/],
    ["/settings", /^Settings/],
  ];
  for (const [path, heading] of screens) {
    test(path, async ({ page, request }) => {
      const errors = watchErrors(page);
      const account = await newAccount(request);
      await newBrandAndPost(request, account);
      await signIn(page, account);
      await open(page, path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoSideways(page, path);
      expect(errors, "script errors").toEqual([]);
    });
  }

  test("post studio", async ({ page, request }) => {
    const errors = watchErrors(page);
    const account = await newAccount(request);
    const { postId } = await newBrandAndPost(request, account);
    await signIn(page, account);
    await open(page, `/posts/${postId}`);
    await expect(page.getByRole("button", { name: "Send for approval" }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSideways(page, "the post editor");
    expect(errors, "script errors").toEqual([]);
  });
});
