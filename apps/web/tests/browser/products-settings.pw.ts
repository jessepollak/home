import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { VERIFIED_SAVE_VAULTS } from "../../shared/savings/config";
import { BORROW_MARKETS } from "../../shared/borrowing/config";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseAuditListResponse, parseOperatorSettingsErrorResponse, parsePutSettingsRequest } from "../../shared/operator-settings/contract";
import { settingsEntry } from "../../client/operator/product-settings-model";
import { homeSessionToken } from "./fixtures/session";
import { expectNavigation } from "./fixtures/navigation-budget";
import { formatPresentationDate } from "../../shared/formatting";

const admin = "0x1111111111111111111111111111111111111111";
const secondAdmin = "0x3333333333333333333333333333333333333333";
const settingsPath = "/api/admin/settings/products";
const vault = VERIFIED_SAVE_VAULTS.find((entry) => entry.capabilities.save === "enabled");
const market = BORROW_MARKETS.find((entry) => entry.availability === "enabled");
if (!vault || !market) throw new Error("Products browser fixture requires an enabled vault and market.");
const vaultId = vault.id;
const vaultName = vault.name;
const marketId = market.marketId.toLowerCase();
const marketName = `${market.collateralToken.symbol} collateral`;

async function setSession(context: BrowserContext, address: string) {
  await context.addCookies([{
    name: "home-session", value: homeSessionToken(address), domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);
}

async function readSettings(context: BrowserContext) {
  const response = await context.request.get(settingsPath);
  expect(response.status()).toBe(200);
  const entry = settingsEntry(await response.json());
  if (!entry) throw new Error("Products GET did not satisfy the settings contract.");
  return entry;
}

async function readAudit(context: BrowserContext) {
  const response = await context.request.get("/api/admin/audit");
  expect(response.status()).toBe(200);
  const audit = parseAuditListResponse(await response.json());
  if (!audit) throw new Error("Audit GET did not satisfy the audit contract.");
  return audit.entries;
}

async function save(page: Page, operator: string, revision: number, button = "Save settings") {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath && response.request().method() === "PUT");
  await page.getByRole("button", { name: button, exact: true }).click();
  const response = await pending;
  const request = parsePutSettingsRequest(response.request().postDataJSON());
  expect(request).toMatchObject({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, operator, expectedRevision: revision });
  expect((await response.request().allHeaders()).cookie).toContain(`home-session=${homeSessionToken(operator)}`);
  return response;
}

async function expectSaved(page: Page, operator: string) {
  await expect(visible(page.getByText("Saved settings", { exact: true }))).toBeVisible();
  await expect(visible(page.getByRole("button", { name: `Copy ${operator.slice(0, 6)}`, exact: false }))).toHaveCount(2);
  await expect(visible(page.getByText("Using deployment values — review and save", { exact: true }))).toHaveCount(0);
  const stored = await readSettings(page.context());
  if (!stored.settings.updatedAt) throw new Error("Saved provenance is missing its timestamp.");
  await expect(visible(page.getByText(formatPresentationDate(stored.settings.updatedAt, { style: "date-time-zone", timeZone: "UTC" }), { exact: true }))).toBeVisible();
}

const visible = (locator: Locator) => locator.filter({ visible: true });
const mode = (page: Page, name: string) => visible(page.getByRole("radiogroup", { name: `${name} mode`, exact: true }));

test("Products persist real operator saves, reviewed enables and rejected stale writes", { tag: "@smoke" }, async ({ page, context }) => {
  test.setTimeout(120_000);
  await setSession(context, admin);
  await page.goto("/admin/settings");
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible();
  await page.getByRole("link", { name: /Products and markets/ }).click();
  await expectNavigation(page, /\/admin\/settings\/products$/);
  await expect(page.getByRole("heading", { name: "Products and markets", exact: true })).toBeVisible();
  await expect(visible(page.getByText("Using deployment values — review and save", { exact: true }))).toBeVisible();
  const deployment = await readSettings(context);
  expect(deployment.settings).toMatchObject({ source: "default", revision: 0, updatedAt: null, updatedBy: null });
  expect(await readAudit(context)).toEqual([]);

  await test.step("pause Save persists provenance and one before/after audit", async () => {
    await mode(page, "Save").getByRole("radio", { name: "Exit only", exact: true }).click();
    expect((await save(page, admin, 0)).status()).toBe(200);
    await expectSaved(page, admin);
    await page.reload();
    await expectSaved(page, admin);
    await expect(mode(page, "Save").getByRole("radio", { name: "Exit only", exact: true })).toBeChecked();
    const stored = await readSettings(context);
    expect(stored.settings).toMatchObject({ source: "stored", revision: 1, updatedBy: admin, value: { products: { save: "exit-only" } } });
    expect(Number.isFinite(Date.parse(stored.settings.updatedAt ?? ""))).toBe(true);
    const audit = await readAudit(context);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: admin, action: "settings.update", target: { kind: "settings", id: "products" }, before: deployment.settings.value, after: stored.settings.value });
  });

  await test.step("re-enabling Save requires Turn on, Cancel writes nothing", async () => {
    const before = await readSettings(context);
    const audit = await readAudit(context);
    await mode(page, "Save").getByRole("radio", { name: "On", exact: true }).click();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByText("Turn on new entries?", { exact: true })).toBeVisible();
    await expect(page.getByText("Customers can deposit into enabled vaults.", { exact: false })).toBeVisible();
    expect(await readSettings(context)).toEqual(before);
    expect(await readAudit(context)).toEqual(audit);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Turn on", exact: true })).toHaveCount(0);
    expect(await readSettings(context)).toEqual(before);
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Turn on", exact: true })).toBeVisible();
    expect((await save(page, admin, 1, "Turn on")).status()).toBe(200);
    await page.reload();
    await expect(mode(page, "Save").getByRole("radio", { name: "On", exact: true })).toBeChecked();
    expect((await readSettings(context)).settings.revision).toBe(2);
    expect(await readAudit(context)).toHaveLength(2);
  });

  await test.step("vault and market Reducing only persist independently with products still On", async () => {
    await mode(page, vaultName).getByRole("radio", { name: "Reducing only", exact: true }).click();
    await mode(page, marketName).getByRole("radio", { name: "Reducing only", exact: true }).click();
    expect((await save(page, admin, 2)).status()).toBe(200);
    await page.reload();
    await expect(mode(page, vaultName).getByRole("radio", { name: "Reducing only", exact: true })).toBeChecked();
    await expect(mode(page, marketName).getByRole("radio", { name: "Reducing only", exact: true })).toBeChecked();
    const stored = await readSettings(context);
    expect(stored.settings.value).toMatchObject({ products: { save: "on", borrow: "on" }, vaults: { [vaultId]: "reducing-only" }, markets: { [marketId]: "reducing-only" } });
    expect(stored.settings.revision).toBe(3);
    const audit = await readAudit(context);
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actor: admin, after: stored.settings.value });
    await mode(page, vaultName).getByRole("radio", { name: "Enabled", exact: true }).click();
    await mode(page, marketName).getByRole("radio", { name: "Enabled", exact: true }).click();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByText("Customers can deposit into this vault.", { exact: false })).toBeVisible();
    await expect(page.getByText("Customers can borrow in this market.", { exact: false })).toBeVisible();
    expect(await readSettings(context)).toEqual(stored);
    expect(await readAudit(context)).toEqual(audit);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
  });

  await test.step("another browser page wins a real revision race; Reload discards rejected draft", async () => {
    const concurrent = await context.newPage();
    try {
      await concurrent.goto("/admin/settings/products");
      await expect(mode(concurrent, "Send").getByRole("radio", { name: "On", exact: true })).toBeChecked();
      await mode(page, "Borrow").getByRole("radio", { name: "Exit only", exact: true }).click();
      await mode(concurrent, "Send").getByRole("radio", { name: "Off", exact: true }).click();
      expect((await save(concurrent, admin, 3)).status()).toBe(200);
      const winner = await readSettings(context);
      const audit = await readAudit(context);
      const rejected = await save(page, admin, 3);
      expect(rejected.status()).toBe(409);
      expect(parseOperatorSettingsErrorResponse(await rejected.json())).toMatchObject({ error: { code: "SETTINGS_CONFLICT" }, current: winner });
      await expect(page.getByText("Settings changed since you opened this page.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
      expect(await readSettings(context)).toEqual(winner);
      expect(await readAudit(context)).toEqual(audit);
      expect(audit).toHaveLength(4);
      await page.getByRole("button", { name: "Reload settings", exact: true }).click();
      await expect(mode(page, "Send").getByRole("radio", { name: "Off", exact: true })).toBeChecked();
      await expect(mode(page, "Borrow").getByRole("radio", { name: "On", exact: true })).toBeChecked();
      await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
      await page.reload();
      await expect(mode(page, "Send").getByRole("radio", { name: "Off", exact: true })).toBeChecked();
    } finally { await concurrent.close(); }
  });

  await test.step("signed-in operator changes without refreshing; real 409 writes nothing and reload binds the new actor", async () => {
    const before = await readSettings(context);
    const audit = await readAudit(context);
    await mode(page, "Borrow").getByRole("radio", { name: "Exit only", exact: true }).click();
    await setSession(context, secondAdmin);
    expect(await (await context.request.get("/api/admin/session")).json()).toEqual({ version: 1, operator: { address: secondAdmin } });
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    const rejected = await pending;
    expect(parsePutSettingsRequest(rejected.request().postDataJSON())).toMatchObject({ operator: admin, expectedRevision: 4 });
    expect((await rejected.request().allHeaders()).cookie).toContain(`home-session=${homeSessionToken(secondAdmin)}`);
    expect(rejected.status()).toBe(409);
    expect(parseOperatorSettingsErrorResponse(await rejected.json())).toMatchObject({ error: { code: "OPERATOR_CHANGED" }, current: before });
    await expect(page.getByText("A different operator is signed in. Reload this page before saving.", { exact: true })).toBeVisible();
    expect(await readSettings(context)).toEqual(before);
    expect(await readAudit(context)).toEqual(audit);
    await page.reload();
    await expect(visible(page.getByRole("complementary", { name: "Operator sidebar" })).getByRole("button", { name: /Copy 0x3333/ })).toBeVisible();
    await expect(mode(page, "Borrow").getByRole("radio", { name: "On", exact: true })).toBeChecked();
    await mode(page, "Borrow").getByRole("radio", { name: "Exit only", exact: true }).click();
    expect((await save(page, secondAdmin, 4)).status()).toBe(200);
    await page.reload();
    await expectSaved(page, secondAdmin);
    await expect(mode(page, "Borrow").getByRole("radio", { name: "Exit only", exact: true })).toBeChecked();
    const stored = await readSettings(context);
    expect(stored.settings).toMatchObject({ revision: 5, updatedBy: secondAdmin });
    const finalAudit = await readAudit(context);
    expect(finalAudit).toHaveLength(5);
    expect(finalAudit[0]).toMatchObject({ actor: secondAdmin, before: before.settings.value, after: stored.settings.value });
  });
});
