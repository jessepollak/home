import { expect, test, type Download, type Page, type Route } from "@playwright/test";
import { ACCOUNT_EXPORT_HOME_CLASSES, type AccountExportResponse } from "../../shared/account/contracts/data-export";
import { isRecord } from "../../shared/guards";
import { dataOwnerKey } from "../../shared/account/data-owner";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { expectNavigation } from "./fixtures/navigation-budget";
import { waitForShellHydration } from "./fixtures/shell-hydration";

const generatedAt = "2026-10-07T03:00:00.000Z";
const errorCopy = "Couldn't create your export. Nothing in your account changed.";
const secondSession = {
  ...sessionBody,
  user: { subject: "playwright-smoke-second-subject" },
  smartAccount: { ...sessionBody.smartAccount, address: "0x3333333333333333333333333333333333333333" },
};

function exportBody(marker = "first-owner"): AccountExportResponse {
  return {
    version: 1, schema: "home.account-export", generatedAt, complete: true,
    classes: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => ({ name, holder: "home", records: name === "customer" ? [{ marker }] : [] })),
    boundaries: { providerHeld: "Provider records are not included.", publicChain: "Public chain records are not included.", currentDevice: "Current device metadata is added by the browser." },
  };
}

async function downloadedJson(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable");
  stream.setEncoding("utf8");
  let text = "";
  for await (const chunk of stream) {
    if (typeof chunk !== "string") throw new Error("Unexpected download chunk");
    text += chunk;
  }
  const file: unknown = JSON.parse(text);
  if (!isRecord(file) || !Array.isArray(file.classes) || !file.classes.every(isRecord)) throw new Error("Invalid export file");
  return { ...file, classes: file.classes };
}

async function openAccount(page: Page) {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await waitForShellHydration(page);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /^Account(?: settings)?$/ }).click();
  await expect(page.getByRole("region", { name: "Your data", exact: true })).toBeVisible();
}

async function stallDeviceCacheInspection(page: Page, denyStorage = false) {
  await page.evaluate((denyStorage) => {
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: async () => [{ name: "home-query-cache" }] });
    Object.defineProperty(indexedDB, "open", { configurable: true, value: () => {
      document.documentElement.setAttribute("data-export-cache-open", "true");
      const request: { result: { close: () => void }; onsuccess: ((event: Event) => void) | null } = {
        result: { close: () => document.documentElement.setAttribute("data-export-cache-closed", "true") },
        onsuccess: null,
      };
      window.addEventListener("export-test:late-open", () => { request.onsuccess?.(new Event("success")); }, { once: true });
      return request;
    } });
    if (denyStorage) {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("home.query.v1:")) throw new Error("Storage unavailable");
        return getItem.call(this, key);
      };
      Object.defineProperty(document, "cookie", { configurable: true, get: () => { throw new Error("Cookies unavailable"); } });
    }
  }, denyStorage);
}

function dataSection(page: Page) {
  return page.getByRole("region", { name: "Your data", exact: true });
}

async function startPendingExport(page: Page) {
  let release: () => void = () => {};
  let observed: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { observed = resolve; });
  let finished: () => void = () => {};
  const completed = new Promise<void>((resolve) => { finished = resolve; });
  const handler = async (route: Route) => {
    observed();
    await gate;
    await json(route, exportBody());
    finished();
  };
  await page.route("**/api/account/export", handler, { times: 1 });
  await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
  await requested;
  const preparing = dataSection(page).getByRole("button", { name: "Preparing…", exact: true });
  await expect(preparing).toBeDisabled();
  await expect(preparing).toHaveAttribute("aria-busy", "true");
  await expect(dataSection(page).getByRole("status")).toHaveText("Preparing your export");
  return async () => {
    release();
    await completed;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
}

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Account exports a fresh JSON download without cache or credential contents", { tag: viewport.name === "mobile" ? "@smoke" : [] }, async ({ page }) => {
      await openAccount(page);
      const owner = dataOwnerKey({ subject: sessionBody.user.subject, smartAccountAddress: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" });
      await page.evaluate((key) => {
        localStorage.setItem("home.show-small-balances.v1", "true");
        localStorage.setItem("home.appearance.v1", "dark");
        localStorage.setItem(`home.query.v1:${encodeURIComponent(key)}`, "private-cache-sentinel");
        localStorage.setItem("private-token", "private-token-sentinel");
        document.cookie = "home.display-summary.v1=private-cookie-sentinel; Path=/home";
      }, owner);
      let reads = 0;
      await page.route("**/api/account/export", async (route) => {
        reads += 1;
        expect(route.request().method()).toBe("GET");
        expect(new URL(route.request().url()).search).toBe("");
        expect(route.request().postData()).toBeNull();
        await json(route, exportBody());
      });
      const pendingDownload = page.waitForEvent("download");
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      const download = await pendingDownload;
      expect(download.suggestedFilename()).toBe("home-data-export-2026-10-07.json");
      const file = await downloadedJson(download);
      expect(file).toMatchObject({ version: 1, schema: "home.account-export", generatedAt, complete: true });
      expect(file.classes.map((entry) => entry.name)).toEqual([...ACCOUNT_EXPORT_HOME_CLASSES, "device_preferences", "device_caches"]);
      expect(file.classes.slice(0, ACCOUNT_EXPORT_HOME_CLASSES.length)).toEqual(exportBody().classes);
      expect(file.classes.at(-2)).toEqual({ name: "device_preferences", holder: "current-device", records: [{ region: "US", showSmallBalances: true, appearance: "dark" }] });
      expect(file.classes.at(-1)).toMatchObject({ name: "device_caches", holder: "current-device", records: [
        { kind: "indexed_owner_cache", present: expect.any(Boolean), description: expect.any(String) },
        { kind: "restored_query_cache", present: true, description: expect.any(String) },
        { kind: "home_summary_cookie", present: true, description: expect.any(String) },
      ] });
      const serialized = JSON.stringify(file);
      for (const secret of ["private-cache-sentinel", "private-token-sentinel", "private-cookie-sentinel", "playwright-smoke-token", "home-access"]) expect(serialized).not.toContain(secret);
      await expect(dataSection(page).getByRole("status")).toHaveText("Export downloaded");
      await expect(dataSection(page).getByRole("button", { name: "Export", exact: true })).toBeEnabled();
      expect(reads).toBe(1);
    });

    test("a device cache inspection that cannot finish downloads with unknown presence", async ({ page }) => {
      await openAccount(page);
      await page.clock.install({ time: new Date("2026-10-07T03:00:00.000Z") });
      await page.clock.pauseAt(new Date("2026-10-07T03:00:01.000Z"));
      await stallDeviceCacheInspection(page, true);
      await page.route("**/api/account/export", (route) => json(route, exportBody()));
      const pendingDownload = page.waitForEvent("download");
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-export-cache-open", "true");
      await page.clock.runFor(1501);
      const file = await downloadedJson(await pendingDownload);
      expect(file.classes.at(-1)).toMatchObject({ name: "device_caches", holder: "current-device", records: [
        { kind: "indexed_owner_cache", present: null, description: expect.any(String) },
        { kind: "restored_query_cache", present: null, description: expect.any(String) },
        { kind: "home_summary_cookie", present: null, description: expect.any(String) },
      ] });
      await page.evaluate(() => window.dispatchEvent(new Event("export-test:late-open")));
      await expect(page.locator("html")).toHaveAttribute("data-export-cache-closed", "true");
      await expect(dataSection(page).getByRole("status")).toHaveText("Export downloaded");
    });

    test("unavailable export retries with a fresh read-only request", async ({ page }) => {
      await openAccount(page);
      let reads = 0;
      const downloads: Download[] = [];
      page.on("download", (download) => downloads.push(download));
      await page.route("**/api/account/export", async (route) => {
        expect(route.request().method()).toBe("GET");
        reads += 1;
        if (reads === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "ACCOUNT_EXPORT_UNAVAILABLE", message: "Unavailable" } }) });
        await json(route, exportBody());
      });
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      await expect(dataSection(page).getByText(errorCopy, { exact: true })).toBeVisible();
      expect(downloads).toHaveLength(0);
      const pendingDownload = page.waitForEvent("download");
      await dataSection(page).getByRole("button", { name: "Try again", exact: true }).click();
      await pendingDownload;
      await expect(dataSection(page).getByRole("status")).toHaveText("Export downloaded");
      expect(reads).toBe(2);
      expect(downloads).toHaveLength(1);
    });

    test("malformed successful export is an error and never downloads", async ({ page }) => {
      await openAccount(page);
      const downloads: Download[] = [];
      page.on("download", (download) => downloads.push(download));
      let reads = 0;
      await page.route("**/api/account/export", (route) => {
        reads += 1;
        return json(route, { ...exportBody(), classes: [] });
      });
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      await expect(dataSection(page).getByText(errorCopy, { exact: true })).toBeVisible();
      await expect(dataSection(page).getByRole("status")).toBeEmpty();
      expect(reads).toBe(1);
      expect(downloads).toHaveLength(0);
    });

    test("Back discards a pending export and returns to idle", async ({ page }) => {
      await openAccount(page);
      const downloads: Download[] = [];
      page.on("download", (download) => downloads.push(download));
      const release = await startPendingExport(page);
      await page.goBack();
      await expectNavigation(page, /\/home$/);
      await expect(page.getByRole("region", { name: "Your money", exact: true })).toBeVisible();
      await release();
      await page.getByRole("button", { name: /^Account(?: settings)?$/ }).click();
      await expect(dataSection(page).getByRole("button", { name: "Export", exact: true })).toBeEnabled();
      await expect(dataSection(page).getByRole("status")).toBeEmpty();
      expect(downloads).toHaveLength(0);
    });

    test("sign-out discards a pending export", async ({ page }) => {
      await openAccount(page);
      const downloads: Download[] = [];
      page.on("download", (download) => downloads.push(download));
      await stallDeviceCacheInspection(page);
      await page.route("**/api/account/export", (route) => json(route, exportBody()));
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-export-cache-open", "true");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expectNavigation(page, /\/$/);
      await page.evaluate(() => window.dispatchEvent(new Event("export-test:late-open")));
      await expect(page.locator("html")).toHaveAttribute("data-export-cache-closed", "true");
      await expect(page.getByText("Export downloaded", { exact: true })).toHaveCount(0);
      expect(downloads).toHaveLength(0);
    });

    test("owner switch discards the previous owner's pending export", async ({ page }) => {
      await openAccount(page);
      const downloads: Download[] = [];
      page.on("download", (download) => downloads.push(download));
      const release = await startPendingExport(page);
      await page.route("**/api/session", (route) => json(route, secondSession));
      await page.evaluate(() => window.dispatchEvent(new Event("home:playwright-smoke:owner-switch")));
      await expect(dataSection(page).getByRole("button", { name: "Export", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Show full address 0x3333…333333", exact: true })).toBeVisible();
      await release();
      await expect(dataSection(page).getByRole("status")).toBeEmpty();
      expect(downloads).toHaveLength(0);
      await page.route("**/api/account/export", (route) => json(route, exportBody("second-owner")));
      const pendingDownload = page.waitForEvent("download");
      await dataSection(page).getByRole("button", { name: "Export", exact: true }).click();
      const file = await downloadedJson(await pendingDownload);
      expect(file.classes[0]?.records).toEqual([{ marker: "second-owner" }]);
      await expect(dataSection(page).getByRole("status")).toHaveText("Export downloaded");
      expect(downloads).toHaveLength(1);
    });
  });
}
