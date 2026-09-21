import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { canaryReach, matchesConfirmLabel, parseFeatureMap, parseReachStep, readFeatureMap } from "./map";

describe("feature map parser", () => {
  test("parses the supported Reach grammar, Live access, and budgets", () => {
    const map = parseFeatureMap(`### \`sample\`\n- **Reach**:\n  1. \`goto "/home"\`\n  2. \`click "Send"\`\n  3. \`fill "To" "0x123"\`\n  4. \`press "Enter"\`\n  5. \`expect "Confirm"\`\n- **Reach (live)**:\n  1. \`goto "/home"\`\n  2. \`expect "Confirm"\`\n  3. \`click "Send $1.00"\`\n- **Live**: confirm\n- **Owned paths**: \`apps/web/client/sample/**\`, \`apps/web/server/sample.ts\`\n- **Confirm labels**: "Send $<amount>", "Retry"\n- **Expect**: ready.\n- **Perf budgets (initial)**: \`shell:paint\` ≤ 1_500 ms.\n`);
    expect(map.get("sample")).toEqual({
      id: "sample",
      reach: [
        { kind: "goto", path: "/home" },
        { kind: "click", label: "Send" },
        { kind: "fill", label: "To", value: "0x123" },
        { kind: "press", key: "Enter" },
        { kind: "expect", text: "Confirm" },
      ],
      liveReach: [
        { kind: "goto", path: "/home" },
        { kind: "expect", text: "Confirm" },
        { kind: "click", label: "Send $1.00" },
      ],
      confirmLabels: ["Send $<amount>", "Retry"],
      ownedPaths: ["apps/web/client/sample/**", "apps/web/server/sample.ts"],
      budgets: { "shell:paint": 1500 },
      manual: false,
      live: "confirm",
    });
  });

  test("provides fixed weekly round-trip reach variants", () => {
    const fallback = [{ kind: "goto" as const, path: "/fallback" }];
    expect(canaryReach("save", "withdraw", fallback)).toContainEqual({ kind: "click", label: "Withdraw $1.00" });
    expect(canaryReach("borrow", "repay", fallback)).toContainEqual({ kind: "click", label: "Repay" });
    expect(canaryReach("send", "send", fallback)).toBe(fallback);
    expect(() => canaryReach("send", "withdraw", fallback)).toThrow("Unsupported canary operation");
  });

  test("matches exact confirm labels with an amount placeholder", () => {
    const labels = ["Send $<amount>", "Retry"];
    expect(matchesConfirmLabel(labels, "Send $1.00")).toBe(true);
    expect(matchesConfirmLabel(labels, "Send $1,234.50")).toBe(true);
    expect(matchesConfirmLabel(["Cash out $<amount>"], "Cash out 1 USDC")).toBe(true);
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
    expect([...surfaces.values()].filter((surface) => surface.ownedPaths.length === 0)).toEqual([]);
    expect(surfaces.get("borrow")?.live).toBe("confirm");
    expect(surfaces.get("send")?.liveReach).toContainEqual({ kind: "fill", label: "To", value: "<recipient>" });
    expect(surfaces.get("save")?.liveReach?.at(-2)).toEqual({ kind: "expect", text: "Confirm" });
    expect(surfaces.get("borrow")?.liveReach?.at(-2)).toEqual({ kind: "expect", text: "Confirm" });
    expect(surfaces.get("cash-out")?.liveReach).toContainEqual({ kind: "click", label: "Send to Zelle, Venmo, Cash App and more Use Peer to send via app" });
    expect(surfaces.get("cash-out")?.liveReach?.at(-1)).toEqual({ kind: "expect", text: "Confirm" });
    expect(surfaces.get("cash-out")?.confirmLabels).toContain("Withdraw $<amount>");
    expect(surfaces.get("add-money")?.liveReach).toContainEqual({ kind: "click", label: "Deposit USD Coinbase · Apple Pay" });
    expect(surfaces.get("add-money")?.liveReach?.at(-1)).toEqual({ kind: "expect", text: "Review quote" });
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
