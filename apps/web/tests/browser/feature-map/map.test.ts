import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFeatureMap } from "./map";

const path = resolve(import.meta.dir, "../../../../../.agents/skills/browser-iteration/feature-map.md");

test("keeps every non-manual surface's fixture Reach available to the replay", async () => {
  const { surfaces } = await readFeatureMap(path);
  expect(surfaces.size).toBe(16);
  expect([...surfaces.values()].filter((surface) => !surface.manual && !surface.reach.length)).toEqual([]);
  expect(surfaces.get("send")?.reach).toContainEqual({ kind: "fill", label: "To", value: "example.base.eth" });
});
