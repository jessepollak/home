import { expect, test } from "@playwright/test";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "./feature-map/cashout-fixture";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

for (const start of ["/home", "/activity"] as const) {
  test(`cancel a pending cash-out from ${start} opens its withdraw review`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/actions", (route) => json(route, { actions: [cashoutFixtureAction] }));
    await page.route("**/api/actions/prepare", (route) => {
      if (route.request().method() !== "POST" || route.request().postDataJSON()?.kind !== "cash-out-withdraw") return route.fallback();
      return json(route, cashoutFixtureWithdraw);
    });
    await page.route(`**/api/actions/${cashoutFixtureWithdraw.id}`, (route) => json(route, {
      id: cashoutFixtureWithdraw.id,
      kind: cashoutFixtureWithdraw.kind,
      summary: {
        title: cashoutFixtureWithdraw.title,
        amounts: cashoutFixtureWithdraw.amounts,
        warnings: cashoutFixtureWithdraw.warnings,
        expiresAt: cashoutFixtureWithdraw.expiresAt,
        metadata: cashoutFixtureWithdraw.metadata,
      },
      calls: cashoutFixtureWithdraw.calls,
      expiresAt: cashoutFixtureWithdraw.expiresAt,
    }));

    await page.goto(start);
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    const item = page.getByRole("list", { name: "Pending" }).getByRole("button", { name: /Cash out to Cash App/ });
    await expect(item).toBeVisible();
    await item.click();
    const details = page.getByRole("dialog", { name: "Cash out to Cash App" });
    await expect(details.getByText("Waiting for a buyer")).toBeVisible();
    await expect(details.getByText("About 60 min")).toBeVisible();
    await details.getByRole("button", { name: "Cancel cash-out $50" }).click();

    const review = page.getByRole("dialog", { name: "Confirm" });
    await expect(review.getByRole("button", { name: "Withdraw $50.00" })).toBeVisible();
    await expect(review.getByText("Base", { exact: true })).toBeVisible();
    await expect(review.getByText("Payout handle")).toHaveCount(0);
    await review.getByRole("button", { name: "Back" }).last().click();
    await expect(review).toHaveCount(0);
  });
}
