import { expect, test, type Page } from "@playwright/test";
import {
  SAVE_QA_CLOCK_MS,
  createSaveQaVaults,
  type SaveQaPositionVariant,
  type SaveQaVaultVariant,
} from "../../app/dev/save-qa/fixtures";
import {
  buildSaveQaProduction,
  startSaveQaDevelopmentServer,
  startSaveQaProductionServer,
  type SaveQaServer,
} from "./support/save-qa-server";

test.setTimeout(120_000);

let server: SaveQaServer;
let origin: string;

type NetworkControl = {
  vaultVariant: SaveQaVaultVariant;
  deferVaults: boolean;
  releaseVaults: () => void;
  attempted: string[];
  completed: string[];
  aborted: string[];
  interceptedVaults: number;
  unexpectedWebSockets: string[];
};

async function expectExcluded(serverOrigin: string): Promise<void> {
  const response = await fetch(`${serverOrigin}/dev/save-qa`);
  const body = await response.text();
  expect(response.status).toBe(404);
  expect(body).not.toContain("QA fixture · synthetic account/data");
  expect(body).not.toContain("saveQa");
  expect(body).not.toContain("save-qa-subject");
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  buildSaveQaProduction();
  const production = await startSaveQaProductionServer();
  await expectExcluded(production.origin);
  await production.stop();

  const disabled = await startSaveQaDevelopmentServer(false);
  await expectExcluded(disabled.origin);
  await disabled.stop();

  server = await startSaveQaDevelopmentServer(true);
  origin = server.origin;
});

test.afterAll(async () => {
  await server?.stop();
});

async function installNetworkBoundary(page: Page): Promise<NetworkControl> {
  let releaseVaults!: () => void;
  const vaultBarrier = new Promise<void>((resolve) => { releaseVaults = resolve; });
  const control: NetworkControl = {
    vaultVariant: "standard",
    deferVaults: false,
    releaseVaults: () => releaseVaults(),
    attempted: [],
    completed: [],
    aborted: [],
    interceptedVaults: 0,
    unexpectedWebSockets: [],
  };

  await page.routeWebSocket(
    (url) => !(url.hostname === "localhost" && url.pathname === "/_next/hmr"),
    (webSocket) => {
      control.unexpectedWebSockets.push(webSocket.url());
      webSocket.close({ code: 1008, reason: "Save QA blocks unexpected WebSockets." });
    },
  );

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    control.attempted.push(`${request.method()} ${url.href}`);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (!loopback) {
      control.aborted.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    const exactVaultRequest =
      url.origin === origin &&
      url.pathname === "/api/savings/vaults" &&
      url.search === "" &&
      request.method() === "GET";
    if (exactVaultRequest) {
      control.interceptedVaults += 1;
      if (control.deferVaults) await vaultBarrier;
      const fixture = createSaveQaVaults(control.vaultVariant, SAVE_QA_CLOCK_MS);
      expect(fixture.candidates).toHaveLength(3);
      expect(fixture.source.query).toBe("vaults");
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(fixture),
      });
      control.completed.push(url.href);
      return;
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      control.aborted.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
    control.completed.push(url.href);
  });

  return control;
}

async function openDisarmed(page: Page): Promise<NetworkControl> {
  const network = await installNetworkBoundary(page);
  await page.goto(`${origin}/dev/save-qa`);
  await expect(page.getByLabel("QA fixture disclosure")).toBeVisible();
  await expect(page.getByRole("main", { name: "Save QA disarmed" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await page.clock.install({ time: SAVE_QA_CLOCK_MS });
  return network;
}

async function arm(
  page: Page,
  network: NetworkControl,
  options: { positionVariant?: SaveQaPositionVariant; vaultVariant?: SaveQaVaultVariant } = {},
): Promise<void> {
  network.vaultVariant = options.vaultVariant ?? "standard";
  await page.evaluate((armOptions) => window.saveQa!.arm(armOptions), options);
  await expect(page.locator("main.app-main.app-main-authenticated")).toBeVisible();
  await expect(page.locator("#save-panel")).toBeVisible();
  await expect(page.getByRole("region", { name: "Save" })).toBeVisible();
}

async function pendingPositionCount(page: Page, owner = "a"): Promise<number> {
  return page.evaluate((requestedOwner) => window.saveQa!.snapshot().pendingPositionReads.filter(
    (request) => request.owner === requestedOwner && !request.settled && !request.aborted,
  ).length, owner);
}

async function resolvePosition(
  page: Page,
  variant: SaveQaPositionVariant = "weighted",
  owner: "a" | "b" = "a",
): Promise<void> {
  await expect.poll(() => pendingPositionCount(page, owner)).toBeGreaterThan(0);
  await page.evaluate(({ positionVariant, requestedOwner }) => {
    window.saveQa!.resolveNextPosition(positionVariant, requestedOwner);
  }, { positionVariant: variant, requestedOwner: owner });
}

async function readyWeighted(page: Page): Promise<NetworkControl> {
  const network = await openDisarmed(page);
  await arm(page, network);
  await resolvePosition(page);
  await expect(page.getByText("$400.00").first()).toBeVisible();
  await expect(page.getByText("Earning ~5.50%")).toBeVisible();
  return network;
}

test("bare route is inert, actual dashboard mounts only when armed, and normal dashboard has no QA controller", async ({ page }) => {
  const network = await openDisarmed(page);
  expect(network.interceptedVaults).toBe(0);
  expect(await page.evaluate(() => window.saveQa!.snapshot().counters)).toEqual({
    portfolioReads: 0,
    valuationReads: 0,
    positionReads: 0,
    preparations: 0,
    checks: 0,
    executions: 0,
    sends: 0,
    signIns: 0,
    signatures: 0,
    accountResourceReads: 0,
  });

  await arm(page, network);
  await expect(page.locator("header.app-header")).toBeVisible();
  await expect(page.locator("nav").last()).toBeVisible();
  await expect.poll(() => network.interceptedVaults).toBeGreaterThan(0);
  await expect.poll(() => pendingPositionCount(page)).toBe(1);

  await page.goto(`${origin}/dashboard`);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(false);
  await expect(page.getByLabel("QA fixture disclosure")).toHaveCount(0);
});

test("enforces exact vault interception, deny-all APIs and egress, and zero execution/signing", async ({ page }) => {
  const network = await readyWeighted(page);
  const probes = await page.evaluate(async () => {
    const results: string[] = [];
    for (const url of ["/api/private-probe", "https://example.com/egress-probe"]) {
      try { await fetch(url); results.push("completed"); } catch { results.push("blocked"); }
    }
    const socket = new WebSocket("wss://example.com/socket-probe");
    await new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
      socket.addEventListener("error", () => resolve(), { once: true });
    });
    results.push("socket-blocked");
    return results;
  });
  expect(probes).toEqual(["blocked", "blocked", "socket-blocked"]);
  expect(network.aborted.some((url) => url.includes("/api/private-probe"))).toBe(true);
  expect(network.aborted.some((url) => url.includes("example.com/egress-probe"))).toBe(true);
  expect(network.interceptedVaults).toBeGreaterThan(0);
  expect(network.unexpectedWebSockets).toEqual(["wss://example.com/socket-probe"]);
  const counters = await page.evaluate(() => window.saveQa!.snapshot().counters);
  expect(counters.executions).toBe(0);
  expect(counters.checks).toBe(0);
  expect(counters.sends).toBe(0);
  expect(counters.signIns).toBe(0);
  expect(counters.signatures).toBe(0);
});

test("covers both cold request orders and painted shimmer", async ({ page }) => {
  const network = await openDisarmed(page);
  await arm(page, network);
  await expect.poll(() => network.interceptedVaults).toBeGreaterThan(0);
  const shimmer = page.locator("[data-shimmer='savings-hero']");
  await expect(shimmer).toBeVisible();
  const paint = await shimmer.evaluate((element) => {
    const style = getComputedStyle(element);
    const after = getComputedStyle(element, "::after");
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      background: style.backgroundColor,
      afterDisplay: after.display,
      afterAnimation: after.animationName,
    };
  });
  expect(paint.width).toBeGreaterThan(0);
  expect(paint.height).toBeGreaterThan(0);
  expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(paint.afterDisplay).not.toBe("none");
  expect(paint.afterAnimation).not.toBe("none");
  await resolvePosition(page);
  await expect(page.getByText("Earning ~5.50%")).toBeVisible();

  await page.reload();
  network.deferVaults = true;
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await arm(page, network);
  await resolvePosition(page, "balance-before-apy");
  await expect(page.getByText("$100.00").first()).toBeVisible();
  await expect(page.getByText("Loading APY…")).toBeVisible();
  network.releaseVaults();
  await expect(page.getByText("Earning ~4.00%")).toBeVisible();
});

test("reduced motion keeps a visible nonanimated shimmer fallback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const network = await openDisarmed(page);
  await arm(page, network);
  const shimmer = page.locator("[data-shimmer='savings-hero']");
  await expect(shimmer).toBeVisible();
  const paint = await shimmer.evaluate((element) => {
    const style = getComputedStyle(element);
    const after = getComputedStyle(element, "::after");
    return { background: style.backgroundColor, display: after.display, animation: after.animationName };
  });
  expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(paint.display === "none" || paint.animation === "none").toBe(true);
});

test("cold rejected and incomplete reads become unavailable without endless shimmer", async ({ page }) => {
  let network = await openDisarmed(page);
  await arm(page, network);
  await expect.poll(() => pendingPositionCount(page)).toBe(1);
  await page.evaluate(() => window.saveQa!.rejectNextPosition("cold rejection", "a"));
  await expect(page.getByText("Balance unavailable")).toBeVisible();
  await expect(page.locator("[data-shimmer='savings-hero']")).toHaveCount(0);

  await page.reload();
  network = await installNetworkBoundary(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await arm(page, network);
  await resolvePosition(page, "incomplete");
  await expect(page.getByText("Balance unavailable")).toBeVisible();
  await expect(page.locator("[data-shimmer='savings-hero']")).toHaveCount(0);
});

test("shows weighted, selection-independent, zero, missing-rate and stale-rate states", async ({ page }) => {
  let network = await readyWeighted(page);
  const caption = page.getByText("Earning ~5.50%");
  await page.getByRole("radio", { name: /Steakhouse USDC/ }).click();
  await expect(caption).toBeVisible();

  await page.reload();
  network = await installNetworkBoundary(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await arm(page, network);
  await resolvePosition(page, "zero");
  await expect(page.getByText("$0.00")).toBeVisible();
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  await page.reload();
  network = await installNetworkBoundary(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await arm(page, network, { vaultVariant: "missing-rate" });
  await resolvePosition(page);
  await expect(page.getByText("$400.00").first()).toBeVisible();
  await expect(page.getByText("APY partially unavailable")).toBeVisible();

  await page.reload();
  network = await installNetworkBoundary(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveQa))).toBe(true);
  await arm(page, network, { vaultVariant: "stale" });
  await resolvePosition(page, "balance-before-apy");
  await expect(page.getByText("$100.00").first()).toBeVisible();
  await expect(page.getByText("APY data stale")).toBeVisible();
});

test("retains same-owner values across deferred malformed and rejected transport refreshes", async ({ page }) => {
  await readyWeighted(page);
  await page.evaluate(() => window.saveQa!.refresh("malformed"));
  await expect(page.getByText("Refreshing…")).toBeVisible();
  await expect(page.getByText("$400.00").first()).toBeVisible();
  await resolvePosition(page, "malformed");
  await expect(page.getByText("Refresh unavailable")).toBeVisible();
  await expect(page.getByText("$400.00").first()).toBeVisible();

  await page.evaluate(() => window.saveQa!.refresh("weighted"));
  await expect(page.getByText("Refreshing…")).toBeVisible();
  await expect.poll(() => pendingPositionCount(page)).toBeGreaterThan(0);
  await page.evaluate(() => window.saveQa!.rejectNextPosition("refresh rejected", "a"));
  await expect(page.getByText("Refresh unavailable")).toBeVisible();
  await expect(page.getByText("$400.00").first()).toBeVisible();
});

test("fences a late A response after A to B without remounting the dashboard", async ({ page }) => {
  const network = await openDisarmed(page);
  await arm(page, network);
  await expect.poll(() => pendingPositionCount(page, "a")).toBe(1);
  await page.locator("#save-panel").evaluate((element) => { element.setAttribute("data-mount-probe", "original"); });

  await page.evaluate(() => window.saveQa!.setOwner("b"));
  await expect.poll(() => pendingPositionCount(page, "b")).toBe(1);
  await page.evaluate(() => window.saveQa!.resolveNextPosition("weighted", "a"));
  await expect(page.getByText("$400.00")).toHaveCount(0);
  await expect(page.getByText("Updating…")).toBeVisible();
  await expect(page.locator("#save-panel")).toHaveAttribute("data-mount-probe", "original");

  await resolvePosition(page, "zero", "b");
  await expect(page.getByText("$0.00")).toBeVisible();
  const requests = await page.evaluate(() => window.saveQa!.snapshot().pendingPositionReads);
  expect(requests.find((request) => request.owner === "a")?.aborted).toBe(true);
});

test("uses real keyboard activation, focus, held pointer state, and non-executable modal review", async ({ page }) => {
  await readyWeighted(page);
  const radios = page.getByRole("radio");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    if (await radios.nth(0).evaluate((element) => element === document.activeElement)) break;
  }
  await expect(radios.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Shift+Tab");
  await expect(radios.nth(0)).toBeFocused();

  const deposit = page.getByRole("button", { name: "Deposit" });
  const box = await deposit.boundingBox();
  if (!box) throw new Error("Deposit button was not measurable.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await deposit.evaluate((element) => element.matches(":active"))).toBe(true);
  await page.mouse.up();

  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm" })).toBeVisible();
  await expect(page.getByText("Deposit to Save")).toBeVisible();
  await page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Back" }).last().click();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByRole("dialog", { name: "Withdraw" })).toBeVisible();
  await page.getByRole("button", { name: "Close withdraw dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const counters = await page.evaluate(() => window.saveQa!.snapshot().counters);
  expect(counters.preparations).toBe(1);
  expect(counters.executions).toBe(0);
  expect(counters.checks).toBe(0);
});

test("keeps long labels, large values and actions unclipped at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const network = await openDisarmed(page);
  await arm(page, network, { vaultVariant: "long" });
  await resolvePosition(page, "large");
  await expect(page.getByRole("button", { name: "Deposit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(page.getByText(/Institutional USDC Income Strategy/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const clipped = await page.locator("#save-panel").evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>("strong, p, button"))
    .filter((element) => element.offsetParent !== null)
    .some((element) => element.scrollWidth > element.clientWidth + 1));
  expect(clipped).toBe(false);
});
