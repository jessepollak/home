import { expect, test } from "@playwright/test";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;

test("deployment access composes independently before Home authentication", async ({ page, context }) => {
  const credential = process.env[credentialKey];
  expect(credential).toBeTruthy();
  expect(Buffer.byteLength(credential ?? "", "utf8")).toBeGreaterThanOrEqual(32);

  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  const protectedResponse = await page.goto("/home");
  expect(protectedResponse?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  await expect(page).toHaveURL(/\/access\?next=%2Fhome$/);
  await expect(page.getByRole("heading", { name: "Enter access password" })).toBeVisible();

  await page.getByRole("textbox", { name: "Access password" }).fill("wrong credential");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Access denied. Try again.", { exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "home-access")).toBe(false);

  await page.getByRole("textbox", { name: "Access password" }).fill(credential ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/home$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/access\?next=%2Fhome$/);
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("heading", { name: "Access granted" })).toBeVisible();

  await context.addCookies([{
    name: "home-session",
    value: "independent-session-fixture",
    domain: "localhost",
    path: "/",
  }]);
  await page.getByRole("button", { name: "Leave this deployment" }).click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.getByRole("heading", { name: "Enter access password" })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "home-access")).toBe(false);
  expect(cookies.some((cookie) => cookie.name === "home-session")).toBe(true);
});
