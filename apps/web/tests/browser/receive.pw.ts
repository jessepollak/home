import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { installApiFixtures } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { expectNavigation, NAVIGATION_BUDGET_MS } from "./fixtures/navigation-budget";

const address = sessionBody.smartAccount.address;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectNavigation(page, /\/home/);
}

async function openReceive(page: Page) {
  await installApiFixtures(page);
  await signIn(page);
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await page.getByRole("button", { name: /From another wallet/ }).click();
  await expect(page.getByRole("dialog", { name: "Receive", exact: true })).toBeVisible({ timeout: NAVIGATION_BUDGET_MS });
  await expect(page.locator("code")).toHaveText(address);
}

async function stubClipboard(page: Page, outcome: "success" | "missing" | "rejected") {
  await page.addInitScript((mode) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "missing" ? undefined : {
      writeText: async (text: string) => {
        if (mode === "rejected") throw new DOMException("Denied", "NotAllowedError");
        sessionStorage.setItem("receive:clipboard", text);
      },
    } });
  }, outcome);
}

async function stubShare(page: Page, outcome: "success" | "cancelled" | "rejected") {
  await page.addInitScript((mode) => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async (payload: ShareData) => {
      sessionStorage.setItem("receive:share", JSON.stringify(payload));
      if (mode !== "success") throw new DOMException("Share failed", mode === "cancelled" ? "AbortError" : "NotAllowedError");
    } });
  }, outcome);
}

test("receive copies the full address and decodes the QR in both appearances", async ({ page }) => {
  await stubClipboard(page, "success");
  await page.addInitScript(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
  await openReceive(page);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Address copied" })).toHaveText("Address copied");
  const clipboard = await page.evaluate(() => sessionStorage.getItem("receive:clipboard"));
  expect(clipboard).toBe(address);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), colorScheme === "dark");
    const png = await page.locator("[data-receive-qr]").screenshot();
    const pixels = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas pixel decoding is unavailable");
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: Array.from(context.getImageData(0, 0, image.width, image.height).data) };
    }, png.toString("base64"));
    expect(jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data).toBe(clipboard);
  }
  await expect(page.getByRole("status").filter({ hasText: "Address copied" })).toHaveCount(0);
});

for (const outcome of ["missing", "rejected"] as const) {
  test(`clipboard ${outcome} keeps the exact address selected for recovery`, async ({ page }) => {
    await stubClipboard(page, outcome);
    await openReceive(page);
    await page.getByRole("button", { name: "Copy address", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Select the address above and copy it");
    await expect(page.locator("code")).toBeVisible();
    await expect(page.locator("code")).toBeFocused();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(address);
  });
}

for (const outcome of ["success", "cancelled", "rejected"] as const) {
  test(`native share ${outcome} uses address-only guidance without a URL`, async ({ page }) => {
    await stubShare(page, outcome);
    await page.addInitScript(() => localStorage.setItem("home.country.v2", "FR"));
    await openReceive(page);
    await expect(page.getByText("Send USDC or EURC.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const shareJson = await page.evaluate(() => sessionStorage.getItem("receive:share"));
    if (!shareJson) throw new Error("Share did not record a payload");
    const payload: unknown = JSON.parse(shareJson);
    expect(payload).toEqual({ title: "Home address", text: `My Home address:\n${address}\nBase only. Choose Base as the network in the sending wallet.\nSend USDC or EURC.` });
    expect(payload).not.toHaveProperty("url");
    if (outcome === "rejected") await expect(page.getByRole("alert")).toContainText("Couldn't open sharing. Copy the address instead.");
    else await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("code")).toHaveText(address);
  });
}

test("receive returns to methods, restores opener focus and reloads its direct route", async ({ page }) => {
  await stubClipboard(page, "success");
  await openReceive(page);
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Receive", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Add money", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await page.getByRole("button", { name: /From another wallet/ }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: /From another wallet/ })).toBeVisible();
  await page.getByRole("button", { name: /From another wallet/ }).click();
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Address copied" })).toBeVisible();
  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page.getByRole("link", { name: "Add money", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await page.getByRole("button", { name: /From another wallet/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Address copied" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Receive", exact: true })).toBeVisible({ timeout: NAVIGATION_BUDGET_MS });
  await expect(page.locator("code")).toHaveText(address);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Add money", exact: true })).toBeFocused();
});

test("provider failure leaves From another wallet available", async ({ page }) => {
  await installApiFixtures(page);
  await page.route("**/api/funding/providers?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await signIn(page);
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const method = page.getByRole("button", { name: /From another wallet/ });
  await expect(method).toBeEnabled();
  await method.click();
  await expect(page.locator("code")).toHaveText(address);
});
