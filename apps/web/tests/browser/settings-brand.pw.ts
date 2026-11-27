import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { parseBrandSettingsResponse } from "../../shared/operator-branding/contract";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseAuditListResponse, parseOperatorSettingsErrorResponse, parsePutSettingsRequest } from "../../shared/operator-settings/contract";
import { homeSessionToken } from "./fixtures/session";
import { expectNavigation } from "./fixtures/navigation-budget";

const admin = "0x1111111111111111111111111111111111111111";
const secondAdmin = "0x3333333333333333333333333333333333333333";
const customer = "0x2222222222222222222222222222222222222222";
const settingsPath = "/api/admin/settings/brand";

const brandForm = (page: Page) => page.locator("form[data-brand-settings]:visible");

async function setSession(context: BrowserContext, address: string) {
  await context.addCookies([{
    name: "home-session", value: homeSessionToken(address), domain: "localhost", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);
}

async function openAdmin(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
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

async function resetSavedBrand() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try { await client.query("DELETE FROM operator_settings WHERE domain = 'brand'"); }
  finally { await client.end(); }
}

async function expectOperatorReady(page: Page) {
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
}

async function fill(page: Page, values: { name?: string; description?: string; primary?: string; background?: string }) {
  if (values.name !== undefined) await brandForm(page).getByLabel("Display name", { exact: true }).fill(values.name);
  if (values.description !== undefined) await brandForm(page).getByLabel("Description", { exact: true }).fill(values.description);
  if (values.primary !== undefined) await brandForm(page).getByLabel("Primary color", { exact: true }).fill(values.primary);
  if (values.background !== undefined) await brandForm(page).getByLabel("Background color", { exact: true }).fill(values.background);
}

async function fillAndExpectPreview(page: Page, values: Parameters<typeof fill>[1], expected: string) {
  await expect(async () => {
    for (const [field, label] of [
      ["name", "Display name"], ["description", "Description"], ["primary", "Primary color"], ["background", "Background color"],
    ] as const) {
      if (values[field] !== undefined) await brandForm(page).getByLabel(label, { exact: true }).fill("");
    }
    await fill(page, values);
    await expect(page.getByRole("group", { name: "Customer preview" })).toContainText(expected);
  }).toPass({ timeout: 15_000 });
}

async function save(page: Page, operator: string, revision: number) {
  const sent = page.waitForRequest((request) => new URL(request.url()).pathname === settingsPath && request.method() === "PUT", { timeout: 10_000 }).catch(() => null);
  const clickFailure = await page.getByRole("button", { name: "Save", exact: true }).click({ timeout: 10_000 }).then(() => null, (error: unknown) => error);
  const request = await sent;
  const form = brandForm(page);
  if (clickFailure) throw new Error(`The Save click never completed (the button was not actionable): ${String(clickFailure).split("\n").slice(0, 8).join(" ")}`);
  if (!request) {
    const statuses = await form.getByRole("status").allTextContents().catch(() => []);
    const alerts = await form.getByRole("alert").allTextContents().catch(() => []);
    throw new Error(`Save was clicked but sent no PUT within 10 s: the form shows statuses "${statuses.join(" | ")}", alerts "${alerts.join(" | ")}" and ${await page.locator("form[data-brand-settings]").count()} brand form(s) in the document.`);
  }
  const response = await request.response();
  if (!response) throw new Error(`The Save PUT got no response: ${request.failure()?.errorText ?? "unknown failure"}.`);
  expect(parsePutSettingsRequest(response.request().postDataJSON())).toMatchObject({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, operator, expectedRevision: revision });
  return response;
}

test("Brand edits persist, apply to a fresh customer page and never overwrite silently", { tag: "@smoke" }, async ({ page, context }) => {
  test.setTimeout(120_000);
  await resetSavedBrand();
  await setSession(context, admin);
  const auditBaseline = (await brandAudit(context)).length;
  const puts: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === settingsPath && request.method() === "PUT") puts.push(request.url()); });

  await test.step("Settings links to Brand, which names its deployment-default source", async () => {
    await openAdmin(page, "/admin/settings");
    await page.getByRole("link", { name: /^Brand/ }).click();
    await expectNavigation(page, /\/admin\/settings\/brand$/);
    await expectOperatorReady(page);
    await expect(page.getByRole("heading", { name: "Brand", exact: true, level: 1 })).toBeVisible();
    await expect(brandForm(page).getByText("Using deployment defaults. Nothing is saved yet.", { exact: true })).toBeVisible();
    expect(await readBrand(context)).toMatchObject({ source: "default", revision: 0 });
  });

  await test.step("invalid input blocks the write and keeps the draft; Cancel writes nothing", async () => {
    await fill(page, { name: "   ", primary: "blue" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(brandForm(page).getByText("Enter a display name.", { exact: true })).toBeVisible();
    await expect(brandForm(page).getByText("Enter a color like #0052ff.", { exact: true })).toBeVisible();
    expect(puts).toHaveLength(0);
    await fill(page, { name: "Acme Money", primary: "#0B6B3A" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(brandForm(page).getByLabel("Display name", { exact: true })).toHaveValue("home");
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
    expect(audit).toHaveLength(auditBaseline + 1);
    expect(audit[0]).toMatchObject({ actor: admin, action: "settings.update", after: stored.value });
    await page.reload();
    await expectOperatorReady(page);
    await expect(brandForm(page).getByLabel("Display name", { exact: true })).toHaveValue("Acme Money");
    await expect(brandForm(page).getByLabel("Primary color", { exact: true })).toHaveValue("#0b6b3a");
    await expect(page.getByRole("status").filter({ hasText: /^Saved .+ by 0x.+, revision 1\.$/ })).toBeVisible();
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
    await openAdmin(page, "/admin/settings/brand");
    const concurrent = await context.newPage();
    try {
      await openAdmin(concurrent, "/admin/settings/brand");
      await fillAndExpectPreview(page, { name: "Draft Name" }, "Draft Name");
      await fillAndExpectPreview(concurrent, { description: "Won the race." }, "Won the race.");
      expect((await save(concurrent, admin, 1)).status()).toBe(200);
      const winner = await readBrand(context);
      const auditBefore = await brandAudit(context);
      const rejected = await save(page, admin, 1);
      expect(rejected.status()).toBe(409);
      expect(parseOperatorSettingsErrorResponse(await rejected.json())).toMatchObject({ error: { code: "SETTINGS_CONFLICT" } });
      await expect(page.getByText("Someone else saved brand settings", { exact: false }).first()).toBeVisible();
      await expect(brandForm(page).getByLabel("Display name", { exact: true })).toHaveValue("Draft Name");
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
    await expect(brandForm(page).getByText("A different operator is signed in. Reload this page before saving.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(await readBrand(context)).toEqual(before);
    expect(await brandAudit(context)).toEqual(auditBefore);
    await page.getByRole("button", { name: "Reload page", exact: true }).click();
    await expectOperatorReady(page);
    await expect(brandForm(page).getByLabel("Display name", { exact: true })).toHaveValue("Draft Name");
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

const logoPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("logo, terms and privacy accept https only, and a logo that fails to load falls back to the Home mark", { tag: "@smoke" }, async ({ page, context }) => {
  test.setTimeout(90_000);
  await setSession(context, admin);
  await page.route("https://brand.test/**", (route) => new URL(route.request().url()).pathname === "/logo.png"
    ? route.fulfill({ status: 200, contentType: "image/png", body: logoPng })
    : route.abort());
  const puts: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === settingsPath && request.method() === "PUT") puts.push(request.url()); });
  await page.goto("/admin/settings/brand");
  await expectOperatorReady(page);
  const before = await readBrand(context);

  await brandForm(page).getByLabel("Logo URL", { exact: true }).fill("http://brand.test/logo.png");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(brandForm(page).getByText("Enter a full https:// address, or leave it empty.", { exact: true })).toBeVisible();
  expect(puts).toHaveLength(0);

  await brandForm(page).getByLabel("Logo URL", { exact: true }).fill("https://brand.test/logo.png");
  await brandForm(page).getByLabel("Terms URL", { exact: true }).fill("https://brand.test/terms");
  await brandForm(page).getByLabel("Privacy URL", { exact: true }).fill("https://brand.test/privacy");
  await expect(page.getByRole("group", { name: "Customer preview" }).getByRole("img", { name: before.value.displayName === "home" ? "Home" : before.value.displayName })).toBeVisible();
  expect((await save(page, admin, before.revision)).status()).toBe(200);
  const saved = await readBrand(context);
  expect(saved).toMatchObject({ revision: before.revision + 1, value: { ...before.value, logoUrl: "https://brand.test/logo.png", termsUrl: "https://brand.test/terms", privacyUrl: "https://brand.test/privacy" } });

  await page.goto("/access");
  await expect(page.getByText(saved.value.displayName, { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.locator('[data-home-mark="logo"]').getByRole("img", { name: saved.value.displayName, exact: true }).first()).toHaveAttribute("src", "https://brand.test/logo.png");

  await page.goto("/admin/settings/brand");
  await expectOperatorReady(page);
  await brandForm(page).getByLabel("Logo URL", { exact: true }).fill("https://brand.test/missing.png");
  await brandForm(page).getByLabel("Terms URL", { exact: true }).fill("");
  await brandForm(page).getByLabel("Privacy URL", { exact: true }).fill("  ");
  expect((await save(page, admin, saved.revision)).status()).toBe(200);
  expect((await readBrand(context)).value).toEqual({ ...before.value, logoUrl: "https://brand.test/missing.png", termsUrl: null, privacyUrl: null });

  await page.goto("/");
  await expect(page.locator('[data-home-mark=""]').first()).toBeVisible();
  await expect(page.locator('[data-home-mark="logo"]')).toHaveCount(0);
});

async function holdAppScripts(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const appScript = (url: URL) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js");
  await page.route(appScript, async (route) => { await held; await route.fallback(); });
  return release;
}

test("Settings forms refuse typing until hydrated", { tag: "@smoke" }, async ({ page, context }) => {
  test.setTimeout(120_000);
  await setSession(context, admin);
  await openAdmin(page, "/admin/settings/products");
  await openAdmin(page, "/admin/settings/brand");

  await test.step("Brand fields stay read-only before hydration, then accept typing once ready", async () => {
    const hydrate = await holdAppScripts(page);
    await page.reload({ waitUntil: "commit" });
    const name = page.getByLabel("Display name", { exact: true }).filter({ visible: true });
    await expect(name).toBeVisible();
    const saved = await name.inputValue();
    await name.focus();
    await page.keyboard.type(" typed early");
    await expect(name).toHaveValue(saved);
    await expect(name).not.toBeEditable();
    hydrate();
    await expectOperatorReady(page);
    await expect(name).toBeEditable();
    await name.focus();
    await page.keyboard.press("End");
    await page.keyboard.type(" typed late");
    await expect(name).toHaveValue(`${saved} typed late`);
  });

  await test.step("Products modes are announced read-only before hydration, then editable", async () => {
    const hydrate = await holdAppScripts(page);
    await page.goto("/admin/settings/products", { waitUntil: "commit" });
    const saveMode = page.getByRole("radiogroup", { name: "Save mode", exact: true }).filter({ visible: true });
    await expect(saveMode).toBeVisible();
    await expect(saveMode).toHaveAttribute("aria-readonly", "true");
    hydrate();
    await expectOperatorReady(page);
    await expect(saveMode).not.toHaveAttribute("aria-readonly", "true");
  });
});
