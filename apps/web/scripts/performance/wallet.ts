import { expect } from "@playwright/test";
import { manyOwnedInvestmentsSnapshot } from "../../tests/browser/fixtures/balances";
import { json } from "../../tests/browser/fixtures/api";
import { inlineFixtureMark, twoFrames, type Session } from "./browser";
import { home, navigate, ready } from "./navigation";

export async function runWalletNavigation(session: Session, baseUrl: string, holdings: number) {
  const { page } = session;
  const snapshot = manyOwnedInvestmentsSnapshot(holdings - 3);
  let current = snapshot;
  let reads = 0;
  await inlineFixtureMark(page);
  await page.route("**/api/balances?*", (route) => {
    reads++;
    return json(route, current);
  });
  const bitcoin = page.getByRole("region", { name: "Your investments" }).getByRole("button", { name: /^Bitcoin / });
  const details = async () => {
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Bitcoin");
    await expect(page.getByText("Your balance", { exact: true })).toBeVisible();
    await twoFrames(page);
  };
  const measure = async (action: () => Promise<void>) => {
    const start = performance.now();
    await action();
    return performance.now() - start;
  };
  await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" });
  await ready(page, "/home");
  const firstEntry = await navigate(page, "/investments");
  await expect(bitcoin).toBeVisible();
  const coldDetail = await measure(async () => {
    await page.goto(`${baseUrl}/investments/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf`, { waitUntil: "domcontentloaded" });
    await details();
  });
  const directBack = await measure(async () => {
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await ready(page, "/investments");
    await expect(bitcoin).toBeFocused();
    await twoFrames(page);
  });
  await bitcoin.click();
  await details();
  const warmBack = await measure(async () => {
    await page.goBack();
    await ready(page, "/investments");
    await expect(bitcoin).toBeFocused();
    await twoFrames(page);
  });
  await home(page);
  current = { ...snapshot, fetchedAt: new Date(Date.now() + 1000).toISOString(),
    block: { ...snapshot.block, number: (BigInt(snapshot.block.number) + BigInt(1)).toString() } };
  const beforeRefresh = reads;
  await page.getByRole("button", { name: "Refresh Home", exact: true }).press("Enter");
  await expect.poll(() => reads).toBeGreaterThan(beforeRefresh);
  await expect(page.getByRole("button", { name: "Refresh Home", exact: true })).toHaveAttribute("aria-busy", "false");
  const refreshedEntry = await navigate(page, "/investments");
  await expect(bitcoin).toBeVisible();
  return { holdings, durations: { firstEntry, coldDetail, directBack, warmBack, refreshedEntry }, cpu: [{ ...session.cpu }] };
}
