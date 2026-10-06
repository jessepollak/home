import { expect, test, type Page } from "@playwright/test";
import { activityPageBody, installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { expectNavigation } from "./fixtures/navigation-budget";

const bitcoin = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/actions*", (route) => new URL(route.request().url()).pathname === "/api/actions"
    ? json(route, { version: 1, truncated: false, actions: [] }) : route.fallback());
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const body = activityPageBody(url.searchParams.get("to"), url.searchParams.get("currency") ?? "USD");
    const transfer = body.transfers[0];
    if (!transfer) throw new Error("Activity detail return fixture requires at least one transfer.");
    return json(route, { ...body, cards: undefined, transfers: [{ ...transfer,
      id: `8453:${bitcoin}:received-fixture`, assetId: "cbbtc", tokenAddress: bitcoin,
      tokenSymbol: "cbBTC", tokenDecimals: 8, amountBaseUnits: "10000000",
      valuation: { status: "unpriced", currency: body.currency, reason: "quote-unavailable" },
    }] });
  });
}

async function openDetail(page: Page) {
  await page.getByRole("button", { name: /Received.*cbBTC/ }).click();
  const detail = page.getByRole("dialog", { name: "Received" });
  await expect(detail).toContainText("+0.1000 cbBTC");
  await expect(detail.getByRole("button", { name: "Bitcoin Asset" })).toBeVisible();
  return detail;
}

for (const origin of ["/home", "/activity"] as const) {
  for (const back of ["browser", "header"] as const) {
    test(`${origin} owned Bitcoin ${back} Back restores one detail with a retained neighboring feed`, async ({ page }) => {
      await setup(page);
      const neighbor = origin === "/home" ? "/activity" : "/home";
      await page.goto(neighbor);
      await expect(page.getByRole("button", { name: /Received.*cbBTC/ })).toBeVisible();
      await page.evaluate(`window.next.router.push(${JSON.stringify(origin)})`);
      await expectNavigation(page, origin);
      for (let visit = 0; visit < 2; visit++) {
        const detail = visit === 0 ? await openDetail(page) : page.getByRole("dialog", { name: "Received" });
        await detail.getByRole("button", { name: "Bitcoin Asset" }).click();
        await expectNavigation(page, `/investments/${bitcoin}`);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        if (back === "browser") await page.goBack();
        else await page.getByRole("button", { name: "Back", exact: true }).click();
        await expectNavigation(page, origin);
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await expect(page.getByRole("dialog", { name: "Received" })).toContainText("+0.1000 cbBTC");
      }
    });
  }
}
