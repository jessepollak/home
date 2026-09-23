import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixtureRoutes, requiresSignedInFixture } from "../../verify/fixtures";
import { readFeatureMap, type ReachStep } from "../../verify/map";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

const mapPromise = readFeatureMap(resolve(__dirname, "../../../../.agents/skills/browser-iteration/feature-map.md"));
const replaySurfaceIds = [
  "landing", "sign-in", "home-panel", "balances", "activity", "save", "invest",
  "send", "account-settings", "coverage",
];
const fixtureSkips: Record<string, string> = {
  borrow: "manual: no /api/borrow market fixtures or prepared borrow action",
  "cash-out": "manual: no Peer provider, payout, or in-flight order fixture",
  "add-money": "manual: the fixture Reach is prose, not machine-readable steps",
  "access-gate": "manual: access-password journey requires its own isolated server configuration",
  "dev-ui": "manual: development-only theme inventory, not a customer journey",
  toasts: "manual: Reach requires completing an action rather than a fixture-backed standalone entry",
};

async function executeReach(page: Page, step: ReachStep) {
  if (step.kind === "goto") return page.goto(step.path);
  if (step.kind === "click") return page.getByRole("button", { name: step.label, exact: true }).click();
  if (step.kind === "fill") return page.getByLabel(step.label, { exact: true }).fill(step.value);
  if (step.kind === "press") return page.keyboard.press(step.key);
  if (step.kind === "expect") {
    const dialog = page.getByRole("dialog").filter({ visible: true });
    const scope = await dialog.count() ? dialog : page;
    return expect(scope.getByText(step.text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
  }
  throw new Error(`Fixture replay does not support click-prefix ${step.prefix}`);
}

test("every mapped surface has an explicit fixture disposition", async () => {
  const { surfaces } = await mapPromise;
  expect([...surfaces.keys()].sort()).toEqual([...replaySurfaceIds, ...Object.keys(fixtureSkips)].sort());
  for (const surface of surfaces.values()) {
    expect(Boolean(fixtureSkips[surface.id]), `${surface.id}: manual disposition`).toBe(surface.manual);
    if (!surface.manual) expect(surface.reach.length, `${surface.id}: machine-readable Reach`).toBeGreaterThan(0);
  }
});

for (const surfaceId of replaySurfaceIds) {
  test(`feature map: ${surfaceId}`, async ({ page }) => {
    const surface = (await mapPromise).surfaces.get(surfaceId);
    expect(surface, `${surfaceId}: mapped surface`).toBeDefined();
    if (!surface) return;
    if (requiresSignedInFixture(surfaceId)) await seedSignedInSession(page);
    await installApiFixtures(page);
    if (surfaceId === "send") {
      for (const [pattern, body] of fixtureRoutes()) {
        if (pattern.startsWith("**/api/transfers/")) {
          await page.route(pattern, (route) => json(route, body));
        }
      }
    }
    for (const [index, step] of surface.reach.entries()) {
      await test.step(`${surfaceId} step ${index + 1}: ${step.kind}`, () => executeReach(page, step));
    }
  });
}

for (const [surfaceId, reason] of Object.entries(fixtureSkips)) {
  test.skip(`feature map: ${surfaceId} — ${reason}`, () => {});
}
