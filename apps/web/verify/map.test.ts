import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { matchesConfirmLabel, parseFeatureMap, parseReachStep, readFeatureMap } from "./map";

describe("feature map parser", () => {
  test("parses the supported Reach grammar, Live access, and budgets", () => {
    const map = parseFeatureMap(`### \`sample\`\n- **Reach**:\n  1. \`goto "/home"\`\n  2. \`click "Send"\`\n  3. \`fill "To" "0x123"\`\n  4. \`press "Enter"\`\n  5. \`expect "Confirm"\`\n- **Live**: confirm\n- **Confirm labels**: "Send $<amount>", "Retry"\n- **Expect**: ready.\n- **Perf budgets (initial)**: \`shell:paint\` ≤ 1_500 ms.\n`);
    expect(map.get("sample")).toEqual({
      id: "sample",
      reach: [
        { kind: "goto", path: "/home" },
        { kind: "click", label: "Send" },
        { kind: "fill", label: "To", value: "0x123" },
        { kind: "press", key: "Enter" },
        { kind: "expect", text: "Confirm" },
      ],
      confirmLabels: ["Send $<amount>", "Retry"],
      budgets: { "shell:paint": 1500 },
      manual: false,
      live: "confirm",
    });
  });

  test("matches exact confirm labels with an amount placeholder", () => {
    const labels = ["Send $<amount>", "Retry"];
    expect(matchesConfirmLabel(labels, "Send $1.00")).toBe(true);
    expect(matchesConfirmLabel(labels, "Send $1,234.50")).toBe(true);
    expect(matchesConfirmLabel(labels, "Retry")).toBe(true);
    expect(matchesConfirmLabel(labels, "Send now")).toBe(false);
    expect(matchesConfirmLabel(labels, "Retry action")).toBe(false);
  });

  test("ignores prose, unsupported commands, and invalid Live values", () => {
    expect(parseReachStep("seed fixtures")).toBeNull();
    expect(parseReachStep('click "Send" extra')).toBeNull();
    expect(parseFeatureMap("### `sample`\n- **Live**: never\n").get("sample")?.live).toBeUndefined();
  });

  test("gives every non-manual surface in the feature map a Reach step", async () => {
    const surfaces = await readFeatureMap(
      resolve(import.meta.dir, "../../../.agents/skills/browser-iteration/feature-map.md"),
    );
    const missing = [...surfaces.values()]
      .filter((surface) => !surface.manual && surface.reach.length === 0)
      .map((surface) => surface.id);

    expect(missing).toEqual([]);
    expect(surfaces.get("borrow")?.live).toBe("confirm");
    expect([...surfaces.values()].filter((surface) => surface.manual).map((surface) => surface.id)).toEqual([
      "borrow",
      "cash-out",
      "add-money",
      "access-gate",
      "dev-ui",
      "toasts",
    ]);
  });
});
