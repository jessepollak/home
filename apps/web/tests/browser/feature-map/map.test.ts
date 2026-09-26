import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFeatureMap } from "./map";

const path = resolve(import.meta.dir, "../../../../../.agents/skills/browser-iteration/surfaces");

test("keeps every non-manual surface's fixture Reach available to the replay", async () => {
  const { surfaces } = await readFeatureMap(path);
  expect([...surfaces.keys()].sort()).toEqual([
    "access-gate", "account-settings", "activity", "add-money", "balances", "borrow", "cash-out",
    "coverage", "dev-ui", "home-panel", "invest", "landing", "operator-console", "save",
    "send", "sign-in", "toasts",
  ]);
  expect([...surfaces.values()].filter((surface) => !surface.manual && !surface.reach.length)).toEqual([]);
  expect(surfaces.get("send")?.reach).toContainEqual({ kind: "fill", label: "To", value: "example.base.eth" });
});
