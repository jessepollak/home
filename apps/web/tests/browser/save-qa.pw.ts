import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
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
  startSaveQaServerForTest,
  teardownSaveQaProcessGroup,
  withSaveQaServer,
  type SaveQaServer,
} from "./support/save-qa-server";

test.setTimeout(120_000);

let server: SaveQaServer;
let origin: string;

const forbiddenQaMarkers = [
  "window.saveQa",
  "save-qa-subject",
  "SAVE_QA",
  "save-qa-client",
  "QA fixture · synthetic account/data",
] as const;

type NetworkControl = {
  vaultVariant: SaveQaVaultVariant;
  deferVaults: boolean;
  releaseVaults: () => void;
  attempted: string[];
  intercepted: string[];
  aborted: string[];
  responses: string[];
  failures: string[];
  allowed: string[];
  socketAttempts: string[];
  blockedSockets: string[];
};

function expectNoQaMarkers(body: string, label: string): void {
  for (const marker of forbiddenQaMarkers) {
    expect(body, `${label} exposed ${marker}`).not.toContain(marker);
  }
}

function referencedClientChunks(body: string): string[] {
  return [...new Set(body.match(/\/_next\/static\/chunks\/[^"'\\\s<>]+\.js/g) ?? [])];
}

async function readDirectExcludedResponse(
  serverOrigin: string,
  init: RequestInit = {},
): Promise<string> {
  const response = await fetch(`${serverOrigin}/dev/save-qa`, {
    ...init,
    redirect: "manual",
  });
  const body = await response.text();
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("location")).toBeNull();
  expect(body).toBe(init.method === "HEAD" ? "" : "Not found.\n");
  expectNoQaMarkers(body, `${init.method ?? "GET"} exclusion body`);
  return body;
}

async function expectExcluded(serverOrigin: string): Promise<void> {
  const documentBody = await readDirectExcludedResponse(serverOrigin);
  const headBody = await readDirectExcludedResponse(serverOrigin, { method: "HEAD" });
  const postBody = await readDirectExcludedResponse(serverOrigin, { method: "POST" });
  const rscBody = await readDirectExcludedResponse(serverOrigin, {
    headers: { Accept: "text/x-component", RSC: "1" },
  });

  const combined = `${documentBody}${headBody}${postBody}${rscBody}`;
  expect(referencedClientChunks(combined)).toEqual([]);
  expect(combined).not.toContain("<script");
  expect(combined).not.toContain("preload");
  expect(combined).not.toContain("self.__next_f");
  expect(combined).not.toContain("/_next/");
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  buildSaveQaProduction();
  await withSaveQaServer(startSaveQaProductionServer, ({ origin: productionOrigin }) =>
    expectExcluded(productionOrigin));
  await withSaveQaServer(() => startSaveQaDevelopmentServer(false), ({ origin: disabledOrigin }) =>
    expectExcluded(disabledOrigin));

  server = await startSaveQaDevelopmentServer(true);
  origin = server.origin;
});

test.afterAll(async () => {
  await server?.stop();
});

function canonicalRawPath(rawUrl: string, parsed: URL): string | null {
  if (!rawUrl.startsWith(`${origin}/`) || parsed.origin !== origin) return null;
  const rawTarget = rawUrl.slice(origin.length);
  const queryIndex = rawTarget.indexOf("?");
  const rawPath = queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  if (
    rawPath.length === 0 ||
    rawPath.startsWith("//") ||
    rawPath.includes("\\") ||
    /%(?:2f|5c|2e)/i.test(rawPath) ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..") ||
    parsed.pathname !== rawPath ||
    parsed.pathname.includes("//")
  ) {
    return null;
  }
  return rawPath;
}

const trackedAssetPaths = new Set([
  "/home-mark/BaseSans-Medium.woff",
  "/home-mark/Doto.ttf",
  ...[
    "ar", "au", "br", "ca", "ch", "cl", "co", "eu", "gb", "id",
    "mx", "my", "ng", "nz", "pe", "sg", "tr", "us", "za",
  ].map((country) => `/currency-flags/${country}.svg`),
]);

function allowedTrackedAsset(pathname: string): boolean {
  return trackedAssetPaths.has(pathname);
}

async function installNetworkBoundary(page: Page): Promise<NetworkControl> {
  let releaseVaults!: () => void;
  const vaultBarrier = new Promise<void>((resolve) => { releaseVaults = resolve; });
  const control: NetworkControl = {
    vaultVariant: "standard",
    deferVaults: false,
    releaseVaults: () => releaseVaults(),
    attempted: [],
    intercepted: [],
    aborted: [],
    responses: [],
    failures: [],
    allowed: [],
    socketAttempts: [],
    blockedSockets: [],
  };

  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const browserWindow = window as unknown as {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };
    browserWindow.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const rawTarget = raw.replace(/^[a-z]+:\/\/[^/]+/i, "");
      const rawPath = rawTarget.split("?", 1)[0];
      if (
        raw.includes("\\") ||
        /%(?:2f|5c|2e)/i.test(rawPath) ||
        rawPath.startsWith("//") ||
        rawPath.includes("//") ||
        rawPath.split("/").some((segment) => segment === "." || segment === "..")
      ) {
        return Promise.reject(new TypeError("Save QA rejected a noncanonical request URL."));
      }
      return nativeFetch(input, init);
    };
  });

  page.on("request", (request) => {
    control.attempted.push(`${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    control.responses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    control.failures.push(`${request.failure()?.errorText ?? "failed"} ${request.method()} ${request.url()}`);
  });
  page.on("websocket", (webSocket) => {
    control.socketAttempts.push(webSocket.url());
  });

  const runner = new URL(origin);
  await page.routeWebSocket(
    (url) => !(
      url.protocol === "ws:" &&
      url.hostname === runner.hostname &&
      url.port === runner.port &&
      url.pathname === "/_next/hmr"
    ),
    (webSocket) => {
      control.blockedSockets.push(webSocket.url());
      webSocket.close({ code: 1008, reason: "Save QA blocks unexpected WebSockets." });
    },
  );

  await page.route("**/*", async (route) => {
    const request = route.request();
    const rawUrl = request.url();
    const url = new URL(rawUrl);
    const pathname = canonicalRawPath(rawUrl, url);
    const method = request.method();
    const exactVaultRequest =
      pathname === "/api/savings/vaults" &&
      url.search === "" &&
      method === "GET";

    if (exactVaultRequest) {
      control.intercepted.push(`${method} ${rawUrl}`);
      if (control.deferVaults) await vaultBarrier;
      const fixture = createSaveQaVaults(control.vaultVariant, SAVE_QA_CLOCK_MS);
      expect(fixture.candidates).toHaveLength(3);
      expect(fixture.source.query).toBe("vaults");
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(fixture),
      });
      return;
    }

    const allowedDocument =
      method === "GET" &&
      url.search === "" &&
      (pathname === "/dev/save-qa" || pathname === "/dashboard");
    const allowedNextAsset =
      method === "GET" &&
      url.search === "" &&
      pathname?.startsWith("/_next/static/");
    const allowedLocalAsset =
      method === "GET" &&
      url.search === "" &&
      pathname !== null &&
      allowedTrackedAsset(pathname);
    const allowedRedirectProbe =
      method === "GET" &&
      url.search === "" &&
      pathname === "/home-mark/";

    if (allowedDocument || allowedNextAsset || allowedLocalAsset || allowedRedirectProbe) {
      try {
        const upstream = await route.fetch({ maxRedirects: 0 });
        const status = upstream.status();
        if (
          status < 200 ||
          status >= 300 ||
          upstream.url() !== rawUrl
        ) {
          control.aborted.push(`${method} ${rawUrl}`);
          await route.abort("blockedbyclient");
          return;
        }
        control.allowed.push(`${method} ${rawUrl}`);
        await route.fulfill({ response: upstream });
        return;
      } catch {
        control.aborted.push(`${method} ${rawUrl}`);
        await route.abort("blockedbyclient");
        return;
      }
    }

    control.aborted.push(`${method} ${rawUrl}`);
    await route.abort("blockedbyclient");
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

function launchLifecycleProbe(ignoreTerm: boolean): ChildProcess {
  const script = ignoreTerm
    ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
    : "setInterval(() => {}, 1000);";
  return spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function processAlive(child: ChildProcess): boolean {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function listenWrongPortProbe(): Promise<{
  origin: string;
  hits: () => number;
  close: () => Promise<void>;
}> {
  let hitCount = 0;
  const probe: Server = createServer((_request, response) => {
    hitCount += 1;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("wrong runner");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Wrong-port probe did not bind.");
  return {
    origin: `http://localhost:${address.port}`,
    hits: () => hitCount,
    close: () => new Promise<void>((resolveClose) => probe.close(() => resolveClose())),
  };
}

test("temporary exclusion servers stop when assertions fail", async () => {
  for (const label of ["production", "disabled development"]) {
    let stops = 0;
    const fakeServer: SaveQaServer = {
      origin: `http://${label.replace(" ", "-")}.invalid`,
      stop: async () => { stops += 1; },
    };
    await expect(withSaveQaServer(
      async () => fakeServer,
      async () => { throw new Error(`${label} exclusion failed`); },
    )).rejects.toThrow(`${label} exclusion failed`);
    expect(stops).toBe(1);
  }
});

test("startup failures and repeated stops perform awaited bounded process-group cleanup", async () => {
  const probes: ChildProcess[] = [];
  try {
    const rejectionChild = launchLifecycleProbe(false);
    probes.push(rejectionChild);
    await expect(startSaveQaServerForTest({
      reservePort: async () => 41001,
      launch: () => rejectionChild,
      startupTimeoutMs: 30,
      stopGraceMs: 30,
      fetchReady: async () => { throw new Error("injected readiness rejection"); },
      sleep: async () => {},
    })).rejects.toThrow("Timed out waiting for the Save QA server");
    await expect.poll(() => processAlive(rejectionChild)).toBe(false);

    const stalledChild = launchLifecycleProbe(false);
    probes.push(stalledChild);
    await expect(startSaveQaServerForTest({
      reservePort: async () => 41002,
      launch: () => stalledChild,
      startupTimeoutMs: 40,
      stopGraceMs: 30,
      fetchReady: async (_origin, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    })).rejects.toThrow("Timed out waiting for the Save QA server");
    await expect.poll(() => processAlive(stalledChild)).toBe(false);

    const resistantChild = launchLifecycleProbe(true);
    probes.push(resistantChild);
    await expect(startSaveQaServerForTest({
      reservePort: async () => 41003,
      launch: () => resistantChild,
      startupTimeoutMs: 100,
      stopGraceMs: 30,
      fetchReady: async () => ({ status: 503 }),
    })).rejects.toThrow("Timed out waiting for the Save QA server");
    await expect.poll(() => processAlive(resistantChild)).toBe(false);
    expect(resistantChild.signalCode).toBe("SIGKILL");

    const liveChild = launchLifecycleProbe(false);
    probes.push(liveChild);
    const liveServer = await startSaveQaServerForTest({
      reservePort: async () => 41004,
      launch: () => liveChild,
      startupTimeoutMs: 100,
      stopGraceMs: 30,
      fetchReady: async () => ({ status: 200 }),
    });
    await Promise.all([liveServer.stop(), liveServer.stop()]);
    await expect.poll(() => processAlive(liveChild)).toBe(false);
    await teardownSaveQaProcessGroup(liveChild, 10);
  } finally {
    await Promise.all(probes.map((child) => teardownSaveQaProcessGroup(child, 10).catch(() => {})));
  }
});

test("bare route is inert, actual dashboard mounts only when armed, and normal dashboard has no QA controller", async ({ page }) => {
  const network = await openDisarmed(page);
  expect(network.intercepted.length).toBe(0);
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
  await expect.poll(() => network.intercepted.length).toBeGreaterThan(0);
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
  expect(network.intercepted.length).toBeGreaterThan(0);
  expect(network.responses.some((event) => event.includes("200 GET") && event.endsWith("/api/savings/vaults"))).toBe(true);
  expect(network.failures.some((event) => event.includes("/api/private-probe"))).toBe(true);
  expect(network.failures.some((event) => event.includes("example.com/egress-probe"))).toBe(true);
  expect(network.blockedSockets).toEqual(["wss://example.com/socket-probe"]);
  const counters = await page.evaluate(() => window.saveQa!.snapshot().counters);
  expect(counters.executions).toBe(0);
  expect(counters.checks).toBe(0);
  expect(counters.sends).toBe(0);
  expect(counters.signIns).toBe(0);
  expect(counters.signatures).toBe(0);
});

test("rejects redirect escapes, noncanonical variants, wrong methods, queries, paths, ports, and sockets without fallback", async ({ page }) => {
  const wrongPort = await listenWrongPortProbe();
  try {
    const network = await readyWeighted(page);
    const interceptedBefore = network.intercepted.length;
    const result = await page.evaluate(async ({ runnerOrigin, wrongOrigin }) => {
      const probes: Array<[string, RequestInit?]> = [
        [`${runnerOrigin}//api/savings/vaults`],
        [`${runnerOrigin}/api/savings/vaults?fixture=escape`],
        [`${runnerOrigin}/api/savings/vaults/`],
        [`${runnerOrigin}/API/savings/vaults`],
        [`${runnerOrigin}/safe/%2e%2e/api/savings/vaults`],
        [`${runnerOrigin}\\api\\savings\\vaults`],
        [`${runnerOrigin}/api/savings/vaults`, { method: "POST" }],
        [`${wrongOrigin}/api/savings/vaults`],
      ];
      const outcomes: string[] = [];
      for (const [url, init] of probes) {
        try { await fetch(url, init); outcomes.push("completed"); }
        catch { outcomes.push("blocked"); }
      }
      const socket = new WebSocket(`${wrongOrigin.replace("http://", "ws://")}/_next/hmr?id=wrong-port`);
      await new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.addEventListener("error", () => resolve(), { once: true });
      });
      outcomes.push("socket-blocked");
      let redirectOutcome = "completed";
      try { await fetch(`${runnerOrigin}/home-mark/`); }
      catch { redirectOutcome = "blocked"; }
      const font = await fetch(`${runnerOrigin}/home-mark/BaseSans-Medium.woff`);
      const fontBytes = (await font.arrayBuffer()).byteLength;
      const flag = await fetch(`${runnerOrigin}/currency-flags/us.svg`);
      const flagBody = await flag.text();
      return {
        outcomes,
        redirectOutcome,
        fontStatus: font.status,
        fontBytes,
        flagStatus: flag.status,
        flagBody,
      };
    }, { runnerOrigin: origin, wrongOrigin: wrongPort.origin });

    expect(result.outcomes).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "socket-blocked",
    ]);
    expect(result.redirectOutcome).toBe("blocked");
    expect(result.fontStatus).toBe(200);
    expect(result.fontBytes).toBeGreaterThan(0);
    expect(result.flagStatus).toBe(200);
    expect(result.flagBody).toContain("<svg");
    expect(network.intercepted.length).toBe(interceptedBefore);
    expect(wrongPort.hits()).toBe(0);
    expect(network.blockedSockets).toContain(
      `${wrongPort.origin.replace("http://", "ws://")}/_next/hmr?id=wrong-port`,
    );
    expect(network.responses.every((event) => !event.includes("?fixture=escape"))).toBe(true);
    expect(network.aborted.some((event) => event.includes("?fixture=escape"))).toBe(true);
    expect(network.aborted.some((event) => event.startsWith("POST "))).toBe(true);
    expect(network.aborted).toContain(`GET ${origin}/home-mark/`);
    expect(network.attempted).toContain(`GET ${origin}/home-mark/`);
    expect(network.attempted).not.toContain(`GET ${origin}/home-mark`);
    expect(network.responses).toContain(`200 GET ${origin}/home-mark/BaseSans-Medium.woff`);
    expect(network.responses).toContain(`200 GET ${origin}/currency-flags/us.svg`);
    expect(network.allowed.every((event) => !event.includes("/api/"))).toBe(true);
  } finally {
    await wrongPort.close();
  }
});

test("covers both cold request orders and painted shimmer", async ({ page }) => {
  const network = await openDisarmed(page);
  await arm(page, network);
  await expect.poll(() => network.intercepted.length).toBeGreaterThan(0);
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
