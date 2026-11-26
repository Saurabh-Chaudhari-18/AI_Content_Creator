/**
 * The main journey in every browser: sign in, send a post for approval with a
 * deadline, approve it, open its certificate, and check it on the public page.
 */
import { expect, test } from "@playwright/test";

import { expectNoSideways, newAccount, newBrandAndPost, open, signIn, watchErrors } from "./helpers";

test("sign in, send for approval, approve, certificate, verify", async ({ page, request }) => {
  const errors = watchErrors(page);
  const account = await newAccount(request);
  const { postId } = await newBrandAndPost(request, account);

  await signIn(page, account);

  // Send for approval, with the "Needed by" deadline.
  await open(page, `/posts/${postId}`);
  await page.getByRole("button", { name: "Send for approval" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Who should approve this?")).toBeVisible();
  await expect(dialog.getByText("Needed by", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Send for approval|Send to/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Due in|Due /).first()).toBeVisible();

  // A one-person workspace approves its own post.
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "View approval certificate" })).toBeVisible();

  // The certificate, built by the server.
  await page.getByRole("button", { name: "View approval certificate" }).click();
  const cert = page.getByRole("dialog");
  await expect(cert.getByRole("heading", { name: "Approval certificate" })).toBeVisible();
  await expect(cert.getByText("Fresh croissants every morning. Come early!").first()).toBeVisible();
  const number = (await cert.getByText(/^No\. [A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/).innerText()).replace("No. ", "");
  await expectNoSideways(page, "the certificate");
  await cert.getByRole("button", { name: "Close" }).click();

  // Anyone can check it, without signing in.
  const stranger = await page.context().browser()!.newContext();
  const pub = await stranger.newPage();
  await open(pub, `${test.info().project.use.baseURL}/verify/${number.toLowerCase()}`);
  await expect(pub.getByText("This certificate is genuine")).toBeVisible();
  await expect(pub.getByText("Sunrise Bakery")).toBeVisible();
  await expect(pub.getByText("Fresh croissants")).toHaveCount(0);   // never the post itself
  await stranger.close();

  expect(errors, "script errors on the page").toEqual([]);
});
