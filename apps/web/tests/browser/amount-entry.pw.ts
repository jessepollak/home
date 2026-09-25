import { expect, test, type Locator, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

async function openSendAmount(page: Page) {
  await page.goto("/home");
  await page.getByRole("button", { name: "Send" }).click();
  const field = page.getByRole("textbox", { name: "Amount" });
  await expect(field).toBeVisible();
  return field;
}

async function expectInsideViewport(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth
      && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
}

test("Send amount is editable, validates balance and keeps the amount on Back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const field = await openSendAmount(page);
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("inputmode", "decimal");
  expect(await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);

  await field.pressSequentially("0.123456");
  await expect(field).toHaveValue("0.123456");
  await field.press("Backspace");
  await expect(field).toHaveValue("0.12345");
  await field.selectText();
  await field.pressSequentially("1.5");
  await expect(field).toHaveValue("1.5");
  await field.selectText();
  await field.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "$1,234.5");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(field).toHaveValue("1234.5");
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await expect(page.getByText(/^Only .* available$/)).toBeVisible();

  await field.selectText();
  await field.pressSequentially("1.25");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByRole("textbox", { name: "To" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("1.25");
  await expect(page.getByRole("textbox", { name: "Amount" })).toBeFocused();
});

test("Send explains a failed network-fee lookup and recovers on Retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  let feeAvailable = false;
  await page.route("**/api/actions/network-fee", (route) => feeAvailable
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, usdcReserveBaseUnits: "20000" }) })
    : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  const field = await openSendAmount(page);
  await field.pressSequentially("1.25");
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't check the network fee." });
  await expect(alert).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  const retry = page.getByRole("button", { name: "Retry" });
  await retry.scrollIntoViewIfNeeded();
  await expectInsideViewport(retry);
  feeAvailable = true;
  await retry.click();
  await expect(alert).toBeHidden();
  await expect(continueButton).toBeEnabled();
  await expect(field).toHaveValue("1.25");
});

test("Send amount and Continue stay reachable at narrow and landscape viewports", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    const field = await openSendAmount(page);
    const continueButton = page.getByRole("button", { name: "Continue" });
    await field.scrollIntoViewIfNeeded();
    await expectInsideViewport(field);
    await continueButton.scrollIntoViewIfNeeded();
    await expectInsideViewport(continueButton);
    await page.getByRole("button", { name: "Close send dialog" }).click();
    await expect(field).toBeHidden();
  }
});
