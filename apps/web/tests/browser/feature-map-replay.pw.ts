import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixtureRoutes, requiresSignedInFixture } from "./feature-map/fixtures";
import { conversionFixtureAction, preparedConversionFixture, type ConversionPrepareParams } from "./feature-map/conversion-fixture";

import { readFeatureMap, type ReachStep } from "./feature-map/map";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

const mapPromise = readFeatureMap(resolve(__dirname, "../../../../.agents/skills/browser-iteration/surfaces"));
const replaySurfaceIds = [
  "landing", "sign-in", "home-panel", "activity", "save", "invest", "investments",
  "send", "account-settings", "coverage",
];
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

for (const surfaceId of replaySurfaceIds) {
  test(`feature map: ${surfaceId}`, { tag: surfaceId === "invest" ? "@smoke" : [] }, async ({ page }) => {
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
