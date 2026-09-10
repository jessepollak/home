import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

let server: Server;
let origin: string;
let bundleDirectory: string;

async function listenEphemeral(): Promise<void> {
  bundleDirectory = mkdtempSync(join(tmpdir(), "activity-pagination-"));
  execFileSync(
    "bun",
    [
      "build",
      "tests/browser/support/activity-pagination-harness.tsx",
      "--target=browser",
      `--outdir=${bundleDirectory}`,
      "--naming=[name].[ext]",
    ],
    { cwd: resolve(__dirname, "../.."), stdio: "pipe" },
  );

  const script = readFileSync(join(bundleDirectory, "activity-pagination-harness.js"));
  const styles = readFileSync(join(bundleDirectory, "activity-pagination-harness.css"));

  server = createServer((request, response) => {
    if (request.url === "/activity-pagination-harness.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (request.url === "/activity-pagination-harness.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end(styles);
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <link rel="stylesheet" href="/activity-pagination-harness.css">
    <title>Activity pagination browser harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/activity-pagination-harness.js"></script>
  </body>
</html>`);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Activity pagination harness did not bind a TCP port."));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolveListen();
    });
  });
}

async function requestRecords(page: Page) {
  return page.evaluate(() => window.activityHarness.requests());
}

async function scrollToActivitySentinel(page: Page) {
  await page.locator("[data-activity-sentinel]").scrollIntoViewIfNeeded();
}

async function expectOnlyAuthenticatedMainScrolls(page: Page) {
  const scrollSurfaces = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated")!;
    const descendants = Array.from(main.querySelectorAll<HTMLElement>("*"));
    return [main, ...descendants]
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowY;
        return overflow === "auto" || overflow === "scroll";
      })
      .map((element) => element.className);
  });
  expect(scrollSurfaces).toEqual(["app-main app-main-authenticated"]);
}

test.beforeAll(async () => {
  await listenEphemeral();
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(bundleDirectory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
});

test("proves five-row Home teaser and automatic Activity error, retry, end, back, and modal lifecycle", async ({
  page,
}) => {
  const activityLinks = page.getByRole("link", { name: /transfer on BaseScan/ });
  await expect(activityLinks).toHaveCount(5);
  await page.waitForTimeout(600);
  expect(await requestRecords(page)).toHaveLength(1);
  await expect(page.locator("[data-activity-sentinel]")).toHaveCount(0);
  await expectOnlyAuthenticatedMainScrolls(page);

  await page.getByRole("button", { name: "Open money modal" }).click();
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.getByRole("button", { name: "Close money modal" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(activityLinks).toHaveCount(12);
  await expectOnlyAuthenticatedMainScrolls(page);

  await scrollToActivitySentinel(page);
  await expect(page.getByText("Loading more activity…")).toBeVisible();
  await expect(page.getByText("More activity could not be loaded. Your current results are unchanged.")).toBeVisible();
  await expect(activityLinks).toHaveCount(12);
  await page.waitForTimeout(600);
  expect((await requestRecords(page)).filter((request) => request.cursor === "page-2")).toHaveLength(1);

  await page.getByRole("button", { name: "Retry more activity" }).click();
  await expect(page.getByText("Loading more activity…")).toBeVisible();
  await expect(activityLinks).toHaveCount(24);
  await scrollToActivitySentinel(page);
  await expect(page.getByText("Loading more activity…")).toBeVisible();
  await expect(page.getByText("End of activity")).toBeVisible();
  await expect(activityLinks).toHaveCount(28);
  await page.getByText("End of activity").scrollIntoViewIfNeeded();

  const detailRequests = (await requestRecords(page)).slice(1);
  expect(detailRequests.map((request) => request.cursor)).toEqual([
    null,
    "page-2",
    "page-2",
    "page-3",
  ]);
  expect(new Set(detailRequests.map((request) => request.to)).size).toBe(1);

  await page.screenshot({ path: "/tmp/home-issue-196-activity-390.png", fullPage: false });
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(await page.getByTestId("activity-scroll-root").evaluate((main) => main.scrollTop)).toBe(0);
  await expect(activityLinks).toHaveCount(5);
});

test("fences an in-flight later page across an account switch on the shared scroll root", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(page.locator('[data-owner="a"]')).toBeVisible();
  await scrollToActivitySentinel(page);
  await expect(page.getByText("Loading more activity…")).toBeVisible();

  await page.evaluate(() => window.activityHarness.switchAccount());
  await expect(page.locator('[data-owner="b"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /transfer on BaseScan/ })).toHaveCount(12);
  await page.waitForTimeout(550);
  await expect(page.getByText("Synthetic later-page outage")).toHaveCount(0);
  await expect(page.getByText("More activity could not be loaded. Your current results are unchanged.")).toHaveCount(0);

  const records = await requestRecords(page);
  const abandoned = records.find(
    (request) => request.owner === "a" && request.cursor === "page-2",
  );
  expect(abandoned?.aborted).toBe(true);
  expect(records.some((request) => request.owner === "b" && request.cursor === null)).toBe(true);
  await expectOnlyAuthenticatedMainScrolls(page);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
});
