import { createHash, createHmac } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

const admin = "0x1111111111111111111111111111111111111111";
const secondAdmin = "0x3333333333333333333333333333333333333333";
const customer = "0x2222222222222222222222222222222222222222";
const secret = "playwright-smoke-home-session-secret-32-bytes!!";

function token(address: string): string {
  const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({
    version: 1,
    session: {
      user: { subject },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1_000).toISOString(),
  })).toString("base64url");
  const input = `v1.${encoded}`;
  return `${input}.${createHmac("sha256", Buffer.from(secret)).update(input).digest("base64url")}`;
}

async function setSession(context: BrowserContext, address: string) {
  await context.addCookies([{
    name: "home-session", value: token(address), domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);
}

function expectUncacheable(response: { headers(): Record<string, string> } | null) {
  expect(response?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(response?.headers()["cache-control"]).not.toContain("public");
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`admin boundary at ${viewport.width}`, async ({ page, context, baseURL }) => {
    await page.setViewportSize(viewport);
    await setSession(context, admin);
    expectUncacheable(await page.goto("/admin"));
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
    await expect(page.getByText("Needs attention isn't available yet.")).toBeVisible();
    await expect(page.getByText("Business metrics aren't available yet.")).toBeVisible();
    if (viewport.width === 1280) {
      const sidebar = page.getByRole("complementary", { name: "Operator sidebar" });
      await expect(sidebar.getByRole("button", { name: /Copy 0x1111/ })).toBeVisible();
      await setSession(context, secondAdmin);
      await sidebar.getByRole("link", { name: "Customers" }).click();
      await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x3333/ })).toBeVisible();
      await setSession(context, admin);
      await sidebar.getByRole("link", { name: "Overview" }).click();
      await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x1111/ })).toBeVisible();
      await setSession(context, secondAdmin);
      await sidebar.getByRole("link", { name: "Money" }).click();
      await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x3333/ })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x3333/ })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x1111/ })).toHaveCount(0);
      await setSession(context, admin);
      await page.goForward();
      await expect(page).toHaveURL(/\/admin\/money$/);
      await expect(sidebar.getByRole("button", { name: /Copy 0x1111/ })).toBeVisible();
      await sidebar.getByRole("link", { name: "Back to Home" }).click();
      await expect(page).toHaveURL(/\/\?account=signin$/);
      await setSession(context, secondAdmin);
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/money$/);
      await expect(sidebar.getByRole("button", { name: /Copy 0x3333/ })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Copy 0x1111/ })).toHaveCount(0);
      await setSession(context, admin);
    }
    if (viewport.width === 390) {
      const box = await page.getByRole("button", { name: "Open sections menu" }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    if (viewport.width === 390) {
      await page.getByRole("button", { name: "Open sections menu" }).click();
      const addressBox = await page.getByRole("dialog", { name: "Sections" }).getByRole("button", { name: /Copy 0x1111/ }).boundingBox();
      expect(addressBox?.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Sections" })).toHaveCount(0);
      await page.getByRole("button", { name: "Open sections menu" }).click();
      await expect(page.getByRole("dialog", { name: "Sections" })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(page.getByRole("dialog", { name: "Sections" })).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: "Operator sidebar" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeFocused();
      await page.setViewportSize(viewport);
      await expect(page.getByRole("button", { name: "Open sections menu" })).toHaveAttribute("aria-expanded", "false");
    }
    const api = await context.request.get("/api/admin/session");
    expect(api.status()).toBe(200);
    expect(await api.json()).toEqual({ version: 1, operator: { address: admin } });
    expect(api.headers()["cache-control"]).toContain("private");
    expect(api.headers()["cache-control"]).toContain("no-store");
    const sections = [
      ["Customers", "Customer search isn't available yet.", "/admin/customers"],
      ["Support", "Support inbox isn't available yet.", "/admin/support"],
      ["Growth", "Invite rewards aren't available yet.", "/admin/growth"],
      ["Money", "Revenue isn't available yet.", "/admin/money"],
      ["Settings", "No settings available yet.", "/admin/settings"],
      ["Audit log", "Admin activity isn't recorded yet.", "/admin/audit"],
    ] as const;
    for (const [heading, empty, href] of sections) {
      if (viewport.width === 390) {
        const trigger = page.getByRole("button", { name: "Open sections menu" });
        await trigger.click();
        await expect(page.getByRole("dialog", { name: "Sections" })).toBeVisible();
        await page.getByRole("dialog", { name: "Sections" }).getByRole("link", { name: heading }).click();
        await expect(page.getByRole("dialog", { name: "Sections" })).toHaveCount(0);
        await expect(trigger).toBeFocused();
      } else {
        await page.getByRole("navigation", { name: "Operator sections" }).getByRole("link", { name: heading }).click();
      }
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.getByText(empty)).toBeVisible();
      if (viewport.width === 390) {
        const trigger = page.getByRole("button", { name: "Open sections menu" });
        await trigger.click();
        await expect(page.getByRole("dialog", { name: "Sections" }).getByRole("link", { name: heading })).toHaveAttribute("aria-current", "page");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      } else {
        await expect(page.getByRole("navigation", { name: "Operator sections" }).getByRole("link", { name: heading })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("heading", { name: heading })).toBeFocused();
      }
    }
    if (viewport.width === 390) {
      const trigger = page.getByRole("button", { name: "Open sections menu" });
      await trigger.click();
      await page.getByRole("dialog", { name: "Sections" }).getByRole("link", { name: "Audit log" }).click();
      await expect(page.getByRole("dialog", { name: "Sections" })).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/settings$/);
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeFocused();
      await page.goForward();
      await expect(page).toHaveURL(/\/admin\/audit$/);
      await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeFocused();
    }
    if (viewport.width === 1280) {
      await page.evaluate(() => { document.documentElement.dir = "rtl"; });
      const sidebar = await page.getByRole("complementary", { name: "Operator sidebar" }).boundingBox();
      const content = await page.locator("main[data-operator-content]").boundingBox();
      expect(sidebar && content && sidebar.x > content.x).toBeTruthy();
      const currentEdge = await page.getByRole("navigation", { name: "Operator sections" }).getByRole("link", { name: "Audit log" }).evaluate((link) => {
        const marker = getComputedStyle(link, "::before");
        return { right: marker.right, opacity: marker.opacity };
      });
      expect(currentEdge.right).toBe("0px");
      expect(currentEdge.opacity).toBe("1");
    }
    expectUncacheable(await page.reload());
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    for (const path of ["/admin/nope", "/admin/settings/brand", "/admin/customers/x/y"]) {
      const unknown = await page.goto(path);
      expect(unknown?.status()).toBe(404);
      expectUncacheable(unknown);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      if (viewport.width === 1280) await expect(page.getByRole("navigation", { name: "Operator sections" }).locator('[aria-current="page"]')).toHaveCount(0);
    }
    expect((await page.getByRole("link", { name: "Back to Overview" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("link", { name: "Back to Overview" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/customers\/x\/y$/);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/admin$/);
    const origin = new URL(baseURL ?? page.url()).origin;
    const logout = await context.request.post("/api/auth/base/logout", {
      headers: { Origin: origin },
    });
    expect(logout.status()).toBe(200);
    expect((await context.cookies()).some((cookie) => cookie.name === "home-access")).toBe(true);
    if (viewport.width === 390) {
      await page.getByRole("button", { name: "Open sections menu" }).click();
      await page.getByRole("dialog", { name: "Sections" }).getByRole("link", { name: "Customers" }).click();
    } else {
      await page.getByRole("navigation", { name: "Operator sections" }).getByRole("link", { name: "Customers" }).click();
    }
    await expect(page).toHaveURL(/\/\?account=signin$/);

    await setSession(context, customer);
    for (const path of ["/admin", "/admin/customers", "/admin/support", "/admin/growth", "/admin/money", "/admin/settings", "/admin/audit", "/admin/nope", "/admin/settings/brand"]) {
      const denied = await context.request.get(path, { maxRedirects: 0 });
      expect(denied.status()).toBe(307);
      expect(denied.headers().location).toBe("/home");
      expectUncacheable(denied);
    }
    await page.goto("/admin/nope");
    await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(0);
    await setSession(context, admin);
    const accessLogout = await context.request.post("/api/access/logout", {
      headers: { Origin: origin },
    });
    expect(accessLogout.status()).toBe(200);
    const remaining = await context.cookies();
    expect(remaining.some((cookie) => cookie.name === "home-access")).toBe(false);
    expect(remaining.some((cookie) => cookie.name === "home-session")).toBe(true);
    expectUncacheable(await page.goto("/admin"));
    await expect(page).toHaveURL(/\/access\?next=%2Fadmin$/);
  });
}

test("no Home session redirects to sign-in, while deployment access runs first", async ({ page, context }) => {
  expectUncacheable(await page.goto("/admin"));
  await expect(page).toHaveURL(/\/\?account=signin$/);
  await page.goto("/admin/nope");
  await expect(page).toHaveURL(/\/\?account=signin$/);
  await context.clearCookies();
  expectUncacheable(await page.goto("/admin"));
  await expect(page).toHaveURL(/\/access\?next=%2Fadmin$/);
});
