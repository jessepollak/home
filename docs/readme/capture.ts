// Capture the README screenshots on the sample-only boundary in sample.ts.
import type { Page } from "@playwright/test";
import { join } from "node:path";
import { appearancePreferenceKey } from "../../apps/web/shared/appearance/preference";
import { BASE_URL, OUTPUT_DIR, RECIPIENT, assertCleanRun, hideDevelopmentBadge, openSampleContext, signIn } from "./sample";

async function capture(page: Page, name: string) {
  await hideDevelopmentBadge(page);
  await page.screenshot({ path: join(OUTPUT_DIR, name), animations: "disabled" });
}

const { browser, context } = await openSampleContext();
const page = await context.newPage();
let summary = "";

try {
  await signIn(page);

  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).first().waitFor();
  await page.getByText("$4,381.08", { exact: true }).first().waitFor();
  await page.getByRole("region", { name: "Activity" }).getByText("Received", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
  await capture(page, "home.png");

  await page.goto(`${BASE_URL}/cash`);
  await page.getByRole("region", { name: "Cash" }).waitFor();
  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).waitFor();
  await page.getByText(/APY/).filter({ visible: true }).first().waitFor();
  await capture(page, "cash.png");

  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).click();
  await page.getByRole("heading", { name: "Your savings" }).waitFor();
  await page.getByRole("button", { name: /^Spark USDC Vault/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "savings.png");

  await page.goto(`${BASE_URL}/invest`);
  await page.getByRole("heading", { name: "Stocks" }).waitFor();
  await page.getByText("$184.32", { exact: true }).waitFor();
  await capture(page, "invest.png");

  await page.getByRole("button", { name: /^Bitcoin/ }).first().click();
  await page.getByRole("heading", { name: "Bitcoin" }).first().waitFor();
  await page.waitForTimeout(2_000);
  await capture(page, "asset.png");

  await page.goto(`${BASE_URL}/activity`);
  await page.getByText("Cash out to Cash App").filter({ visible: true }).first().waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "activity.png");

  await page.goto(`${BASE_URL}/borrow`);
  await page.getByRole("heading", { name: "Open loans" }).waitFor();
  await page.getByText("$1,250.00").first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "borrow.png");

  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("dialog", { name: "Send" }).waitFor();
  await page.getByRole("combobox", { name: "Asset" }).click();
  await page.getByRole("option", { name: /US dollar|USDC/ }).first().click();
  await page.getByRole("textbox", { name: "Amount" }).pressSequentially("25");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $25.00" }).waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "send-review.png");

  await page.evaluate((key) => localStorage.setItem(key, "dark"), appearancePreferenceKey);
  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).first().waitFor();
  await page.getByRole("region", { name: "Activity" }).getByText("Received", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
  await capture(page, "home-dark.png");

  summary = assertCleanRun({ expectBasenameResolver: true });
} finally {
  await browser.close();
}

console.log(`Captured README screenshots from ${BASE_URL} into ${OUTPUT_DIR}; ${summary}`);
