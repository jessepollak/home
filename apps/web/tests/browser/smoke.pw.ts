import { expect, test, type Page, type Route } from "@playwright/test";
import type { RegionId } from "../../config/regions";
import type { BalancesSnapshot } from "../../shared/balances/types";
import { balancesSnapshot, scrollableBalancesSnapshot } from "./balances-fixtures";

// Local laptops paint balances in ~350-620ms; hosted CI runners measure 1.0-2.2s.
const BALANCES_PAINTED_BUDGET_MS = process.env.CI ? 3_500 : 1_000;
const OWNER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}`;
const TRANSACTION_HASH = `0x${"cd".repeat(32)}`;
const CREATED_AT = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

type ActionStatus = "unconfirmed" | "pending" | "confirmed";

function action() {
  return {
    id: ACTION_ID,
    owner: {
      subject: "playwright-smoke-subject",
      address: OWNER,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
    kind: "send",
    title: "Send USDC",
    calls: [{
      to: USDC,
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(1_000_000).toString(16).padStart(64, "0")}`,
      value: "0",
    }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [`Recipient: ${RECIPIENT}`, "Network fee shown by wallet."],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Seeds only fixture authentication; tests still exercise the real session lifecycle. */
function seedSignedInSession(page: Page, country = "US") {
  return page.addInitScript((region) => {
    sessionStorage.setItem("home:playwright-smoke:signed-in", "1");
    localStorage.setItem("home.country.v1", region);
  }, country);
}

async function installApiFixtures(
  page: Page,
  options: { balances?: BalancesSnapshot | ((region: RegionId) => BalancesSnapshot) } = {},
) {
  let status: ActionStatus = "unconfirmed";
  let sessionReads = 0;
  let balancesReads = 0;
  const balancesReadsByRegion = new Map<RegionId, number>();
  let delayedSession: Promise<void> | null = null;
  let releaseDelayedSession: (() => void) | null = null;
  let delayedBalances: Promise<void> | null = null;
  let releaseDelayedBalances: (() => void) | null = null;
  let handleRecorded = false;
  let failHandleResponseOnce = true;
  let fundingStatusReads = 0;
  const currentAction = action();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/session") {
      sessionReads += 1;
      if (delayedSession) await delayedSession;
      return json(route, {
        user: { subject: "playwright-smoke-subject" },
        smartAccount: { address: OWNER, chainId: 8453 },
        accountProvider: "cdp-embedded",
      });
    }
    if (path === "/api/balances") {
      const region = (url.searchParams.get("region") ?? "US") as RegionId;
      balancesReads += 1;
      balancesReadsByRegion.set(region, (balancesReadsByRegion.get(region) ?? 0) + 1);
      if (delayedBalances) await delayedBalances;
      const fixture = typeof options.balances === "function"
        ? options.balances(region)
        : options.balances ?? balancesSnapshot(region);
      return json(route, fixture);
    }
    if (path === "/api/actions/prepare" && request.method() === "POST") {
      status = "unconfirmed";
      return json(route, currentAction);
    }
    if (path === `/api/actions/${ACTION_ID}/confirm`) {
      status = "pending";
      return json(route, {
        id: ACTION_ID,
        calls: currentAction.calls,
        summary: {
          title: currentAction.title,
          amounts: currentAction.amounts,
          warnings: currentAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        expiresAt: EXPIRES_AT,
      });
    }
    if (path === `/api/actions/${ACTION_ID}/handle`) {
      const body = request.postDataJSON() as { transactionHash?: string };
      if (body.transactionHash) {
        status = "confirmed";
        return json(route, {
          action: {
            id: ACTION_ID,
            status,
            providerHandle: USER_OPERATION_HASH,
            transactionHash: body.transactionHash,
          },
        });
      }
      handleRecorded = true;
      if (failHandleResponseOnce) {
        failHandleResponseOnce = false;
        return route.abort("failed");
      }
      return json(route, {
        action: { id: ACTION_ID, status: "pending", providerHandle: USER_OPERATION_HASH },
      });
    }
    if (path === `/api/actions/${ACTION_ID}`) {
      return json(route, status === "unconfirmed"
        ? {
            id: ACTION_ID,
            kind: "send",
            summary: {
              title: currentAction.title,
              amounts: currentAction.amounts,
              warnings: currentAction.warnings,
              expiresAt: EXPIRES_AT,
            },
            calls: currentAction.calls,
            expiresAt: EXPIRES_AT,
          }
        : {
            action: {
              id: ACTION_ID,
              status: "pending",
              providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined,
            },
          });
    }
    if (path === "/api/actions") {
      const actions = status === "unconfirmed" ? [] : [{
        id: ACTION_ID,
        provider: "cdp-embedded",
        kind: "send",
        summary: {
          title: currentAction.title,
          amounts: currentAction.amounts,
          warnings: currentAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        status,
        createdAt: CREATED_AT,
        confirmedAt: CREATED_AT,
        providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined,
        transactionHash: status === "confirmed" ? TRANSACTION_HASH : undefined,
        owner: currentAction.owner,
      }];
      return json(route, { actions });
    }
    if (path === "/api/funding/providers") {
      return json(route, url.searchParams.get("region") === "ID" ? {
        providers: [{
          providerId: "idrx",
          displayName: "IDRX",
          region: "ID",
          assetId: "base:idrx",
          assetSymbol: "IDRX",
          assetDecimals: 2,
          currency: "IDR",
          paymentMethods: [{ id: "bank-va-mandiri", label: "Bank transfer · Mandiri" }],
          quotes: false,
          kyc: null,
        }],
      } : { providers: [] });
    }
    if (path === "/api/funding/offramp/orders") {
      return json(route, { version: 3, recoveryEligible: false, orders: [] });
    }
    if (path === "/api/funding/quotes") {
      return json(route, {
        quoteToken: "fixture-signed-quote",
        quote: {
          fiatAmount: "20000",
          tokenAmountAtomic: "2000000",
          fees: [],
          expiresAt: EXPIRES_AT,
        },
      });
    }
    if (path === "/api/funding/orders" && request.method() === "POST") {
      return json(route, {
        order: {
          id: ACTION_ID,
          providerId: "idrx",
          region: "ID",
          assetId: "base:idrx",
          paymentMethod: "bank-va-mandiri",
          fiatAmount: "20000",
          state: "awaiting-payment",
          expectedTokenAmountAtomic: "2000000",
          fees: [{ label: "Network", amount: "100", currency: "IDR" }],
          instructions: {
            kind: "bank-transfer",
            rail: "Mandiri virtual account",
            accountNumber: "123456789012",
            accountName: "Home Fixture",
            amount: "20000",
            currency: "IDR",
          },
          providerStatus: "pending",
        },
      });
    }
    if (path === "/api/funding/orders" && request.method() === "GET") {
      return json(route, { order: null });
    }
    if (path === `/api/funding/orders/${ACTION_ID}`) {
      fundingStatusReads += 1;
      return json(route, {
        order: {
          id: ACTION_ID,
          providerId: "idrx",
          region: "ID",
          assetId: "base:idrx",
          paymentMethod: "bank-va-mandiri",
          fiatAmount: "20000",
          state: fundingStatusReads > 0 ? "received" : "awaiting-payment",
          instructions: null,
          providerStatus: "completed",
        },
      });
    }
    if (path === "/api/basename-profile") return json(route, { profile: null });
    return json(route, {});
  });

  return {
    sessionReads: () => sessionReads,
    balancesReads: () => balancesReads,
    balancesReadsForRegion: (region: RegionId) => balancesReadsByRegion.get(region) ?? 0,
    delayNextSession() {
      delayedSession = new Promise<void>((resolve) => { releaseDelayedSession = resolve; });
      return sessionReads + 1;
    },
    releaseSession() {
      releaseDelayedSession?.();
      delayedSession = null;
      releaseDelayedSession = null;
    },
    delayNextBalances() {
      delayedBalances = new Promise<void>((resolve) => { releaseDelayedBalances = resolve; });
      return balancesReads + 1;
    },
    releaseBalances() {
      releaseDelayedBalances?.();
      delayedBalances = null;
      releaseDelayedBalances = null;
    },
  };
}

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

async function typeAmount(page: Page, value: string) {
  for (const char of value) {
    await page.getByRole("button", {
      name: char === "." ? "Decimal point" : char,
      exact: true,
    }).click();
  }
}

function trackHydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) errors.push(error.message);
  });
  return errors;
}

async function visibleBalanceRowLayout(page: Page) {
  return page.locator(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
  ).evaluateAll((rows) => rows.map((row) => {
    const bounds = row.getBoundingClientRect();
    return {
      text: row.textContent?.replace(/\s+/g, " ").trim() ?? "",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }));
}

function countVisibleBalanceRows() {
  return document.querySelectorAll(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
  ).length;
}

async function openScrolledBalances(page: Page) {
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto("/balances");
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThanOrEqual(10);
  await page.waitForTimeout(150);
  const freshCount = await page.evaluate(countVisibleBalanceRows);
  const maxTop = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  });
  const target = await page.evaluate((max) => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    if (!main) return 0;
    main.scrollTop = Math.min(max, Math.max(240, Math.round(max * 0.6)));
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
    return main.scrollTop;
  }, maxTop);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThan(freshCount);
  return {
    target,
    maxTop,
    freshCount,
    revealedCount: await page.evaluate(countVisibleBalanceRows),
  };
}

async function openInvestAssetDetail(page: Page) {
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.getByRole("button", { name: /^NVIDIA/ }).click();
  await expect(page).toHaveURL(/\/invest\/nvdac$/);
}

async function expectBalancesRestored(
  page: Page,
  state: { target: number; maxTop: number; revealedCount: number },
) {
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0,
  )).toBe(state.target);
  expect(state.target).toBeLessThanOrEqual(state.maxTop);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBe(state.revealedCount);
}

function anchoredGroupOffset(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    const group = document.getElementById("investments");
    return main && group && main.scrollTop > 0
      ? group.getBoundingClientRect().top - main.getBoundingClientRect().top
      : null;
  });
}

async function markPersistedQueriesStale(page: Page) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      if (query.state) query.state.dataUpdatedAt = Date.now() - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  });
}

test("ambiguous handle response retries without a second wallet dispatch", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "Send" }).click();
  await typeAmount(page, "1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $1.00" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirm.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("home:playwright-smoke:dispatch-count"),
  )).toBe("1");
  await confirm.getByRole("button", { name: "Try again" }).click();
  await confirm.getByRole("button", { name: "Send $1.00" }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("home:playwright-smoke:dispatch-count"),
  )).toBe("1");
  await expect(page.getByText("Sent $1.00 to 0x2222…222222", { exact: true })).toBeVisible();
});

test("persisted balances paint before verification and settle without row shift", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark").length,
  )).toBeGreaterThan(0);
  const coldPaint = await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  expect(coldPaint).toBeLessThan(BALANCES_PAINTED_BUDGET_MS);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith("home.query.v1:")),
  )).toBe(true);
  await page.waitForTimeout(600);
  await markPersistedQueriesStale(page);
  const hydrationErrors = trackHydrationErrors(page);
  const delayedSessionRead = fixtures.delayNextSession();
  const delayedBalancesRead = fixtures.delayNextBalances();
  const balancesReadsBeforeReload = fixtures.balancesReads();

  await page.reload();
  await expect.poll(fixtures.sessionReads).toBeGreaterThanOrEqual(delayedSessionRead);
  await expect(page.getByText("Recognized Coin", { exact: true }).first()).toBeVisible();
  expect(fixtures.balancesReads()).toBe(balancesReadsBeforeReload);
  const provisionalLayout = await visibleBalanceRowLayout(page);
  const provisionalPaint = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Infinity,
    verified: performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Infinity,
  }));
  expect(provisionalPaint.balances).toBeLessThan(coldPaint);
  expect(provisionalPaint.balances).toBeLessThan(provisionalPaint.verified);

  fixtures.releaseSession();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark").length,
  )).toBeGreaterThan(0);
  await expect.poll(fixtures.balancesReads).toBeGreaterThanOrEqual(delayedBalancesRead);
  fixtures.releaseBalances();
  await expect(page.locator('[data-shell-panel]:not([hidden]) [aria-label="Total balance"]'))
    .not.toHaveAttribute("aria-busy", "true");
  expect(await visibleBalanceRowLayout(page)).toEqual(provisionalLayout);
  expect(hydrationErrors).toEqual([]);
});

test("drawer becomes instant when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "Send" }).click();
  const transitions = await page.locator(
    '[data-slot="drawer-overlay"], [data-slot="drawer-popup"], [data-slot="drawer-content"]',
  ).evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transitionDuration));
  expect(transitions).toEqual(["0s", "0s", "0s"]);
});

test("canonical routing preserves the shell and one balances read", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expect.poll(() => fixtures.balancesReadsForRegion("US")).toBe(1);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Send" })).toHaveCount(0);

  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.evaluate(() => {
    for (const node of [
      document.querySelector<HTMLElement>(".app-main-authenticated"),
      document.querySelector<HTMLElement>("header"),
    ]) {
      if (node) (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe = true;
    }
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/balances$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/balances$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/invest$/);
  expect(await page.evaluate(() => [
    document.querySelector<HTMLElement>(".app-main-authenticated"),
    document.querySelector<HTMLElement>("header"),
  ].every((node) => node && (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe)))
    .toBe(true);
  expect(fixtures.balancesReads()).toBe(1);
});

test("browser Back restores the Balances reveal and scroll offset", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await openInvestAssetDetail(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/invest$/);
  await page.goBack();
  await expectBalancesRestored(page, state);
});

test("generic destination resets Balances to the top on browser Back", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0,
  )).toBe(0);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBe(state.freshCount);
});

test("IDRX funding reaches review, payment instructions, and receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "ID"));
  await installApiFixtures(page);
  await signIn(page);
  await page.getByRole("button", { name: "Add money" }).click();
  const method = page.getByRole("button", { name: /Deposit IDR/ });
  await expect(method).toContainText("IDRX · Bank transfer · Mandiri");
  await method.click();
  await typeAmount(page, "20000");
  await page.getByRole("button", { name: "Review quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review quote" })).toBeVisible();
  await expect(page.getByText("Receive", { exact: true }).locator("..")).toContainText("20.000,00 IDRX");
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await expect(page.getByText("Network", { exact: true }).locator("..")).toContainText("Rp 100,00");
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("123456789012", { exact: true })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
});

test("representative canonical routes SSR and hydrate their selected panel", async ({ page }) => {
  await seedSignedInSession(page, "GB");
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("home.query.v1:")) localStorage.removeItem(key);
    }
  });
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  const routes = [
    ["/home", ">Total balance<", "Home"],
    ["/balances/investments", 'aria-label="Your money"', "Your money"],
    ["/invest/nvdac", 'aria-label="NVIDIA"', "NVIDIA"],
  ] as const;
  for (const [url, ssrMarker, title] of routes) {
    const html = await page.request.get(url).then((response) => response.text());
    expect(html).toContain(ssrMarker);
    expect((html.match(/<div data-shell-panel=""[^>]*>/g) ?? [])
      .filter((tag) => !tag.includes("hidden"))).toHaveLength(1);
    await page.goto(url);
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText(title);
  }
  expect(hydrationErrors).toEqual([]);
});

test("cold and revalidated cached Balances stay anchored to the requested group", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  let serveChanged = false;
  let releaseChanged = () => {};
  const changedResponse = new Promise<void>((resolve) => { releaseChanged = resolve; });
  let revalidatedReads = 0;
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await page.route((url) => url.pathname === "/api/balances", async (route) => {
    const region = (new URL(route.request().url()).searchParams.get("region") ?? "US") as RegionId;
    const snapshot = scrollableBalancesSnapshot(region);
    if (!serveChanged) return json(route, snapshot);
    revalidatedReads += 1;
    await changedResponse;
    return json(route, {
      ...snapshot,
      holdings: snapshot.holdings.map((holding) => holding.symbol === "USDC"
        ? {
            ...holding,
            ...(holding.value.status === "priced"
              ? { value: { ...holding.value, amount: { atoms: "1235", scale: 2 } } }
              : {}),
            ...(holding.cashValue?.status === "priced"
              ? { cashValue: { ...holding.cashValue, amount: { atoms: "1235", scale: 2 } } }
              : {}),
          }
        : holding),
    });
  });

  await page.goto("/balances/investments");
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith("home.query.v1:")),
  )).toBe(true);
  await page.waitForTimeout(600);
  await markPersistedQueriesStale(page);

  serveChanged = true;
  await page.reload();
  await expect(
    page.locator('[data-shell-panel]:not([hidden]) li', { hasText: "$12.34" }).first(),
  ).toBeVisible();
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  await expect.poll(() => revalidatedReads).toBeGreaterThanOrEqual(1);
  releaseChanged();
  await expect(page.locator('[data-shell-panel]:not([hidden]) li', { hasText: "$12.35" }).first())
    .toBeVisible();
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
});
