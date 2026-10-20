import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { parseBrandSettingsResponse } from "../../shared/operator-branding/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseAuditListResponse, parseOperatorSettingsErrorResponse, parsePutSettingsRequest } from "../../shared/operator-settings/contract";
import { homeSessionToken } from "./fixtures/session";
import { expectNavigation } from "./fixtures/navigation-budget";

const admin = "0x1111111111111111111111111111111111111111";
const secondAdmin = "0x3333333333333333333333333333333333333333";
const customer = "0x2222222222222222222222222222222222222222";
const settingsPath = "/api/admin/settings/brand";

async function setSession(context: BrowserContext, address: string) {
  await context.addCookies([{
    name: "home-session", value: homeSessionToken(address), domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);
}

async function readBrand(context: BrowserContext) {
  const response = await context.request.get(settingsPath);
  expect(response.status()).toBe(200);
  const entry = parseBrandSettingsResponse(await response.json());
  if (!entry) throw new Error("Brand GET did not satisfy the brand contract.");
  return entry.settings;
}

async function brandAudit(context: BrowserContext) {
  const response = await context.request.get("/api/admin/audit");
  expect(response.status()).toBe(200);
  const audit = parseAuditListResponse(await response.json());
  if (!audit) throw new Error("Audit GET did not satisfy the audit contract.");
  return audit.entries.filter((entry) => entry.target.id === "brand");
}

async function fill(page: Page, values: { name?: string; description?: string; primary?: string; background?: string }) {
  if (values.name !== undefined) await page.getByLabel("Display name", { exact: true }).fill(values.name);
  if (values.description !== undefined) await page.getByLabel("Description", { exact: true }).fill(values.description);
  if (values.primary !== undefined) await page.getByLabel("Primary color", { exact: true }).fill(values.primary);
  if (values.background !== undefined) await page.getByLabel("Background color", { exact: true }).fill(values.background);
}

async function save(page: Page, operator: string, revision: number) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await pending;
  expect(parsePutSettingsRequest(response.request().postDataJSON())).toMatchObject({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, operator, expectedRevision: revision });
  return response;
}

test("Brand edits persist, apply to a fresh customer page and never overwrite silently", { tag: "@smoke" }, async ({ page, context }) => {
  test.setTimeout(120_000);
  await setSession(context, admin);
  const puts: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === settingsPath && request.method() === "PUT") puts.push(request.url()); });

  await test.step("Settings links to Brand, which names its deployment-default source", async () => {
    await page.goto("/admin/settings");
    await page.getByRole("link", { name: /^Brand/ }).click();
    await expectNavigation(page, /\/admin\/settings\/brand$/);
    await expect(page.getByRole("heading", { name: "Brand", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("Using deployment defaults. Nothing is saved yet.", { exact: true })).toBeVisible();
    expect(await readBrand(context)).toMatchObject({ source: "default", revision: 0 });
  });

  await test.step("invalid input blocks the write and keeps the draft; Cancel writes nothing", async () => {
    await fill(page, { name: "   ", primary: "blue" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Enter a display name.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter a color like #0052ff.", { exact: true })).toBeVisible();
    expect(puts).toHaveLength(0);
    await fill(page, { name: "Acme Money", primary: "#0B6B3A" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("home");
    expect(puts).toHaveLength(0);
    expect(await readBrand(context)).toMatchObject({ source: "default", revision: 0 });
  });

  await test.step("one revision-bound save persists all four fields with an audit entry", async () => {
    await fill(page, { name: "Acme Money", description: "Money for Acme customers.", primary: "#0B6B3A", background: "#f5f8f2" });
    await expect(page.getByRole("group", { name: "Customer preview" }).getByText("Acme Money").first()).toBeVisible();
    expect((await save(page, admin, 0)).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    expect(puts).toHaveLength(1);
    const stored = await readBrand(context);
    expect(stored).toMatchObject({ source: "stored", revision: 1, updatedBy: admin, value: { displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" } });
    const audit = await brandAudit(context);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: admin, action: "settings.update", after: stored.value });
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Acme Money");
    await expect(page.getByLabel("Primary color", { exact: true })).toHaveValue("#0b6b3a");
    await expect(page.getByText(/Saved settings, revision 1\./)).toBeVisible();
  });

  await test.step("a fresh customer page carries the saved brand, light tokens only", async () => {
    await page.goto("/access");
    await expect(page.getByText("Acme Money", { exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Acme Money · local money preview");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Money for Acme customers.");
    const light = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { primary: style.getPropertyValue("--primary").trim(), ring: style.getPropertyValue("--ring").trim(), card: style.getPropertyValue("--card").trim() };
    });
    expect(light).toMatchObject({ primary: "#0b6b3a", ring: "#0b6b3a" });
    const dark = await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      const style = getComputedStyle(document.documentElement);
      return { primary: style.getPropertyValue("--primary").trim(), card: style.getPropertyValue("--card").trim() };
    });
    expect(dark.primary).toBe("#578bfa");
    expect(dark.card).not.toBe("");
    expect(dark.card).not.toBe(light.card);
  });

  await test.step("a real revision race keeps the rejected draft until the operator chooses", async () => {
    await page.goto("/admin/settings/brand");
    const concurrent = await context.newPage();
    try {
      await concurrent.goto("/admin/settings/brand");
      await fill(page, { name: "Draft Name" });
      await fill(concurrent, { description: "Won the race." });
      expect((await save(concurrent, admin, 1)).status()).toBe(200);
      const winner = await readBrand(context);
      const auditBefore = await brandAudit(context);
      const rejected = await save(page, admin, 1);
      expect(rejected.status()).toBe(409);
      expect(parseOperatorSettingsErrorResponse(await rejected.json())).toMatchObject({ error: { code: "SETTINGS_CONFLICT" } });
      await expect(page.getByText("Someone else saved brand settings", { exact: false }).first()).toBeVisible();
      await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Draft Name");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(await readBrand(context)).toEqual(winner);
      expect(await brandAudit(context)).toEqual(auditBefore);
      await page.getByRole("button", { name: "Keep my edits", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      expect((await save(page, admin, 2)).status()).toBe(200);
      expect(await readBrand(context)).toMatchObject({ revision: 3, value: { displayName: "Draft Name", description: "Won the race." } });
    } finally { await concurrent.close(); }
  });

  await test.step("a changed signed-in operator is rejected and nothing is written", async () => {
    await fill(page, { name: "Second Operator" });
    const before = await readBrand(context);
    const auditBefore = await brandAudit(context);
    await setSession(context, secondAdmin);
    const rejected = await save(page, admin, 3);
    expect(rejected.status()).toBe(409);
    expect(parseOperatorSettingsErrorResponse(await rejected.json())).toMatchObject({ error: { code: "OPERATOR_CHANGED" } });
    await expect(page.getByText("A different operator is signed in. Reload this page before saving.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(await readBrand(context)).toEqual(before);
    expect(await brandAudit(context)).toEqual(auditBefore);
    await page.getByRole("button", { name: "Reload page", exact: true }).click();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Draft Name");
    await setSession(context, admin);
  });

  await test.step("a non-operator cannot read the editor or write settings", async () => {
    await setSession(context, customer);
    const denied = await context.request.get("/admin/settings/brand", { maxRedirects: 0 });
    expect(denied.status()).toBe(307);
    expect(denied.headers().location).toBe("/home");
    expect((await context.request.get(settingsPath)).status()).toBe(403);
    expect((await context.request.put(settingsPath, { data: {}, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);
    await setSession(context, admin);
  });
});
