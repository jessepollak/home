import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const HOME_SESSION_SECRET = "playwright-smoke-home-session-secret-32-bytes!!";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function signedHomeSessionCookie(): string {
  const issuedAt = new Date();
  const payload = JSON.stringify({
    version: 1,
    session: {
      user: {
        subject: `base-${createHash("sha256").update(ADDRESS).digest("hex").slice(0, 32)}`,
      },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const input = `v1.${encoded}`;
  const signature = createHmac("sha256", HOME_SESSION_SECRET)
    .update(input)
    .digest("base64url");
  return `home-session=${input}.${signature}`;
}

test("signed-out landing Home mark has a full header hit target without moving its artwork", async ({ page }) => {
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const mark = page.getByRole("banner").getByRole("button", { name: "Home" });
    await expect(mark).toBeVisible();
    await expect(mark.locator("[data-square]")).toHaveCount(width >= 768 ? 4 : 0);
    const geometry = await mark.evaluate((control) => {
      const root = control.closest("[data-home-mark]")!;
      const rootBox = root.getBoundingClientRect();
      const target = control.getBoundingClientRect();
      const square = control.querySelector<HTMLElement>(
        window.innerWidth >= 768 ? "[data-square]" : '[aria-hidden="true"]',
      )!.getBoundingClientRect();
      return {
        root: { x: rootBox.x, y: rootBox.y, width: rootBox.width, height: rootBox.height },
        target: { x: target.x, y: target.y, width: target.width, height: target.height },
        square: { x: square.x, y: square.y, width: square.width, height: square.height },
        upperCornerHits: document.elementFromPoint(target.x + 3, target.y + 3)?.closest("button") === control,
      };
    });
    expect(geometry.target.width).toBeGreaterThanOrEqual(44);
    expect(geometry.target.height).toBeGreaterThanOrEqual(44);
    expect(geometry.upperCornerHits).toBe(true);
    if (width >= 768) {
      expect(geometry.root.height).toBe(28);
      expect(geometry.root.width).toBeGreaterThan(123);
      expect(geometry.target.y).toBe(geometry.root.y - 8);
      expect(geometry.square).toEqual({ x: geometry.root.x, y: geometry.root.y, width: 28, height: 28 });
      await mark.hover();
      expect((await mark.boundingBox())!.width).toBe(82);
    } else {
      expect(geometry.root.width).toBe(44);
      expect(geometry.root.height).toBe(44);
      expect(geometry.square).toEqual({ x: geometry.root.x + 10, y: geometry.root.y + 10, width: 24, height: 24 });
      await mark.hover();
      expect((await mark.boundingBox())!.width).toBe(44);
    }
    await page.keyboard.press("Tab");
    await expect(mark).toBeFocused();
    await expect(mark).toHaveCSS("outline-style", "solid");
  }
});

test("signed landing requests use canonical route redirects", async ({ request }) => {
  const cookieKey = ["HOME", "PLAYWRIGHT", "ACCESS", "COOKIE"].join("_");
  const accessCookie = process.env[cookieKey];
  expect(accessCookie).toBeTruthy();
  const headers = { cookie: `${signedHomeSessionCookie()}; ${accessCookie}` };

  const root = await request.get("/", { headers, maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(root.headers().location).toBe("/home");

  const overlay = await request.get(
    "/?flow=send&panel=balances&group=investments",
    { headers, maxRedirects: 0 },
  );
  expect(overlay.status()).toBe(307);
  expect(overlay.headers().location).toBe("/home?flow=send");

  const signIn = await request.get("/?account=signin", {
    headers,
    maxRedirects: 0,
  });
  expect(signIn.status()).toBe(200);

  const legacy = await request.get(
    "/dashboard?panel=balances&group=investments",
    { headers, maxRedirects: 0 },
  );
  expect(legacy.status()).toBe(307);
  expect(legacy.headers().location).toBe("/home");
});
