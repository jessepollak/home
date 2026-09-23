import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseFeatureMap, parseLiveHosts, parseReachStep, readFeatureMap } from "./map";

describe("feature map guidance", () => {
  test("parses only explicit Reach commands, not canary-only blocks", () => {
    expect(parseReachStep('goto "/home"')).toEqual({ kind: "goto", path: "/home" });
    expect(parseReachStep('click "Send"')).toEqual({ kind: "click", label: "Send" });
    expect(parseReachStep('fill "To" "jesse.base.eth"')).toEqual({ kind: "fill", label: "To", value: "jesse.base.eth" });
    expect(parseReachStep("a paragraph")).toBeNull();
    const map = parseFeatureMap('### `send`\n- **Reach**:\n  1. `goto "/home"`\n  2. `click "Send"`\n- **Canary operations**: `click "Cash out"`\n');
    expect(map.surfaces.get("send")?.reach).toEqual([{ kind: "goto", path: "/home" }, { kind: "click", label: "Send" }]);
  });
  test("reads mapped surfaces and approved bare hosts", async () => {
    const map = await readFeatureMap(resolve(import.meta.dir, "../../../.agents/skills/browser-iteration/feature-map.md"));
    expect(map.surfaces.get("send")?.reach[0]).toEqual({ kind: "goto", path: "/home" });
    expect(map.surfaces.get("cash-out")?.manual).toBe(true);
    expect(map.surfaces.size).toBeGreaterThan(10);
    expect(parseLiveHosts('## Live hosts\n- `api.cdp.coinbase.com`\n- `https://evil.test`\n')).toEqual(["api.cdp.coinbase.com"]);
  });
});
