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
  bundleDirectory = mkdtempSync(join(tmpdir(), "home-money-modal-motion-"));
  execFileSync(
    "bun",
    [
      "build",
      "tests/browser/support/money-modal-motion-harness.tsx",
      "--target=browser",
      `--outdir=${bundleDirectory}`,
      "--naming=[name].[ext]",
    ],
    { cwd: resolve(__dirname, "../.."), stdio: "pipe" },
  );

  const script = readFileSync(join(bundleDirectory, "money-modal-motion-harness.js"));
  const styles = readFileSync(join(bundleDirectory, "money-modal-motion-harness.css"));

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/money-modal-motion-harness.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (requestUrl.pathname === "/money-modal-motion-harness.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end(styles);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root {
        --home-white: #fff;
        --home-ink: #0a0b0d;
        --home-muted: #5b616e;
        --home-hairline: #d9dde5;
        --home-blue: #0052ff;
        --control-radius: 8px;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body { overflow: auto; }
    </style>
    <link rel="stylesheet" href="/money-modal-motion-harness.css">
    <title>MoneyModal consumer motion harness</title>
  </head>
  <body style="overflow: auto">
    <div id="root"></div>
    <script>globalThis.process = { env: {} };</script>
    <script type="module" src="/money-modal-motion-harness.js"></script>
  </body>
</html>`);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Ephemeral MoneyModal harness did not bind a TCP port."));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolveListen();
    });
  });
}

async function openHarness(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Receive" })).toBeVisible();
}

async function dragSheet(page: Page, distance: number, holdMs = 0): Promise<void> {
  const grabber = page.locator("dialog[open] [data-money-sheet-grabber]");
  const box = await grabber.boundingBox();
  if (!box) throw new Error("MoneyModal grabber is not measurable.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance);
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

async function openSendWithAmount(page: Page, digits: string): Promise<void> {
  await page.getByRole("button", { name: "Send" }).click();
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function openTradeWithAmount(page: Page, digits: string): Promise<void> {
  await page.getByRole("button", { name: "Buy" }).click();
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(page.locator("[data-primary-amount]")).toHaveText(`$${digits}`);
}

test.beforeAll(async () => {
  await listenEphemeral();
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(bundleDirectory, { recursive: true, force: true });
});

test("actual Send retains its composed presentation and becomes inert during exit", async ({ page }, testInfo) => {
  await openHarness(page);
  await openSendWithAmount(page, "13");
  await page.waitForTimeout(320);

  const sheet = page.locator("dialog:has(#send-title) [data-money-sheet]");
  const before = await sheet.boundingBox();
  await page.getByRole("button", { name: "Close send dialog" }).click();
  const during = await sheet.boundingBox();

  await expect(page.locator("[data-primary-amount]")).toHaveText("$13");
  await expect(page.locator('dialog[data-state="closing"] [data-money-sheet]')).toHaveAttribute("inert", "");
  expect(Math.abs((during?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("DIALOG");

  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeFocused();

  await testInfo.attach("actual-send-exit", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("actual Trade keeps $13 through ordinary same-owner exit", async ({ page }) => {
  await openHarness(page);
  await openTradeWithAmount(page, "13");
  await page.waitForTimeout(320);

  await page.getByRole("button", { name: "Close trade" }).click();

  await expect(page.locator("[data-primary-amount]")).toHaveText("$13");
  await expect(page.locator('dialog[data-state="closing"] [data-money-sheet]')).toHaveAttribute("inert", "");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Trade drops the previous owner's $13 immediately on account change", async ({ page }) => {
  await openHarness(page);
  await openTradeWithAmount(page, "13");

  await page.evaluate(() => window.moneyModalHarness.setOwner("b"));

  await expect(page.locator("[data-primary-amount]")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Trade drops the previous owner's $13 immediately on sign-out", async ({ page }) => {
  await openHarness(page);
  await openTradeWithAmount(page, "13");

  await page.evaluate(() => window.moneyModalHarness.setOwner("none"));

  await expect(page.locator("[data-primary-amount]")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Trade interrupts ordinary exit when the account boundary changes", async ({ page }) => {
  await openHarness(page);
  await openTradeWithAmount(page, "13");
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Close trade" }).click();
  await expect(page.locator("[data-primary-amount]")).toHaveText("$13");
  await expect(page.locator('dialog[data-state="closing"]')).toHaveAttribute("open", "");

  await page.evaluate(() => window.moneyModalHarness.setOwner("b"));

  await expect(page.locator("[data-primary-amount]")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Receive keeps the verified address through normal exit", async ({ page }) => {
  await openHarness(page);
  const address = await page.evaluate(() => window.moneyModalHarness.addressA);
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.locator(`[title="${address}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Close receive dialog" }).click();
  await expect(page.locator(`[title="${address}"]`)).toBeAttached();
  await expect(page.locator('dialog[data-state="closing"] [data-money-sheet]')).toHaveAttribute("inert", "");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Send uses distance threshold and ages stationary flick velocity", async ({ page }) => {
  await openHarness(page);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(320);

  await dragSheet(page, 32, 140);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.waitForTimeout(320);

  await dragSheet(page, 71, 140);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.waitForTimeout(320);

  await dragSheet(page, 73, 140);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("actual Receive honors reduced motion for immediate geometry and close", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHarness(page);
  await page.getByRole("button", { name: "Receive" }).click();

  const sheetStyle = await page.locator("dialog[open] [data-money-sheet]").evaluate((sheet) => ({
    height: (sheet as HTMLElement).style.height,
    transition: (sheet as HTMLElement).style.transition,
  }));
  expect(sheetStyle.height).toBe("");
  expect(sheetStyle.transition).toBe("none");

  const backdropStyle = await page.locator("dialog[open]").evaluate((dialog) => {
    const channels = getComputedStyle(dialog).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return {
      alpha: channels.length > 3 ? channels[3] : 1,
      transitionDuration: getComputedStyle(dialog).transitionDuration,
    };
  });
  expect(backdropStyle.alpha).toBeCloseTo(0.42, 2);
  expect(backdropStyle.transitionDuration).toBe("0s");

  await page.getByRole("button", { name: "Close receive dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("closing owner boundary drops old Receive content immediately", async ({ page }) => {
  await openHarness(page);
  const address = await page.evaluate(() => window.moneyModalHarness.addressA);
  await page.getByRole("button", { name: "Receive" }).click();
  await page.getByRole("button", { name: "Close receive dialog" }).click();
  await expect(page.locator(`[title="${address}"]`)).toBeAttached();

  await page.evaluate(() => window.moneyModalHarness.setOwner("b"));
  await expect(page.locator(`[title="${address}"]`)).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("reopening during active exit preserves the rendered sheet geometry", async ({ page }) => {
  await openHarness(page);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(320);

  const sheet = page.locator("dialog[open] [data-money-sheet]");
  const openRect = await sheet.boundingBox();
  if (!openRect) throw new Error("Open Send sheet is not measurable.");
  await page.getByRole("button", { name: "Close send dialog" }).click();
  await expect.poll(async () => {
    const rect = await sheet.boundingBox();
    return (rect?.y ?? 0) - openRect.y;
  }).toBeGreaterThan(16);

  const continuity = await sheet.evaluate((element) => {
    const dialog = element.closest("dialog");
    if (!dialog) throw new Error("MoneyModal sheet has no dialog root.");
    const rect = (node: Element) => {
      const { y, height, bottom } = node.getBoundingClientRect();
      return { y, height, bottom };
    };
    const backdropAlpha = () => {
      const channels = getComputedStyle(dialog).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      return channels.length > 3 ? channels[3] : 1;
    };
    const before = rect(element);
    const alphaSamples = [backdropAlpha()];
    return new Promise<{
      before: ReturnType<typeof rect>;
      after: ReturnType<typeof rect>;
      alphaSamples: number[];
      dialogState: string | null;
      sameDialog: boolean;
      sheetState: string | null;
    }>((resolve) => {
      const observer = new MutationObserver(() => {
        if (element.getAttribute("data-state") !== "open") return;
        observer.disconnect();
        const after = rect(element);
        const sampleReopen = () => {
          alphaSamples.push(backdropAlpha());
          if (alphaSamples.length < 8) {
            requestAnimationFrame(sampleReopen);
            return;
          }
          resolve({
            before,
            after,
            alphaSamples,
            dialogState: dialog.getAttribute("data-state"),
            sameDialog: document.querySelector("dialog[open]") === dialog,
            sheetState: element.getAttribute("data-state"),
          });
        };
        sampleReopen();
      });
      observer.observe(element, { attributes: true, attributeFilter: ["data-state"] });
      window.moneyModalHarness.openSend();
    });
  });

  expect(continuity.dialogState).toBe("open");
  expect(continuity.sheetState).toBe("open");
  expect(continuity.sameDialog).toBe(true);
  expect(continuity.alphaSamples[0]).toBeLessThan(0.4);
  expect(Math.min(...continuity.alphaSamples)).toBeGreaterThan(0.2);
  expect(Math.abs(continuity.after.y - continuity.before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(continuity.after.height - continuity.before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(continuity.after.bottom - continuity.before.bottom)).toBeLessThanOrEqual(1);
  await expect(page.locator("dialog[open] [data-money-sheet]")).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Close send dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("owned overflow lock survives reopen and stale close timer cancellation", async ({ page }) => {
  await openHarness(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");
  await openSendWithAmount(page, "7");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.getByRole("button", { name: "Close send dialog" }).click();
  await page.waitForTimeout(60);
  await page.evaluate(() => window.moneyModalHarness.openSend());
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator("[data-primary-amount]")).toHaveText("$0");
  await page.waitForTimeout(240);
  await expect(page.locator("dialog[open]")).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.getByRole("button", { name: "Close send dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");
});

test("actual keyed FundingExperience remount restores its body lock after close", async ({ page }) => {
  await openHarness(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");

  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.evaluate(() => window.moneyModalHarness.setOwner("b"));
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");
});

test("pointer-down interrupts enter without a geometry snap", async ({ page }) => {
  await openHarness(page);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(60);

  const sheet = page.locator("dialog[open] [data-money-sheet]");
  const interrupted = await sheet.evaluate((element) => {
    const grabber = element.querySelector<HTMLElement>("[data-money-sheet-grabber]");
    if (!grabber) throw new Error("Entering Send grabber is not measurable.");
    grabber.setPointerCapture = () => {};
    grabber.releasePointerCapture = () => {};
    grabber.hasPointerCapture = () => false;

    const sheetRect = element.getBoundingClientRect();
    const grabberRect = grabber.getBoundingClientRect();
    const pointer = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: grabberRect.x + grabberRect.width / 2,
      clientY: grabberRect.y + grabberRect.height / 2,
    };
    grabber.dispatchEvent(new PointerEvent("pointerdown", pointer));
    const rect = element.getBoundingClientRect();
    return {
      before: { y: sheetRect.y, height: sheetRect.height },
      dragging: element.getAttribute("data-dragging"),
      rect: { y: rect.y, height: rect.height },
    };
  });

  expect(interrupted.dragging).toBe("true");
  expect(Math.abs(interrupted.rect.y - interrupted.before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(interrupted.rect.height - interrupted.before.height)).toBeLessThanOrEqual(1);
  await sheet.evaluate((element) => {
    const grabber = element.querySelector<HTMLElement>("[data-money-sheet-grabber]");
    grabber?.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  });

  await expect.poll(async () => {
    const rect = await sheet.boundingBox();
    return Math.round((rect?.y ?? 0) + (rect?.height ?? 0));
  }).toBe(844);
});

test("pending Send prepare rejects drag dismissal and returns on-screen", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.moneyModalHarness.setPendingPrepare(true));
  await openSendWithAmount(page, "1");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).click();
  const recipient = await page.evaluate(() => window.moneyModalHarness.recipient);
  await page.getByLabel("To").fill(recipient);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Preparing your send…")).toBeVisible();

  await dragSheet(page, 90, 140);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect.poll(async () => {
    const rect = await page.locator("dialog[open] [data-money-sheet]").boundingBox();
    return Math.round((rect?.y ?? 0) + (rect?.height ?? 0));
  }).toBe(844);
  await expect(page.getByText("Preparing your send…")).toBeVisible();
});
