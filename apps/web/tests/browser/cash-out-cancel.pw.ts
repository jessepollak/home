import { expect, test } from "@playwright/test";
import { isRecord } from "@/shared/guards";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "./feature-map/cashout-fixture";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

for (const start of ["/home", "/activity"] as const) {
  test(`cancel a pending cash-out from ${start} reviews the withdrawal in the same sheet`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [cashoutFixtureAction] }));
    await page.route("**/api/actions/prepare", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body: unknown = route.request().postDataJSON();
      if (!isRecord(body) || body.kind !== "cash-out-withdraw") return route.fallback();
      return json(route, cashoutFixtureWithdraw);
    });

    await page.goto(start);
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    const item = page.getByRole("list", { name: "Pending" }).getByRole("button", { name: /Cash out to Cash App/ });
    await expect(item).toBeVisible();
    await item.click();
    const details = page.getByRole("dialog", { name: "Cash out to Cash App" });
    await expect(details.getByText("Waiting for a buyer")).toBeVisible();
    await expect(details.getByText("Usually within 1 hour")).toBeVisible();
    await details.getByRole("button", { name: "Cancel cash-out $50" }).click();

    const review = page.getByRole("dialog", { name: "Confirm withdrawal" });
    await expect(review.getByRole("button", { name: "Withdraw $50.00" })).toHaveAttribute(
      "data-money-action-id",
      cashoutFixtureWithdraw.id,
    );
    await expect(review.getByText("Base", { exact: true })).toBeVisible();
    await expect(review.getByText("Payout handle")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);

    await review.getByRole("button", { name: "Back" }).last().click();
    await expect(page.getByRole("dialog", { name: "Cash out to Cash App" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel cash-out $50" })).toBeEnabled();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
}
