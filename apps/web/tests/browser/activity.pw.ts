import { expect, test } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

for (const path of ["/home", "/activity"]) {
  test(`${path} renders the fixture transfer with fiat above native quantity`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(path);

    await expect(
      page.locator("main").getByRole("button", { name: /^Received .* \+\$25\.00 \+25\.00 USDC$/ }).first(),
    ).toBeVisible();
  });
}
