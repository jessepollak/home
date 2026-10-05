import { expect, test } from "@playwright/test";
import { cashoutFixtureAction } from "./feature-map/cashout-fixture";
import { activityOrdersFixture, fundingOrderResolutionFixture } from "./feature-map/fixtures";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

for (const path of ["/activity", "/home"]) {
  test(`${path} cancels a pending funding checkout from Activity`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page, { activityOrders: true });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/cancel")) writes.push(new URL(request.url()).pathname);
    });
    await page.goto(path);
    const activity = page.locator("[data-app-main-authenticated]").getByRole("region", { name: "Activity" }).last();
    await activity.getByRole("list", { name: "Pending" }).getByRole("button", { name: /Add money.*\+\$25/ }).click();
    const sheet = page.getByRole("dialog", { name: "Add money" });
    await expect(sheet.getByRole("button", { name: "Continue with Coinbase" })).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel deposit" }).click();
    await expect(sheet.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Deposit cancelled", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Home won't show this checkout as pending. Don't complete it in Coinbase. If you already paid, the money will still show up here when it arrives.", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Cancel deposit" })).toHaveCount(0);
    expect(writes).toEqual(["/api/funding/orders/fixture-funding-pending/cancel"]);
    await sheet.getByRole("button", { name: "Close Add money details" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(activity.getByRole("button", { name: /Add money.*Cancelled/ })).toBeVisible();
  });
}

for (const path of ["/activity", "/home"]) {
  test(`${path} hides a pay-by time that has already passed`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    const orders = activityOrdersFixture();
    const past = "2020-01-01T00:00:00.000Z";
    await page.route("**/api/activity/orders", (route) => json(route, { ...orders, orders: orders.orders.map((order) => order.id === "fixture-funding-pending" ? { ...order, expiresAt: past } : order) }));
    await page.goto(path);
    const activity = page.locator("[data-app-main-authenticated]").getByRole("region", { name: "Activity" }).last();
    await activity.getByRole("list", { name: "Pending" }).getByRole("button", { name: /Add money.*\+\$25/ }).click();
    const sheet = page.getByRole("dialog", { name: "Add money" });
    await expect(sheet.getByText("Waiting for your payment")).toBeVisible();
    await expect(sheet.getByText(/Pay by/)).toHaveCount(0);
    await sheet.getByRole("button", { name: "Close Add money details" }).click();
    await expect(sheet).toHaveCount(0);
  });
}

test("/activity keeps a cancelled funding checkout when the orders refresh fails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { activityOrders: true });
  let cancelled = false;
  page.on("requestfinished", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/cancel")) cancelled = true;
  });
  let failedRefreshes = 0;
  await page.route("**/api/activity/orders", (route) => {
    if (!cancelled) return route.fallback();
    failedRefreshes += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });
  await page.goto("/activity");
  const activity = page.locator("[data-app-main-authenticated]").getByRole("region", { name: "Activity" }).last();
  await activity.getByRole("list", { name: "Pending" }).getByRole("button", { name: /Add money.*\+\$25/ }).click();
  const sheet = page.getByRole("dialog", { name: "Add money" });
  await sheet.getByRole("button", { name: "Cancel deposit" }).click();
  await expect(page.locator("[data-activity-sources~='orders:error']").first()).toBeAttached();
  expect(failedRefreshes).toBeGreaterThan(0);
  await expect(sheet.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cancel deposit" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Continue with Coinbase" })).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const path of ["/activity", "/home"] as const) {
    test(`${path} shows funding orders and reconciled cash-out at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedSignedInSession(page);
      await installApiFixtures(page);
      const orders = activityOrdersFixture();
      await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [cashoutFixtureAction] }));
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
