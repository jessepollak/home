import { describe, expect, test } from "bun:test";
import { parseFeatureMap, parseReachStep } from "./map";

describe("feature map parser", () => {
  test("parses the supported Reach grammar and budgets", () => {
    const map = parseFeatureMap(`### \`sample\`\n- **Reach**:\n  1. \`goto "/home"\`\n  2. \`click "Send"\`\n  3. \`fill "To" "0x123"\`\n  4. \`press "Enter"\`\n  5. \`expect "Confirm"\`\n- **Expect**: ready.\n- **Perf budgets (initial)**: \`shell:paint\` ≤ 1_500 ms.\n`);
    expect(map.get("sample")).toEqual({
      id: "sample",
      reach: [
        { kind: "goto", path: "/home" },
        { kind: "click", label: "Send" },
        { kind: "fill", label: "To", value: "0x123" },
        { kind: "press", key: "Enter" },
        { kind: "expect", text: "Confirm" },
      ],
      budgets: { "shell:paint": 1500 },
    });
  });

  test("ignores prose and unsupported commands", () => {
    expect(parseReachStep("seed fixtures")).toBeNull();
    expect(parseReachStep('click "Send" extra')).toBeNull();
  });
});
