import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { expect, test as base, type Page } from "@playwright/test";
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
  saveQaProcessGroupAlive,
  startSaveQaServerForTest,
  teardownSaveQaProcessGroup,
  withSaveQaServer,
  type SaveQaServer,
} from "./support/save-qa-server";

const saveQaChromiumArgument =
  "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights";

function augmentSaveQaLaunchOptions<T extends { args?: string[] }>(inherited: T): T {
  return {
    ...inherited,
    args: inherited.args?.includes(saveQaChromiumArgument)
      ? [...inherited.args]
      : [...(inherited.args ?? []), saveQaChromiumArgument],
  };
}

const test = base.extend({
  launchOptions: async ({ launchOptions }, applyLaunchOptions) => {
    await applyLaunchOptions(augmentSaveQaLaunchOptions(launchOptions));
  },
});

test.setTimeout(120_000);
// Intercepted localhost documents can remain server-painted without hydrating when
// Chromium's local-network checks are active. The runner supplies a stricter exact-origin boundary.

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

type ProcessGroupProbe = {
  leader: ChildProcess;
  processGroupId: number;
  ready: Promise<{ port: number; childPid: number }>;
};

function launchProcessGroupProbe({
  exitLeaderAfterReady = false,
  startupDelayMs = 0,
}: {
  exitLeaderAfterReady?: boolean;
  startupDelayMs?: number;
} = {}): ProcessGroupProbe {
  const listenerScript = [
    "const http = require('node:http');",
    "process.on('SIGTERM', () => {});",
    "const server = http.createServer((_request, response) => { response.end('alive'); });",
    "server.listen(0, '127.0.0.1', () => {",
    "  const address = server.address();",
    "  console.log(JSON.stringify({ port: address.port, childPid: process.pid }));",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const leaderScript = [
    "const { spawn } = require('node:child_process');",
    `const listener = spawn(process.execPath, ['-e', ${JSON.stringify(listenerScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
    "listener.stdout.once('data', (chunk) => {",
    "  process.stdout.write(chunk);",
    exitLeaderAfterReady
      ? "  setTimeout(() => process.exit(0), 5);"
      : "  setInterval(() => {}, 1000);",
    "});",
  ].join("\n");
  const leader = spawn(process.execPath, ["-e", leaderScript], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!leader.pid || !leader.stdout) throw new Error("Process-group probe failed to launch.");
  const immediateReady = new Promise<{ port: number; childPid: number }>((resolveReady, rejectReady) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      leader.stdout?.off("data", onData);
      try {
        resolveReady(JSON.parse(output.slice(0, newline)) as { port: number; childPid: number });
      } catch (error) {
        rejectReady(error);
      }
    };
    leader.stdout.on("data", onData);
    leader.once("error", rejectReady);
  });
  const ready = startupDelayMs > 0
    ? immediateReady.then((value) => new Promise<typeof value>((resolveReady) => {
        setTimeout(() => resolveReady(value), startupDelayMs);
      }))
    : immediateReady;
  return { leader, processGroupId: leader.pid, ready };
}

async function listenerIsAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(250),
    });
    return response.status === 200 && await response.text() === "alive";
  } catch {
    return false;
  }
}

async function forceCleanupProbe(probe: ProcessGroupProbe): Promise<void> {
  try { process.kill(-probe.processGroupId, "SIGKILL"); } catch { /* already gone */ }
  const deadline = Date.now() + 1_000;
  while (saveQaProcessGroupAlive(probe.processGroupId) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function boundedProbePromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
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

test("inherits browser launch configuration and stops temporary exclusion servers", async ({
  browser,
  launchOptions,
}) => {
  const inheritedProbe = {
    executablePath: "/explicit/chromium",
    args: ["--existing-browser-argument"],
    chromiumSandbox: true,
  };
  expect(augmentSaveQaLaunchOptions(inheritedProbe)).toEqual({
    executablePath: "/explicit/chromium",
    args: ["--existing-browser-argument", saveQaChromiumArgument],
    chromiumSandbox: true,
  });
  expect(launchOptions.args).toContain(saveQaChromiumArgument);
  const explicitExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicitExecutable) expect(launchOptions.executablePath).toBe(explicitExecutable);
  console.log("SAVE_QA_BROWSER_IDENTITY", JSON.stringify({
    version: browser.version(),
    executablePath: launchOptions.executablePath ?? "playwright-default",
    args: launchOptions.args ?? [],
  }));

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

test("startup failures and stops await whole process-group and listener disappearance", async () => {
  const probes: ProcessGroupProbe[] = [];
  try {
    const rejectionProbe = launchProcessGroupProbe();
    probes.push(rejectionProbe);
    const rejectionReady = rejectionProbe.ready;
    await expect(startSaveQaServerForTest({
      reservePort: async () => 41001,
      launch: () => rejectionProbe.leader,
      startupTimeoutMs: 100,
      stopGraceMs: 40,
      fetchReady: async () => {
        await rejectionReady;
        throw new Error("injected readiness rejection");
      },
      sleep: async () => {},
    })).rejects.toThrow("Timed out waiting for the Save QA server");
    const rejectionListener = await rejectionReady;
    expect(saveQaProcessGroupAlive(rejectionProbe.processGroupId)).toBe(false);
    expect(await listenerIsAlive(rejectionListener.port)).toBe(false);

    const stalledProbe = launchProcessGroupProbe({ startupDelayMs: 150 });
    probes.push(stalledProbe);
    const stalledReady = stalledProbe.ready;
    const stalledStartedAt = Date.now();
    await expect(boundedProbePromise(startSaveQaServerForTest({
      reservePort: async () => 41002,
      launch: () => stalledProbe.leader,
      startupTimeoutMs: 100,
      stopGraceMs: 200,
      fetchReady: async (_origin, { signal }) => {
        const aborted = new Promise<never>((_resolve, reject) => {
          const rejectWithReason = () => reject(signal.reason);
          if (signal.aborted) rejectWithReason();
          else signal.addEventListener("abort", rejectWithReason, { once: true });
        });
        await Promise.race([stalledReady, aborted]);
        signal.throwIfAborted();
        return aborted;
      },
    }), 1_000, "Delayed readiness did not settle within the regression bound."))
      .rejects.toThrow("Timed out waiting for the Save QA server");
    const stalledElapsedMs = Date.now() - stalledStartedAt;
    expect(stalledElapsedMs).toBeGreaterThanOrEqual(100);
    expect(stalledElapsedMs).toBeLessThan(1_000);
    const stalledListener = await boundedProbePromise(
      stalledReady,
      800,
      "Delayed listener never reached readiness before forced group cleanup.",
    );
    expect(saveQaProcessGroupAlive(stalledProbe.processGroupId)).toBe(false);
    expect(await listenerIsAlive(stalledListener.port)).toBe(false);

    const liveProbe = launchProcessGroupProbe();
    probes.push(liveProbe);
    const liveReady = liveProbe.ready;
    const liveServer = await startSaveQaServerForTest({
      reservePort: async () => 41003,
      launch: () => liveProbe.leader,
      startupTimeoutMs: 200,
      stopGraceMs: 40,
      fetchReady: async () => {
        await liveReady;
        return { status: 200 };
      },
    });
    const liveListener = await liveReady;
    expect(saveQaProcessGroupAlive(liveProbe.processGroupId)).toBe(true);
    expect(await listenerIsAlive(liveListener.port)).toBe(true);
    await Promise.all([liveServer.stop(), liveServer.stop()]);
    expect(saveQaProcessGroupAlive(liveProbe.processGroupId)).toBe(false);
    expect(await listenerIsAlive(liveListener.port)).toBe(false);

    const exitedLeaderProbe = launchProcessGroupProbe({ exitLeaderAfterReady: true });
    probes.push(exitedLeaderProbe);
    const exitedListener = await exitedLeaderProbe.ready;
    await new Promise<void>((resolveExit) => {
      if (exitedLeaderProbe.leader.exitCode !== null) resolveExit();
      else exitedLeaderProbe.leader.once("exit", () => resolveExit());
    });
    expect(exitedLeaderProbe.leader.exitCode).toBe(0);
    expect(saveQaProcessGroupAlive(exitedLeaderProbe.processGroupId)).toBe(true);
    expect(await listenerIsAlive(exitedListener.port)).toBe(true);
    await Promise.all([
      teardownSaveQaProcessGroup(exitedLeaderProbe.leader, 40),
      teardownSaveQaProcessGroup(exitedLeaderProbe.leader, 40),
    ]);
    expect(saveQaProcessGroupAlive(exitedLeaderProbe.processGroupId)).toBe(false);
    expect(await listenerIsAlive(exitedListener.port)).toBe(false);
  } finally {
    await Promise.all(probes.map((probe) => forceCleanupProbe(probe)));
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

test("keeps enlarged long labels, exact large values and all Save controls within 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const network = await openDisarmed(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  await arm(page, network, { vaultVariant: "long" });
  await resolvePosition(page, "large");

  const save = page.locator("#save-panel");
  const hero = save.getByText("$1,111,111,110.11111", { exact: true });
  const apy = save.getByText("Earning ~4.22%", { exact: true });
  const firstName = save.getByText(
    "Institutional USDC Income Strategy With An Intentionally Long Curator Label",
    { exact: true },
  );
  const secondName = save.getByText(
    "Institutional USDC Income Strategy With An Intentionally Long Curator Label Prime",
    { exact: true },
  );
  const firstBalance = save.getByText("$123,456,789.012345", { exact: true });
  const secondBalance = save.getByText("$987,654,321.098765", { exact: true });
  const radios = save.getByRole("radio");
  const deposit = save.getByRole("button", { name: "Deposit" });
  const withdraw = save.getByRole("button", { name: "Withdraw" });
  const details = save.getByText("Details", { exact: true });
  const critical = [
    hero,
    apy,
    firstName,
    secondName,
    firstBalance,
    secondBalance,
    radios.nth(0),
    radios.nth(1),
    deposit,
    withdraw,
    details,
  ];

  await expect(radios).toHaveCount(2);
  for (const locator of critical) await expect(locator).toBeVisible();
  await expect(hero).toHaveText("$1,111,111,110.11111");
  await expect(apy).toHaveText("Earning ~4.22%");
  await expect(radios.nth(0)).toContainText("$123,456,789.012345");
  await expect(radios.nth(1)).toContainText("$987,654,321.098765");
  await expect(deposit).toBeEnabled();
  await expect(withdraw).toBeEnabled();

  const documentWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(documentWidth).toEqual({ client: 320, scroll: 320, viewport: 320 });

  for (const locator of critical) {
    const geometry = await locator.evaluate((element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        text: (node.innerText || node.textContent || "").trim(),
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.text.length).toBeGreaterThan(0);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  }

  for (const target of [radios.nth(0), radios.nth(1), deposit, withdraw, details]) {
    const box = await target.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const financialIntegrity = await save.evaluate((root) => {
    const findText = (selector: string, text: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector))
        .find((element) => element.textContent === text);
    const hero = findText("p", "$1,111,111,110.11111");
    const names = [
      findText("strong", "Institutional USDC Income Strategy With An Intentionally Long Curator Label"),
      findText("strong", "Institutional USDC Income Strategy With An Intentionally Long Curator Label Prime"),
    ];
    const balances = [
      findText("span", "$123,456,789.012345"),
      findText("span", "$987,654,321.098765"),
    ];
    if (!hero || names.some((name) => !name) || balances.some((balance) => !balance)) {
      throw new Error("Expected complete financial text fixture.");
    }

    const lastCharacterRect = (element: HTMLElement) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.length) textNode = node as Text;
      }
      if (!textNode?.textContent) throw new Error("Financial text has no terminal character.");
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent.length - 1);
      range.setEnd(textNode, textNode.textContent.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const inspect = (element: HTMLElement, fontFloor: number, requireTwoLines = false) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const last = lastCharacterRect(element);
      return {
        verticallyContained: element.scrollHeight <= element.clientHeight,
        overflowVisible: ![style.overflowX, style.overflowY]
          .some((value) => value === "hidden" || value === "clip"),
        lastCharacterInside:
          last.left >= rect.left &&
          last.right <= rect.right &&
          last.top >= rect.top &&
          last.bottom <= rect.bottom,
        readableFont: Number.parseFloat(style.fontSize) >= fontFloor,
        renderedWrap: !requireTwoLines || rect.height >= lineHeight * 1.9,
        metrics: {
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height },
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          lineHeight,
          fontSize: Number.parseFloat(style.fontSize),
          last,
        },
      };
    };
    const passes = () => {
      const heroResult = inspect(hero, 48, true);
      const nameResults = names.map((name) => inspect(name!, 18));
      const balanceResults = balances.map((balance) => inspect(balance!, 19));
      return {
        hero: heroResult,
        names: nameResults,
        balances: balanceResults,
        passed: [heroResult, ...nameResults, ...balanceResults]
          .every((result) => Object.values(result).every(Boolean)),
      };
    };
    const preserveStyle = (element: HTMLElement, mutate: () => void) => {
      const original = element.getAttribute("style");
      mutate();
      const result = passes().passed;
      if (original === null) element.removeAttribute("style");
      else element.setAttribute("style", original);
      return result;
    };

    const baseline = passes();
    const heroLineHeight = Number.parseFloat(getComputedStyle(hero).lineHeight);
    const clippedHeroAccepted = preserveStyle(hero, () => {
      hero.style.height = `${heroLineHeight}px`;
      hero.style.overflow = "hidden";
    });
    const firstName = names[0]!;
    const nameLineHeight = Number.parseFloat(getComputedStyle(firstName).lineHeight);
    const clippedNameAccepted = preserveStyle(firstName, () => {
      firstName.style.height = `${nameLineHeight}px`;
      firstName.style.overflow = "hidden";
    });
    const tinyTextAccepted = (() => {
      const elements = [...names, ...balances] as HTMLElement[];
      const originals = elements.map((element) => element.getAttribute("style"));
      elements.forEach((element) => { element.style.fontSize = "1px"; });
      const result = passes().passed;
      elements.forEach((element, index) => {
        const original = originals[index];
        if (original === null) element.removeAttribute("style");
        else element.setAttribute("style", original);
      });
      return result;
    })();
    return { baseline, clippedHeroAccepted, clippedNameAccepted, tinyTextAccepted };
  });
  expect(financialIntegrity.baseline.passed, JSON.stringify(financialIntegrity.baseline)).toBe(true);
  expect(financialIntegrity.baseline.hero).toMatchObject({
    verticallyContained: true,
    overflowVisible: true,
    lastCharacterInside: true,
    readableFont: true,
    renderedWrap: true,
  });
  expect(financialIntegrity.baseline.hero.metrics.fontSize).toBeGreaterThanOrEqual(48);
  expect(financialIntegrity.baseline.hero.metrics.rect.height).toBeGreaterThanOrEqual(
    financialIntegrity.baseline.hero.metrics.lineHeight * 1.9,
  );
  expect(financialIntegrity.baseline.hero.metrics.scrollHeight).toBeLessThanOrEqual(
    financialIntegrity.baseline.hero.metrics.clientHeight,
  );
  for (const result of financialIntegrity.baseline.names) {
    expect(result.verticallyContained).toBe(true);
    expect(result.overflowVisible).toBe(true);
    expect(result.lastCharacterInside).toBe(true);
    expect(result.readableFont).toBe(true);
    expect(result.metrics.fontSize).toBeGreaterThanOrEqual(18);
    expect(result.metrics.last.bottom).toBeLessThanOrEqual(result.metrics.rect.bottom);
  }
  for (const result of financialIntegrity.baseline.balances) {
    expect(result.verticallyContained).toBe(true);
    expect(result.overflowVisible).toBe(true);
    expect(result.lastCharacterInside).toBe(true);
    expect(result.readableFont).toBe(true);
    expect(result.metrics.fontSize).toBeGreaterThanOrEqual(19);
    expect(result.metrics.last.bottom).toBeLessThanOrEqual(result.metrics.rect.bottom);
  }
  expect(financialIntegrity.clippedHeroAccepted).toBe(false);
  expect(financialIntegrity.clippedNameAccepted).toBe(false);
  expect(financialIntegrity.tinyTextAccepted).toBe(false);

  const responsiveLayout = await save.evaluate((root) => {
    const hero = Array.from(root.querySelectorAll<HTMLElement>("p"))
      .find((element) => element.textContent?.includes("$1,111,111,110.11111"));
    const radio = root.querySelector<HTMLElement>("[role='radio']");
    const actionButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.textContent === "Deposit" || button.textContent === "Withdraw");
    const balance = Array.from(root.querySelectorAll<HTMLElement>("span"))
      .find((element) => element.textContent === "$123,456,789.012345");
    const name = Array.from(root.querySelectorAll<HTMLElement>("strong"))
      .find((element) => element.textContent?.includes("Intentionally Long Curator Label"));
    if (!hero || !radio || actionButtons.length !== 2 || !balance || !name) {
      throw new Error("Expected complete responsive Save fixture geometry.");
    }
    const heroStyle = getComputedStyle(hero);
    const heroLineHeight = Number.parseFloat(heroStyle.lineHeight);
    const depositRect = actionButtons[0].getBoundingClientRect();
    const withdrawRect = actionButtons[1].getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    const balanceRect = balance.getBoundingClientRect();
    return {
      heroWraps: hero.scrollHeight > heroLineHeight * 1.5,
      singleVaultColumn: getComputedStyle(radio).gridTemplateColumns.split(" ").length === 1,
      balanceBelowName: balanceRect.top >= nameRect.bottom - 1,
      actionsStacked: withdrawRect.top >= depositRect.bottom,
    };
  });
  expect(responsiveLayout).toEqual({
    heroWraps: true,
    singleVaultColumn: true,
    balanceBelowName: true,
    actionsStacked: true,
  });
});
