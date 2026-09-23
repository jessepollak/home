import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { canaryReach, readFeatureMap, type ReachStep } from "../../verify/map";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";

const mapPromise = readFeatureMap(resolve(__dirname, "../../../../.agents/skills/browser-iteration/feature-map.md"));
const replaySurfaceIds = [
  "landing", "sign-in", "home-panel", "balances", "activity", "save", "invest",
  "send", "account-settings", "coverage",
];
const fixtureSkips: Record<string, string> = {
  borrow: "manual: no /api/borrow market fixtures or prepared borrow action",
  "cash-out": "manual: no Peer provider, payout, or in-flight order fixture",
  "add-money": "manual: the mapped Reach selects a live Coinbase method; shared fixtures have no Coinbase provider",
  "access-gate": "manual: access-password journey requires its own isolated server configuration",
  "dev-ui": "manual: development-only theme inventory, not a customer journey",
  toasts: "manual: Reach requires completing an action rather than a fixture-backed standalone entry",
};

const signedInSurfaces = new Set([
  "home-panel", "balances", "activity", "save", "invest", "send", "account-settings",
]);

async function executeReach(page: Page, step: ReachStep) {
  if (step.kind === "goto") return page.goto(step.path);
  if (step.kind === "click") return page.getByRole("button", { name: step.label, exact: true }).click();
  if (step.kind === "fill") return page.getByLabel(step.label, { exact: true }).fill(step.value);
  if (step.kind === "press") return page.keyboard.press(step.key);
  if (step.kind === "expect") {
    return expect(page.getByText(step.text).filter({ visible: true }).first()).toBeVisible();
  }
  throw new Error(`Fixture replay does not support click-prefix ${step.prefix}`);
}

function describeStep(step: ReachStep) {
  if (step.kind === "goto") return `goto "${step.path}"`;
  if (step.kind === "click") return `click "${step.label}"`;
  if (step.kind === "click-prefix") return `click-prefix "${step.prefix}"`;
  if (step.kind === "fill") return `fill "${step.label}" "${step.value}"`;
  if (step.kind === "press") return `press "${step.key}"`;
  return `expect "${step.text}"`;
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
    if (signedInSurfaces.has(surfaceId)) await seedSignedInSession(page);
    await installApiFixtures(page);
    if (surfaceId === "send") {
      await page.route("**/api/transfers/recipient-name**", (route) => json(route, {
        version: 1,
        name: "jesse.base.eth",
        address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9",
      }));
      await page.route("**/api/transfers/recent-recipients**", (route) => json(route, {
        version: 1,
        recipients: [{ address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", name: "jesse.base.eth" }],
      }));
    }
    const operation = surfaceId === "save" ? "deposit" : surfaceId === "send" ? "send" : undefined;
    const reach = canaryReach(surfaceId, operation, surface.reach);
    for (const [index, step] of reach.entries()) {
      await test.step(`${surfaceId} step ${index + 1}: ${describeStep(step)}`, () => executeReach(page, step));
    }
  });
}

for (const [surfaceId, reason] of Object.entries(fixtureSkips)) {
  test.skip(`feature map: ${surfaceId} — ${reason}`, () => {});
}
test.skip("canary save/withdraw — shared prepare fixture returns a send action, not a vault withdrawal", () => {});
test.skip("canary borrow/repay — no borrow market or prepared repay fixture", () => {});
test.skip("canary cash-out/cash-out — no Peer payout or prepared offramp fixture", () => {});
test.skip("canary cash-out/withdraw — no in-flight Peer order fixture", () => {});
