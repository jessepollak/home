import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ADDRESS = "0x1111111111111111111111111111111111111111";
let server: Server;
let origin: string;
let bundleDirectory: string;

async function listenEphemeral(): Promise<void> {
  bundleDirectory = mkdtempSync(join(tmpdir(), "home-production-auth-"));
  execFileSync(
    "bun",
    [
      "build",
      "tests/browser/support/production-auth-harness.tsx",
      "--target=browser",
      `--outdir=${bundleDirectory}`,
      "--naming=[name].[ext]",
    ],
    { cwd: resolve(__dirname, "../.."), stdio: "pipe" },
  );

  const script = readFileSync(
    join(bundleDirectory, "production-auth-harness.js"),
  );
  const styles = readFileSync(
    join(bundleDirectory, "production-auth-harness.css"),
  );

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/production-auth-harness.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (requestUrl.pathname === "/production-auth-harness.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end(styles);
      return;
    }
    if (requestUrl.pathname === "/api/session") {
      if (requestUrl.searchParams.get("scenario") === "base-503") {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "fixture_unavailable" } }));
        return;
      }
      const accountProvider =
        request.headers["x-home-account-provider"] === "base-account"
          ? "base-account"
          : "cdp-embedded";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          user: { subject: "fixture-subject" },
          smartAccount: { address: FIXTURE_ADDRESS, chainId: 8453 },
          accountProvider,
        }),
      );
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/production-auth-harness.css">
    <title>Production auth browser harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/production-auth-harness.js"></script>
  </body>
</html>`);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Ephemeral auth harness did not bind a TCP port."));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolveListen();
    });
  });
}

async function openScenario(page: Page, scenario: string): Promise<void> {
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect(page.getByRole("button", { name: "Open account" })).toBeVisible();
  await expect(page.getByTestId("session-status")).toHaveText("signed-out");
}

async function openEmailOtp(page: Page, email: string): Promise<void> {
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Email address").press("Enter");
  await expect(page.getByLabel("Verification code")).toBeVisible();
}

async function waitForHarnessEvent(page: Page, event: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (expected) =>
          (window as Window & { authHarness: { events: string[] } }).authHarness.events.includes(
            expected,
          ),
        event,
      ),
    )
    .toBe(true);
}

async function waitForLateOwnerDisposition(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (
          window as Window & { authHarness: { events: string[] } }
        ).authHarness.events;
        return events.includes("sdk:sign-out") || events.includes("session:request");
      }),
    )
    .toBe(true);
}

test.beforeAll(async () => {
  await listenEphemeral();
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(bundleDirectory, { recursive: true, force: true });
});

test("keyboard email Enter keeps the actual native modal open and focuses OTP", async ({
  page,
}) => {
  await openScenario(page, "email-basic");
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");

  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.getByLabel("Verification code")).toBeFocused();
  await expect(page).not.toHaveURL(/fixture%40example|fixture@example|flow-/);
});

test("Base provider confirmation receives a real click after the Home modal releases", async ({
  page,
}) => {
  await openScenario(page, "base-click");
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByRole("button", { name: "Continue with Base Account" }).click();

  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Mock provider confirmation" }).click();
  await expect(page.getByTestId("provider-confirmations")).toHaveText("1");
  await waitForHarnessEvent(page, "base:provider-confirmed");

  await page.getByRole("button", { name: "Cancel sign in" }).click();
  await expect(page.getByRole("button", { name: "Cancel sign in" })).toHaveCount(0);
  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
});

test("verified current email session navigates only after server validation and logout hides it", async ({
  page,
}) => {
  await openScenario(page, "email-basic");
  await openEmailOtp(page, "verified@example.test");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await expect(page.getByTestId("session-status")).toHaveText("verified");
  await expect(page.getByTestId("private-address")).toHaveText(FIXTURE_ADDRESS);
  await expect(page.getByTestId("observed-route")).toHaveText("/dashboard");

  await page.getByRole("button", { name: "Sign out fixture session" }).click();
  await expect(page.getByTestId("session-status")).toHaveText("signed-out");
  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
});

test("regression: old canceled OTP owner stays private after a second email attempt starts", async ({
  page,
}) => {
  await openScenario(page, "email-old-owner");
  await openEmailOtp(page, "attempt-a@example.test");
  await page.getByLabel("Verification code").fill("111111");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Verifying…" })).toBeDisabled();
  await page.getByRole("button", { name: "Close sign in" }).click();

  await openEmailOtp(page, "attempt-b@example.test");
  await page.evaluate(() =>
    (window as Window & { authHarness: { arriveOwner: (owner?: string) => void } }).authHarness.arriveOwner(
      "old-owner-a",
    ),
  );
  await waitForLateOwnerDisposition(page);

  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
  await expect(page.getByTestId("session-status")).not.toHaveText("verified");
});

test("regression: Base invalidation during hosted verification blocks a late SDK owner", async ({
  page,
}) => {
  await openScenario(page, "base-invalidation");
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByRole("button", { name: "Continue with Base Account" }).click();
  await page.getByRole("button", { name: "Mock provider confirmation" }).click();
  await waitForHarnessEvent(page, "siwe:verifying");

  await page.evaluate(() => {
    const harness = (
      window as Window & {
        authHarness: {
          triggerBaseInvalidation: (reason?: "disconnected") => void;
          arriveOwner: (owner?: string) => void;
        };
      }
    ).authHarness;
    harness.triggerBaseInvalidation("disconnected");
    harness.arriveOwner("late-base-owner");
  });
  await waitForLateOwnerDisposition(page);

  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
  await expect(page.getByTestId("session-status")).not.toHaveText("verified");
});

test("regression: failed post-Base session validation restores recoverable modal controls", async ({
  page,
}) => {
  await openScenario(page, "base-503");
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByRole("button", { name: "Continue with Base Account" }).click();
  await page.getByRole("button", { name: "Mock provider confirmation" }).click();

  await expect(page.getByTestId("session-status")).toHaveText("unavailable");
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("incident 211: missing restored Base connection signs out into normal 390px sign-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "base-missing-connection");
  await waitForHarnessEvent(page, "base:restore");
  await waitForHarnessEvent(page, "sdk:sign-out");

  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
  await expect(page.getByTestId("session-message")).toHaveText(
    "Base Account was disconnected. Sign in again to continue.",
  );
  await expect.poll(() =>
    page.evaluate(() => window.sessionStorage.getItem("home:account-provider")),
  ).toBeNull();

  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Base Account" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/issue-211-base-missing-connection-390.png",
    fullPage: true,
  });

  await page.reload();
  await expect(page.getByTestId("session-status")).toHaveText("signed-out");
  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
  await expect.poll(() =>
    page.evaluate(() => window.sessionStorage.getItem("home:account-provider")),
  ).toBeNull();
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() =>
      (window as Window & { authHarness: { events: string[] } }).authHarness.events,
    ),
  ).not.toContain("base:restore");
  expect(
    await page.evaluate(() =>
      (window as Window & { authHarness: { events: string[] } }).authHarness.events,
    ),
  ).not.toContain("sdk:sign-out");
  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("regression: verified Base session navigates when final provider assertion finishes late", async ({
  page,
}) => {
  await openScenario(page, "base-fast-session");
  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByRole("button", { name: "Continue with Base Account" }).click();
  await page.getByRole("button", { name: "Mock provider confirmation" }).click();

  await waitForHarnessEvent(page, "base:assert:4");
  await expect(page.getByTestId("session-status")).not.toHaveText("verified");
  await expect(page.getByTestId("private-address")).toHaveText(
    "private-details-hidden",
  );
  await expect(page.getByTestId("observed-route")).toHaveText("/");
  await page.evaluate(() =>
    (
      window as Window & {
        authHarness: { releaseFinalBaseAssert: () => void };
      }
    ).authHarness.releaseFinalBaseAssert(),
  );

  await expect(page.getByTestId("session-status")).toHaveText("verified");
  await expect(page.getByTestId("observed-route")).toHaveText("/dashboard");
});
