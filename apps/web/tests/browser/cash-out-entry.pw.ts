import { expect, test, type Page } from "@playwright/test";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import type { RegionId } from "@/config/regions";
import { cashoutFixturePrepared, cashoutFixtureProviders, cashoutFixtureResume } from "./feature-map/cashout-fixture";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { expectNavigation } from "./fixtures/navigation-budget";

async function setup(page: Page, region: RegionId = "US") {
  await seedSignedInSession(page, region);
  await installApiFixtures(page, { countryPreferenceRegion: region, balances: buildBalancesSnapshotFixture({
    region: region,
    registry: { usdc: { balance: ready("100000000"), value: priced("USD", "10000"), cashValue: pricedCash("USD", "10000") } },
  }) });
  const requests = { prepares: 0, confirms: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/actions/prepare") requests.prepares += 1;
    if (/\/api\/actions\/[^/]+\/(confirm|handle)$/.test(path)) requests.confirms += 1;
  });
  await page.route("**/api/funding/providers**", (route) => {
    if (new URL(route.request().url()).searchParams.get("direction") !== "offramp") return route.fallback();
    return json(route, cashoutFixtureProviders);
  });
  await page.route("**/api/actions/prepare", (route) => json(route, cashoutFixturePrepared));
  await page.route(`**/api/actions/${cashoutFixturePrepared.id}`, (route) => json(route, cashoutFixtureResume));
  return requests;
}

async function expectNoDispatch(page: Page, requests: { prepares: number; confirms: number }, prepares = 0) {
  expect(requests.prepares).toBe(prepares);
  expect(requests.confirms).toBe(0);
  expect(await page.evaluate(() => Number(sessionStorage.getItem("home:playwright-smoke:dispatch-count") ?? 0))).toBe(0);
}

async function openMethods(page: Page) {
  await page.getByRole("button", { name: "Cash out", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Amount" }).fill("50");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Cash App.*Peer/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Venmo.*Peer/ })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  return dialog;
}

test("Home money actions follow Add money, Send, Cash out in DOM and Tab order", async ({ page }) => {
  await setup(page);
  await page.goto("/home");
  const actions = page.getByRole("group", { name: "Money actions" });
  await expect(actions.locator("a, button")).toHaveText(["Add money", "Send", "Cash out"]);
  await expect(actions.getByRole("link")).toHaveText(["Add money"]);
  await expect(actions.getByRole("button")).toHaveText(["Send", "Cash out"]);
  await actions.getByRole("link", { name: "Add money", exact: true }).focus();
  await expect(actions.getByRole("link", { name: "Add money", exact: true })).toBeFocused();
  for (const name of ["Send", "Cash out"]) {
    await page.keyboard.press("Tab");
    await expect(actions.getByRole("button", { name, exact: true })).toBeFocused();
  }
});

test("Cash out review reloads without preparing or dispatching again and keeps entry history", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/home");
  const dialog = await openMethods(page);
  await dialog.getByRole("button", { name: /Cash App.*Peer/ }).click();
  await expect(dialog.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Cash App cashtag" }).fill("$fixture-payee");
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Confirm", exact: true });
  await expect(review.getByRole("button", { name: "Cash out $50.00", exact: true })).toBeVisible();
  await expect(review.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  await expectNavigation(page, `/home?flow=cash-out&action=${cashoutFixturePrepared.id}`);
  await expectNoDispatch(page, requests, 1);
  await page.reload();
  await expect(review.getByRole("button", { name: "Cash out $50.00", exact: true })).toHaveAttribute("data-money-action-id", cashoutFixturePrepared.id);
  await expect(review.getByRole("group", { name: "Payout destination" }).getByText("fixture-payee", { exact: true })).toBeVisible();
  await expect(review.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  await expectNoDispatch(page, requests, 1);
  await review.getByRole("button", { name: "Back", exact: true }).last().click();
  await expect(page.getByRole("textbox", { name: "Cash App cashtag" })).toHaveValue("fixture-payee");
  await page.getByRole("button", { name: "Close cash-out dialog" }).click();
  await expectNavigation(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expectNavigation(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expectNavigation(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoDispatch(page, requests, 1);
});

test("Close then Forward restores the same Cash out review without preparing again", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/home");
  const dialog = await openMethods(page);
  await dialog.getByRole("button", { name: /Cash App.*Peer/ }).click();
  await dialog.getByRole("textbox", { name: "Cash App cashtag" }).fill("$fixture-payee");
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Confirm", exact: true });
  await expect(review.getByRole("button", { name: "Cash out $50.00", exact: true })).toBeVisible();
  await expectNavigation(page, `/home?flow=cash-out&action=${cashoutFixturePrepared.id}`);
  await page.getByRole("button", { name: "Close cash-out dialog" }).click();
  await expectNavigation(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expectNavigation(page, `/home?flow=cash-out&action=${cashoutFixturePrepared.id}`);
  await expect(review.getByRole("button", { name: "Cash out $50.00", exact: true })).toHaveAttribute("data-money-action-id", cashoutFixturePrepared.id);
  await expectNoDispatch(page, requests, 1);
});

test("legacy Send cash-out review canonicalizes to Cash out", async ({ page }) => {
  const requests = await setup(page);
  await page.goto(`/home?flow=send&action=${cashoutFixturePrepared.id}`);
  await expect(page.getByRole("button", { name: "Cash out $50.00", exact: true })).toBeVisible();
  await expectNavigation(page, `/home?flow=cash-out&action=${cashoutFixturePrepared.id}`);
  await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
  await expectNoDispatch(page, requests);
});

test("unknown or wrong-owner cash-out review clears action and starts at amount", async ({ page }) => {
  const requests = await setup(page);
  await page.route(`**/api/actions/${cashoutFixturePrepared.id}`, (route) => route.fulfill({ status: 404, json: { error: { code: "ACTION_NOT_FOUND", message: "Action not found" } } }));
  await page.goto(`/home?flow=cash-out&action=${cashoutFixturePrepared.id}`);
  await expectNavigation(page, "/home?flow=cash-out");
  await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("");
  await expect(page.getByRole("group", { name: "Payout destination" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cash out $50.00", exact: true })).toHaveCount(0);
  await expectNoDispatch(page, requests);
});

test("unsupported BR cash-out switches to Send", async ({ page }) => {
  const requests = await setup(page, "BR");
  await page.route("**/api/funding/providers**", (route) => json(route, { ...cashoutFixtureProviders, providers: [] }));
  await page.goto("/home");
  const actions = page.getByRole("group", { name: "Money actions" });
  await expect(actions.getByRole("button", { name: "Cash out", exact: true })).toHaveCount(1);
  await expect(actions.getByRole("button", { name: "Send", exact: true })).toHaveCount(1);
  await actions.getByRole("button", { name: "Cash out", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cash out", exact: true });
  await expect(dialog.getByText("Cash out to Brazilian real isn't available yet", { exact: true })).toBeVisible();
  await expect(dialog.getByText("You can still send USDC to any wallet.")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Send USDC", exact: true })).toHaveCount(1);
  {
    await dialog.getByRole("button", { name: "Send USDC", exact: true }).click();
    await expectNavigation(page, "/home?flow=send");
    const send = page.getByRole("dialog", { name: "Send", exact: true });
    await expect(send.getByRole("button", { name: "Close send dialog", exact: true })).toBeVisible();
    await expect(send.getByText("Cash out to Brazilian real isn't available yet", { exact: true })).toHaveCount(0);
    await expect(send.getByRole("button", { name: /Cash App.*Peer/ })).toHaveCount(0);
  }
  await expectNoDispatch(page, requests);
});

test("provider failure retains error while Retry is fetching and recovers", async ({ page }) => {
  const requests = await setup(page);
  let reads = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/funding/providers**", async (route) => {
    reads += 1;
    if (reads === 1) return route.fulfill({ status: 500, json: { error: "unavailable" } });
    await held;
    return json(route, cashoutFixtureProviders);
  });
  await page.goto("/home?flow=cash-out");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Cash out is unavailable right now.")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Cash out is unavailable right now.")).toBeVisible();
  expect(reads).toBe(2);
  release();
  await expect(dialog.getByRole("textbox", { name: "Amount" })).toBeVisible();
  await expect(dialog.getByText("Cash out is unavailable right now.")).toHaveCount(0);
  await expectNoDispatch(page, requests);
});

test("slow provider lookup shows checking without an unavailable claim", async ({ page }) => {
  const requests = await setup(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/funding/providers**", async (route) => { await held; return json(route, cashoutFixtureProviders); });
  await page.goto("/home?flow=cash-out");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Checking cash-out options…")).toBeVisible();
  await expect(dialog.getByText("Cash out is unavailable right now.")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
  release();
  await expect(dialog.getByRole("textbox", { name: "Amount" })).toBeVisible();
  await expectNoDispatch(page, requests);
});
