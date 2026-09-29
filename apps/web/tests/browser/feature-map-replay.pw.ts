import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixtureRoutes, requiresSignedInFixture } from "./feature-map/fixtures";
import { conversionFixtureAction, preparedConversionFixture, type ConversionPrepareParams } from "./feature-map/conversion-fixture";

import { readFeatureMap, type ReachStep } from "./feature-map/map";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

const mapPromise = readFeatureMap(resolve(__dirname, "../../../../.agents/skills/browser-iteration/surfaces"));
const replaySurfaceIds = [
  "landing", "sign-in", "home-panel", "balances", "activity", "save", "invest", "investments",
  "send", "account-settings", "coverage",
];
const fixtureSkips: Record<string, string> = {
  "operator-console": "manual: signed native operator session and allowlist required; covered by admin.pw.ts",
  borrow: "manual: no /api/borrow market fixtures or prepared borrow action",
  card: "manual: the Card tab requires a server started with BRIDGE_CARDS_ENABLED=1; states are covered by card stories and unit tests",
  "cash-out": "manual: Peer payout preparation and confirmation are not fixture-backed; Activity Cancel is covered in cash-out-cancel.pw.ts",
  "add-money": "manual: the fixture Reach is prose, not machine-readable steps",
  "access-gate": "manual: access-password journey requires its own isolated server configuration",
  "dev-ui": "manual: development-only theme inventory, not a customer journey",
  toasts: "manual: Reach requires completing an action rather than a fixture-backed standalone entry",
};

const variantFixtures: Record<string, (page: Page) => Promise<void>> = {
  "save:convert": async (page) => {
    const routes = fixtureRoutes().filter(([pattern]) => pattern.startsWith("**/api/trades?")).reverse();
    for (const [pattern, body] of routes) await page.route(pattern, (route) => json(route, body));
    await page.route("**/api/actions/prepare", (route) => {
      const body = route.request().postDataJSON() as { kind: string; params: ConversionPrepareParams };
      return body.kind === "trade" ? json(route, preparedConversionFixture(body.params)) : route.fallback();
    });
  },
};

function visibleDialogOr(page: Page) {
  const dialog = page.getByRole("dialog").filter({ visible: true });
  return dialog.count().then((count) => count ? dialog : page);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function executeReach(page: Page, step: ReachStep) {
  if (step.kind === "goto") return page.goto(step.path);
  if (step.kind === "click") return page.getByRole("button", { name: step.label, exact: true }).click();
  if (step.kind === "click-prefix") {
    return (await visibleDialogOr(page)).getByRole("button", { name: new RegExp(`^${escapeRegExp(step.prefix)}`) }).first().click();
  }
  if (step.kind === "fill") return page.getByLabel(step.label, { exact: true }).fill(step.value);
  if (step.kind === "press") return page.keyboard.press(step.key);
  const scope = await visibleDialogOr(page);
  return expect(scope.getByText(step.text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
}

test("every mapped surface has an explicit fixture disposition", async () => {
  const { surfaces } = await mapPromise;
  expect([...surfaces.keys()].sort()).toEqual([...replaySurfaceIds, ...Object.keys(fixtureSkips)].sort());
  for (const surface of surfaces.values()) {
    expect(Boolean(fixtureSkips[surface.id]), `${surface.id}: manual disposition`).toBe(surface.manual);
    if (!surface.manual) expect(surface.reach.length, `${surface.id}: machine-readable Reach`).toBeGreaterThan(0);
    for (const variant of surface.variants) {
      expect(variant.reach.length, `${surface.id} (${variant.name}): machine-readable Reach`).toBeGreaterThan(0);
    }
  }
  const mappedVariants = [...surfaces.values()].flatMap((surface) => surface.variants.map((variant) => `${surface.id}:${variant.name}`));
  expect(mappedVariants.sort()).toEqual(Object.keys(variantFixtures).sort());
  for (const key of mappedVariants) {
    expect(replaySurfaceIds, `${key}: replayed surface`).toContain(key.split(":")[0]);
  }
});

for (const surfaceId of replaySurfaceIds) {
  test(`feature map: ${surfaceId}`, async ({ page }) => {
    const surface = (await mapPromise).surfaces.get(surfaceId);
    expect(surface, `${surfaceId}: mapped surface`).toBeDefined();
    if (!surface) return;
    if (requiresSignedInFixture(surfaceId)) await seedSignedInSession(page);
    await installApiFixtures(page);
    if (surfaceId === "activity") {
      await page.route("**/api/actions", (route) => json(route, { actions: [conversionFixtureAction] }));
    }
    if (surfaceId === "send" || surfaceId === "invest") {
      const routes = fixtureRoutes();
      for (const [pattern, body] of surfaceId === "invest" ? [...routes].reverse() : routes) {
        if ((surfaceId === "send" && pattern.startsWith("**/api/transfers/")) ||
          (surfaceId === "invest" && pattern.startsWith("**/api/trades?"))) {
          await page.route(pattern, (route) => json(route, body));
        }
      }
    }
    for (const [index, step] of surface.reach.entries()) {
      await test.step(`${surfaceId} step ${index + 1}: ${step.kind}`, () => executeReach(page, step));
    }
  });
}

for (const key of Object.keys(variantFixtures)) {
  const [surfaceId, name] = key.split(":");
  test(`feature map: ${surfaceId} (${name})`, async ({ page }) => {
    const variant = (await mapPromise).surfaces.get(surfaceId)?.variants.find((entry) => entry.name === name);
    expect(variant, `${key}: mapped replay Reach`).toBeDefined();
    if (!variant) return;
    if (requiresSignedInFixture(surfaceId)) await seedSignedInSession(page);
    await installApiFixtures(page);
    await variantFixtures[key](page);
    for (const [index, step] of variant.reach.entries()) {
      await test.step(`${key} step ${index + 1}: ${step.kind}`, () => executeReach(page, step));
    }
  });
}

for (const [surfaceId, reason] of Object.entries(fixtureSkips)) {
  test.skip(`feature map: ${surfaceId} — ${reason}`, () => {});
}
