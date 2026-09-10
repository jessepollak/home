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
  bundleDirectory = mkdtempSync(join(tmpdir(), "home-shell-"));
  execFileSync(
    "bun",
    [
      "build",
      "tests/browser/support/home-shell-harness.tsx",
      "--target=browser",
      `--outdir=${bundleDirectory}`,
      "--naming=[name].[ext]",
    ],
    { cwd: resolve(__dirname, "../.."), stdio: "pipe" },
  );

  const script = readFileSync(join(bundleDirectory, "home-shell-harness.js"));
  const styles = readFileSync(join(bundleDirectory, "home-shell-harness.css"));

  server = createServer((request, response) => {
    if (request.url === "/home-shell-harness.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (request.url === "/home-shell-harness.css") {
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
    <link rel="stylesheet" href="/home-shell-harness.css">
    <title>Home shell browser harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/home-shell-harness.js"></script>
  </body>
</html>`);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Ephemeral Home shell harness did not bind a TCP port."));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolveListen();
    });
  });
}

async function expectChromeAllocated(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  const allocation = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".app-frame-shell")!;
    const header = document.querySelector<HTMLElement>(".app-header")!;
    const main = document.querySelector<HTMLElement>(".app-main-authenticated")!;
    const footer = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
    const visibleScrollSurfaces = [shell, header, main, footer].filter((element) => {
      const overflowY = getComputedStyle(element).overflowY;
      return overflowY === "auto" || overflowY === "scroll";
    });
    return {
      viewportHeight: window.innerHeight,
      shellHeight: shell.getBoundingClientRect().height,
      footerBottom: footer.getBoundingClientRect().bottom,
      mainBottom: main.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      scrollSurfaceClasses: visibleScrollSurfaces.map((element) => element.className),
    };
  });

  expect(Math.abs(allocation.shellHeight - allocation.viewportHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(allocation.footerBottom - allocation.viewportHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(allocation.mainBottom - allocation.footerTop)).toBeLessThanOrEqual(1);
  expect(allocation.scrollSurfaceClasses).toEqual(["app-main app-main-authenticated"]);
}

async function openActivityAndReachLastRow(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Activity" }).click();
  const lastRow = page.getByText("Activity item 18", { exact: true }).locator("xpath=ancestor::li");
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeVisible();

  const clearance = await page.evaluate(() => {
    const last = document
      .evaluate(
        '//*[normalize-space(text())="Activity item 18"]/ancestor::li',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
      )
      .singleNodeValue as HTMLElement;
    const footer = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
    const main = document.querySelector<HTMLElement>(".app-main-authenticated")!;
    return {
      pixels: Math.round(footer.getBoundingClientRect().top - last.getBoundingClientRect().bottom),
      atEnd: Math.abs(main.scrollTop - (main.scrollHeight - main.clientHeight)) <= 1,
    };
  });

  expect(clearance.atEnd).toBe(true);
  expect(clearance.pixels).toBeGreaterThanOrEqual(15);
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

test("keeps mobile navigation allocated and the final Activity row clear through viewport changes", async ({
  page,
}) => {
  await expectChromeAllocated(page);
  await openActivityAndReachLastRow(page);

  await page.setViewportSize({ width: 390, height: 664 });
  await expectChromeAllocated(page);
  await openActivityAndReachLastRowAfterResize(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectChromeAllocated(page);
  await openActivityAndReachLastRowAfterResize(page);
  await page.screenshot({ path: "/tmp/home-issue-193-390.png" });
});

test("restores shell scrolling after MoneyModal close, back navigation, and account boundary", async ({
  page,
}) => {
  const bodyOverflowBefore = await page.evaluate(() => ({
    inline: document.body.style.overflow,
    computed: getComputedStyle(document.body).overflow,
  }));
  expect(bodyOverflowBefore).toEqual({ inline: "", computed: "hidden" });

  await page.getByRole("button", { name: "Open money modal" }).click();
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.getByRole("button", { name: "Close money modal" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => ({
    inline: document.body.style.overflow,
    computed: getComputedStyle(document.body).overflow,
  }))).toEqual({ inline: "", computed: "hidden" });

  await openActivityAndReachLastRow(page);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(await page.getByTestId("shell-scroll").evaluate((main) => main.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Open money modal" }).click();
  await page.evaluate(() => window.shellHarness.closeForAccountBoundary());
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => ({
    inline: document.body.style.overflow,
    computed: getComputedStyle(document.body).overflow,
  }))).toEqual({ inline: "", computed: "hidden" });

  await page.getByRole("button", { name: "Done" }).click();
  await openActivityAndReachLastRow(page);
});

async function openActivityAndReachLastRowAfterResize(page: Page): Promise<void> {
  const lastRow = page.getByText("Activity item 18", { exact: true }).locator("xpath=ancestor::li");
  await lastRow.scrollIntoViewIfNeeded();
  const footerTop = await page
    .getByRole("navigation", { name: "Main navigation" })
    .evaluate((footer) => footer.getBoundingClientRect().top);
  const lastBottom = await lastRow.evaluate((row) => row.getBoundingClientRect().bottom);
  expect(Math.round(footerTop - lastBottom)).toBeGreaterThanOrEqual(15);
}
