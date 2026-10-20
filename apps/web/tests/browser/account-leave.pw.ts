import { expect, test } from "@playwright/test";
import { ACCOUNT_EXPORT_HOME_CLASSES } from "../../shared/account/contracts/data-export";
import { parseAccountDeletionReceipt, providerHeldStatement, type AccountDeletionReceipt } from "../../shared/account/contracts/account-deletion";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { waitForShellHydration } from "./fixtures/shell-hydration";
import { sessionBody } from "./fixtures/bodies";

const at = "2026-10-07T03:00:00.000Z";
const requestId = "11111111-1111-4111-8111-111111111111";
function receipt(status: "queued" | "completed"): AccountDeletionReceipt {
  return {
    version: 1, schema: "home.account-deletion", requestId, status,
    requestedAt: at, updatedAt: at, completedAt: status === "completed" ? at : null, retentionYears: 5,
    blockers: status === "queued" ? [{ name: "actions", count: 1 }] : [],
    lastAttempt: status === "queued" ? { at, outcome: "blocked" } : null,
    stores: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => status === "queued" ? { name, disposition: "pending" }
      : ["actions", "access_audit", "funding_orders"].includes(name)
        ? { name, disposition: "retained-pseudonymized", evidence: "Financial records", reason: "Reconciliation and duplicate-success protection", expiresAt: "2031-10-07T03:00:00.000Z" }
        : { name, disposition: "deleted" }),
    providers: [{ provider: "Coinbase", records: "Sign-in records", disposition: "held-by-provider", statement: providerHeldStatement("Coinbase") }],
    publicChain: { disposition: "public-chain-immutable", statement: "Public-chain history cannot be erased." },
  };
}

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test("wallet-free Leave Home resets a queued owner's view on credential switch", async ({ page }) => {
      await seedSignedInSession(page);
      await installApiFixtures(page);
      await page.route("**/api/session", (route) => json(route, { ...sessionBody, smartAccount: null }));
      let secondOwner = false;
      await page.route("**/api/account/deletion", (route) => json(route, secondOwner
        ? { error: { code: "ACCOUNT_DELETION_NOT_FOUND", message: "No request" } }
        : receipt("queued")));
      await page.goto("/home?account=settings");
      await waitForShellHydration(page);
      await page.getByRole("button", { name: "Leave Home", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Deletion queued" })).toBeVisible();
      secondOwner = true;
      await page.route("**/api/session", (route) => json(route, { ...sessionBody, user: { subject: "playwright-smoke-second-subject" }, smartAccount: null }));
      await page.evaluate(() => window.dispatchEvent(new Event("home:playwright-smoke:owner-switch")));
      await expect(page.getByRole("region", { name: "Your data", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Deletion queued" })).toHaveCount(0);
      await page.getByRole("button", { name: "Leave Home", exact: true }).click();
      await expect(page.getByRole("button", { name: "Delete my Home account" })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Deletion queued" })).toHaveCount(0);
    });
    test("Leave Home: Back changes nothing, queued survives reload, completion clears device and downloads receipt", async ({ page }) => {
      await page.clock.install();
      await seedSignedInSession(page);
      await installApiFixtures(page);
      let current: AccountDeletionReceipt | null = null;
      let posts = 0;
      let refreshFailure = false;
      let malformed = false;
      const observedRequestIds: string[] = [];
      await page.route("**/api/account/deletion", async (route) => {
        if (route.request().method() === "POST") {
          posts += 1;
          expect([null, "{}"]).toContain(route.request().postData());
          current ??= receipt("queued");
        }
        if (refreshFailure) return json(route, { error: { code: "ACCOUNT_DELETION_UNAVAILABLE", message: "Unavailable" } });
        if (malformed) return json(route, { status: "completed" });
        if (!current) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "ACCOUNT_DELETION_NOT_FOUND", message: "No request" } }) });
        observedRequestIds.push(current.requestId);
        await json(route, current);
      });
      await page.goto("/home");
      await waitForShellHydration(page);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: /^Account(?: settings)?$/ }).click();
      await page.evaluate(() => {
        localStorage.setItem("home.query.v1:deletion-test", "private-cache-sentinel");
        localStorage.setItem("home.appearance.v1", "light");
        localStorage.setItem("unrelated-public-preference", "keep");
        document.cookie = "home.display-summary.v1=private-summary-sentinel; Path=/home";
      });
      await page.getByRole("button", { name: "Leave Home", exact: true }).click();
      await expect(page.getByRole("button", { name: "Export my data" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete my Home account" })).toBeEnabled();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.getByRole("region", { name: "Your data", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Leave Home", exact: true })).toBeFocused();
      expect(posts).toBe(0);
      expect(current).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("home.query.v1:deletion-test"))).toBe("private-cache-sentinel");
      await page.getByRole("button", { name: "Leave Home", exact: true }).click();
      const deleteButton = page.getByRole("button", { name: "Delete my Home account" });
      await deleteButton.click();
      const dialog = page.getByRole("dialog", { name: "Delete your Home account?" });
      await expect(dialog).toBeVisible();
      const confirmDeletion = dialog.getByRole("button", { name: "Confirm deletion" });
      const cancelDeletion = dialog.getByRole("button", { name: "Cancel deletion" });
      await expect(dialog.getByRole("button")).toHaveText(["Confirm deletion", "Cancel deletion"]);
      await expect(cancelDeletion).toBeFocused();
      await expect.poll(async () => {
        const primary = await confirmDeletion.boundingBox();
        const secondary = await cancelDeletion.boundingBox();
        return primary && secondary ? primary.y + primary.height <= secondary.y : false;
      }).toBe(true);
      await dialog.getByRole("button", { name: "Cancel deletion" }).click();
      await expect(dialog).toBeHidden();
      await expect(deleteButton).toBeFocused();
      expect(posts).toBe(0);
      await deleteButton.click();
      await expect(cancelDeletion).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(deleteButton).toBeFocused();
      expect(posts).toBe(0);
      await expect(page.getByRole("banner").getByRole("button", { name: "Back", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Leave Home", exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await deleteButton.click();
      await expect(cancelDeletion).toBeFocused();
      await expect(dialog.getByRole("button")).toHaveText(["Confirm deletion", "Cancel deletion"]);
      await confirmDeletion.click();
      await expect(page.getByRole("heading", { name: "Deletion queued" })).toBeVisible();
      await expect(page.getByText("1 money action still pending")).toBeVisible();
      expect(posts).toBe(1);
      await page.reload();
      await waitForShellHydration(page);
      const leave = page.getByRole("button", { name: "Leave Home", exact: true });
      const queued = page.getByRole("heading", { name: "Deletion queued" });
      await expect(leave.or(queued).or(page.getByRole("button", { name: /^Account(?: settings)?$/ })).first()).toBeVisible();
      if (!(await leave.isVisible()) && !(await queued.isVisible())) await page.getByRole("button", { name: /^Account(?: settings)?$/ }).click();
      if (!(await queued.isVisible())) await leave.click();
      await expect(queued).toBeVisible();
      expect(posts).toBe(1);
      expect(observedRequestIds.length).toBeGreaterThanOrEqual(2);
      expect(new Set(observedRequestIds)).toEqual(new Set([requestId]));
      await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
      refreshFailure = true;
      await page.clock.fastForward(15_000);
      await expect(page.getByText("Couldn't refresh. Deletion is still queued. We’ll retry automatically.")).toBeVisible();
      await expect(queued).toBeVisible();
      refreshFailure = false;
      malformed = true;
      await page.clock.fastForward(15_000);
      await expect(page.getByText("Couldn't refresh. Deletion is still queued. We’ll retry automatically.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Home account deleted" })).toHaveCount(0);
      malformed = false;
      await page.clock.fastForward(15_000);
      await expect(page.getByText("Couldn't refresh. Deletion is still queued. We’ll retry automatically.")).toHaveCount(0);
      await expect(queued).toBeVisible();
      current = { ...receipt("queued"), blockers: [], lastAttempt: { at, outcome: "failed" } };
      await page.clock.fastForward(15_000);
      await expect(page.getByText("The last attempt failed. Your Home account has not been deleted.")).toBeVisible();
      await expect(queued).toBeVisible();
      current = receipt("completed");
      await page.clock.fastForward(15_000);
      expect(posts).toBe(1);
      await expect(page.getByRole("heading", { name: "Home account deleted" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Download receipt" })).toBeVisible();
      await expect(page.getByText("Cleared on this device", { exact: true })).toHaveCount(5);
      await expect(page.getByText("Sign-in records — held by Coinbase, not deleted by Home")).toBeVisible();
      await expect(page.getByText("Public-chain history cannot be erased.")).toBeVisible();
      const device = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("home-query-cache");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const cache = await new Promise<unknown>((resolve, reject) => {
          const request = db.transaction("owner-clients").objectStore("owner-clients").get("owner-client");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return { keys: Object.keys(localStorage).filter((key) => key.startsWith("home.") || key.startsWith("home:")), cookie: document.cookie, cache, unrelated: localStorage.getItem("unrelated-public-preference"), signedIn: sessionStorage.getItem("home:playwright-smoke:signed-in") };
      });
      expect(device.keys).toEqual([]);
      expect(device.cookie).not.toContain("home.display-summary.v1");
      expect(device.cache).toMatchObject({ owner: null, value: null });
      expect(device.unrelated).toBe("keep");
      expect(device.signedIn).not.toBe("1");
      const pendingDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download receipt" }).click();
      const download = await pendingDownload;
      expect(download.suggestedFilename()).toBe(`home-deletion-receipt-${requestId}.json`);
      const stream = await download.createReadStream();
      if (!stream) throw new Error("Receipt stream unavailable");
      stream.setEncoding("utf8");
      let text = "";
      for await (const chunk of stream) {
        if (typeof chunk !== "string") throw new Error("Unexpected receipt chunk");
        text += chunk;
      }
      const file = JSON.parse(text);
      const { currentDevice, ...serverReceipt } = file;
      expect(parseAccountDeletionReceipt(serverReceipt)).toEqual(receipt("completed"));
      expect(currentDevice).toHaveLength(5);
      expect(text).not.toContain("private-cache-sentinel");
    });
  });
}
