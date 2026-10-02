import { expect, test } from "@playwright/test";
import { cashoutFixtureAction } from "./feature-map/cashout-fixture";
import { activityOrdersFixture, fundingOrderResolutionFixture } from "./feature-map/fixtures";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const path of ["/activity", "/home"] as const) {
    test(`${path} shows funding orders and reconciled cash-out at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedSignedInSession(page);
      await installApiFixtures(page);
      const orders = activityOrdersFixture();
      await page.route("**/api/actions", (route) => json(route, { actions: [cashoutFixtureAction] }));
      await page.route("**/api/activity/orders", (route) => json(route, orders));
      const writes: string[] = [];
      page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (request.method() === "POST" && pathname.startsWith("/api/funding/orders")) writes.push(pathname);
      });
      await page.route("**/api/funding/orders/fixture-funding-ambiguous/resolve", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        expect(route.request().postDataJSON()).toEqual({ version: 1 });
        return json(route, fundingOrderResolutionFixture("fixture-funding-ambiguous"));
      });
      await page.goto(path);
      const activity = page.locator("[data-app-main-authenticated]").getByRole("region", { name: "Activity" }).last();
      const pending = activity.getByRole("list", { name: "Pending" });
      const funding = pending.getByRole("button", { name: /Add money.*\+\$25/ });
      await expect(funding).toBeVisible();
      await expect(funding).toHaveAccessibleName(/Action needed/);
      await funding.click();
      const sheet = page.getByRole("dialog", { name: "Add money" });
      await expect(sheet.getByText("Waiting for your payment")).toBeVisible();
      await expect(sheet.getByText("Coinbase", { exact: true })).toBeVisible();
      await expect(sheet.getByText("Debit card")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Copy fixture-funding-pending" })).toBeVisible();
      await sheet.getByRole("button", { name: "Close Add money details" }).click();
      await pending.getByRole("button", { name: /Add money.*\+\$40/ }).click();
      await expect(sheet.getByText("Waiting on Coinbase")).toBeVisible();
      await sheet.getByRole("button", { name: "Close Add money details" }).click();
      const ambiguous = pending.getByRole("button", { name: /Add money.*\+\$30/ });
      await ambiguous.click();
      await expect(sheet.getByText("Unconfirmed")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Clear order" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /Try again|Start again|Complete payment/ })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Clear order" }).click();
      await expect.poll(() => writes).toEqual(["/api/funding/orders/fixture-funding-ambiguous/resolve"]);
      await sheet.getByRole("button", { name: "Close Add money details" }).click();
      await expect(sheet).toHaveCount(0);
      await expect(activity.getByRole("button", { name: /Cash out to Cash App/ })).toHaveCount(1);
    });
  }
}
