import { expect, test, type Response } from "@playwright/test";
import { expectNavigation } from "./fixtures/navigation-budget";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;

function isAccessPost(response: Response): boolean {
  return response.url().endsWith("/api/access") && response.request().method() === "POST";
}

test("deployment access composes independently before Home authentication", { tag: "@smoke" }, async ({ page, context }) => {
  const credential = process.env[credentialKey];
  expect(credential).toBeTruthy();
  // Browser fixtures intentionally stay stronger than the runtime 8-byte floor.
  expect(Buffer.byteLength(credential ?? "", "utf8")).toBeGreaterThanOrEqual(32);

  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  const protectedResponse = await page.goto("/home");
  expect(protectedResponse?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  await expectNavigation(page, /\/access\?next=%2Fhome$/);
  await expect(page.getByRole("heading", { name: "Enter access password" })).toBeVisible();
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await expect.poll(() => page.getByRole("button", { name: "Continue" }).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  await page.getByRole("textbox", { name: "Access password" }).fill("wrong credential");
  const deniedResponse = page.waitForResponse(isAccessPost);
  await page.getByRole("button", { name: "Continue" }).click();
  expect((await deniedResponse).status()).toBe(401);
  await expect(page.getByText("Access denied. Try again.", { exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "home-access")).toBe(false);

  await page.getByRole("textbox", { name: "Access password" }).fill(credential ?? "");
  const loginResponse = page.waitForResponse(isAccessPost);
  await page.getByRole("button", { name: "Continue" }).click();
  const accepted = await loginResponse;
  expect(accepted.status()).toBe(200);
  await page.waitForURL(/(?:\/home|\/\?account=signin)$/);
  await expectNavigation(page, /(?:\/home|\/\?account=signin)$/);
  await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  await page.reload();
  await expectNavigation(page, /(?:\/home|\/\?account=signin)$/);
  expect((await context.cookies()).some((cookie) => cookie.name === "home-access")).toBe(true);

  await page.goBack();
  await expectNavigation(page, /\/access\?next=%2Fhome$/);
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
  await page.waitForURL(/\/access$/);
  await expectNavigation(page, /\/access$/);
  await expect(page.getByRole("heading", { name: "Enter access password" })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "home-access")).toBe(false);
  expect(cookies.some((cookie) => cookie.name === "home-session")).toBe(true);
});

test("the native access form posts and redirects without JavaScript", async ({ browser, baseURL }) => {
  const credential = process.env[credentialKey];
  expect(credential).toBeTruthy();

  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await context.clearCookies();
    await page.goto("/home");
    await expectNavigation(page, /\/access\?next=%2Fhome$/);
    const form = page.locator("form[action='/api/access'][method='post']");
    await expect(form).toBeVisible();
    await expect(form).not.toHaveAttribute("data-hydrated", "true");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

    await page.getByRole("textbox", { name: "Access password" }).fill(credential ?? "");
    const nativeResponse = page.waitForResponse(isAccessPost);
    const nativeRequest = page.waitForRequest((request) => (
      request.url().endsWith("/api/access") && request.method() === "POST"
    ));
    await page.getByRole("button", { name: "Continue" }).click();

    expect((await nativeRequest).headers()["origin"]).toBe(new URL(baseURL ?? "").origin);
    expect((await nativeResponse).status()).toBe(303);
    await page.waitForURL(/\/home$/);
    await expectNavigation(page, /\/home$/);
  } finally {
    await context.close();
  }
});
