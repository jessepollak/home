import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseSurface, readFeatureMap } from "./map";

const path = resolve(import.meta.dir, "../../../../../.agents/skills/browser-iteration/surfaces");

test("keeps every non-manual surface's fixture Reach available to the replay", async () => {
  const { surfaces } = await readFeatureMap(path);
  expect([...surfaces.keys()].sort()).toEqual([
    "access-gate", "account-settings", "activity", "add-money", "borrow", "card", "cash-out",
    "coverage", "dev-ui", "home-panel", "invest", "investments", "landing", "operator-console", "save",
    "send", "sign-in", "toasts",
  ]);
  expect([...surfaces.values()].filter((surface) => !surface.manual && !surface.reach.length)).toEqual([]);
  expect(surfaces.get("send")?.reach).toContainEqual({ kind: "fill", label: "To", value: "example.base.eth" });
  const convert = surfaces.get("save")?.variants.find((variant) => variant.name === "convert")?.reach ?? [];
  expect(convert).toContainEqual({ kind: "click-prefix", prefix: "Euro" });
  expect(convert).toContainEqual({ kind: "expect", text: "Max slippage" });
  expect(convert.at(-1)).toEqual({ kind: "expect", text: "Convert $1.25" });
  expect(surfaces.get("save")?.reach).not.toContainEqual({ kind: "click-prefix", prefix: "Euro" });
});

test("rejects a replay Reach heading the parser cannot read", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach (replay: Convert)**:\n  1. `goto \"/cash\"`\n"))
    .toThrow("Invalid or duplicate replay Reach");
});

test("rejects a numbered Reach step the parser cannot read", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `goto \"/cash\"`\n  2. `clik \"Convert\"`\n"))
    .toThrow("Unreadable Reach step: clik \"Convert\"");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `fill \"Amount\"`\n"))
    .toThrow("Unreadable Reach step: fill \"Amount\"");
});

test("keeps prose and uppercase tokens in a reach step", () => {
  const surface = parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`; in-app entry from `/cash/savings`: open a `Manage <vault>` row, then click `Deposit more`; the `vault shares` row, `currency \"US dollar\"` copy and the `value row` follow.\n");
  expect(surface.reach).toEqual([{ kind: "expect", text: "Deposit" }]);
});

test("rejects a numbered Reach step with the wrong number of arguments", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `click \"Convert\" \"More\"`\n"))
    .toThrow("Unreadable Reach step: click \"Convert\" \"More\"");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `fill \"Amount\" \"1\" \"extra\"`\n"))
    .toThrow("Unreadable Reach step");
});

test("rejects a known command with malformed arguments", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `goto /cash`\n"))
    .toThrow("Unreadable Reach step: goto /cash");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`\n  2. `click Convert`\n"))
    .toThrow("Unreadable Reach step: click Convert");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`\n  2. `fil \"Amount\" \"1\"`\n"))
    .toThrow("Unreadable Reach step: fil \"Amount\" \"1\"");
});
