import { createHash, createHmac } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

const admin = "0x1111111111111111111111111111111111111111";
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
  test(`admin boundary at ${viewport.width}`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await setSession(context, admin);
    expectUncacheable(await page.goto("/admin"));
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByText(admin)).toBeVisible();
    const api = await context.request.get("/api/admin/session");
    expect(api.status()).toBe(200);
    expect(await api.json()).toEqual({ version: 1, operator: { address: admin } });
    expect(api.headers()["cache-control"]).toContain("private");
    expect(api.headers()["cache-control"]).toContain("no-store");
    expectUncacheable(await page.reload());
    await expect(page.getByText(admin)).toBeVisible();
    const unknown = await page.goto("/admin/nope");
    expect(unknown?.status()).toBe(404);
    expectUncacheable(unknown);
    await expect(page.getByRole("heading", { name: "Admin page not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Admin" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(admin)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/nope$/);
    await expect(page.getByRole("heading", { name: "Admin page not found" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(admin)).toBeVisible();
    const logout = await context.request.post("/api/auth/base/logout", {
      headers: { Origin: "http://localhost:3199" },
    });
    expect(logout.status()).toBe(200);
    expect((await context.cookies()).some((cookie) => cookie.name === "home-access")).toBe(true);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/\?account=signin$/);

    await setSession(context, customer);
    expectUncacheable(await page.goto("/admin"));
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toHaveCount(0);
    await page.goto("/admin/nope");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Admin page not found" })).toHaveCount(0);
    await setSession(context, admin);
    const accessLogout = await context.request.post("/api/access/logout", {
      headers: { Origin: "http://localhost:3199" },
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
