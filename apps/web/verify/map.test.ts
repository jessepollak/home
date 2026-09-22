import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { balancesSnapshot, dustCatalogHolding, recognizedCatalogHolding } from "../tests/browser/balances-fixtures";
import { fixtureRoutes } from "./fixtures";
import { bareHostnamePattern, canaryReach, matchesConfirmLabel, parseFeatureMap, parseReachStep, readFeatureMap, type ReachStep } from "./map";


const featureMapPath = resolve(import.meta.dir, "../../../.agents/skills/browser-iteration/feature-map.md");

function reachStepStrings(step: ReachStep): string[] {
  if (step.kind === "fill") return [step.label, step.value];
  if (step.kind === "click") return [step.label];
  if (step.kind === "goto") return [step.path];
  if (step.kind === "press") return [step.key];
  return [step.text];
}

function collectFixtureStrings(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFixtureStrings(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectFixtureStrings(item, found);
  }
  return found;
}

const fixtureVisibleStrings = (() => {
  const found = new Set<string>();
  for (const [pattern, body] of fixtureRoutes()) {
    found.add(pattern);
    collectFixtureStrings(body, found);
  }
  collectFixtureStrings(balancesSnapshot("US"), found);
  found.add(recognizedCatalogHolding("US").name);
  found.add(dustCatalogHolding("US").name);
  return [...found]
    .filter((value) => value.length >= 4 && /\p{L}/u.test(value))
    .map((value) => value.toLowerCase());
})();

describe("feature map parser", () => {
  test("parses the supported Reach grammar, Live access, and budgets", () => {
    const map = parseFeatureMap(`### \`sample\`\n- **Reach**:\n  1. \`goto "/home"\`\n  2. \`click "Send"\`\n  3. \`fill "To" "0x123"\`\n  4. \`press "Enter"\`\n  5. \`expect "Confirm"\`\n- **Reach (live)**:\n  1. \`goto "/home"\`\n  2. \`expect "Confirm"\`\n  3. \`click "Send $1.00"\`\n- **Live**: confirm\n- **Owned paths**: \`apps/web/client/sample/**\`, \`apps/web/server/sample.ts\`\n- **Confirm labels**: "Send $<amount>", "Retry"\n- **Expect**: ready.\n- **Perf budgets (initial)**: \`shell:paint\` ≤ 1_500 ms.\n`);
    expect(map.surfaces.get("sample")).toEqual({
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
    expect(canaryReach("save", "withdraw", fallback)).toContainEqual({ kind: "expect", text: "Withdrawn $1.00" });
    expect(canaryReach("borrow", "repay", fallback)).toContainEqual({ kind: "expect", text: "Repaid $1.00" });
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
    expect(parseFeatureMap("### `sample`\n- **Live**: never\n").surfaces.get("sample")?.live).toBeUndefined();
  });

  test("parses the Live hosts list and ignores non-hostname backticks", () => {
    const map = parseFeatureMap("### `sample`\n- **Reach**:\n  1. `goto \"/home\"`\n## Live hosts\n\nHosts with `apps/web/client/account/basename-profile.ts:9` and `--allow-domain`.\n\n- `API.ENSIDEAS.COM` — Basename lookup.\n- `pay.coinbase.com` — onramp.\n- `not a host` — ignored.\n\n## Surfaces\n");
    expect(map.liveHosts).toEqual(["api.ensideas.com", "pay.coinbase.com"]);
  });

  test("parses the Live expected failures list and ignores unsupported rows", () => {
    const map = parseFeatureMap(`### \`sample\`\n- **Reach**:\n  1. \`goto "/home"\`\n## Live expected failures\n\nFailures that deployments return on every load.\n\n- \`GET /api/session\` 401 — the restore probe runs first (#101).\n- POST /api/example-report 429 — synthetic reporter limit (#102).\n- GET https://api.cdp.coinbase.com/config 404 — optional SDK config.\n- GET /api/session 401 without a reason.\n\n## Surfaces\n`);
    expect(map.liveExpectedFailures).toEqual([
      { method: "GET", url: "/api/session", status: 401, reason: "the restore probe runs first (#101)." },
      { method: "POST", url: "/api/example-report", status: 429, reason: "synthetic reporter limit (#102)." },
      { method: "GET", url: "https://api.cdp.coinbase.com/config", status: 404, reason: "optional SDK config." },
    ]);
  });

  test("declares every observed production request failure in the real feature map", async () => {
    const { liveExpectedFailures } = await readFeatureMap(featureMapPath);
    const rows = liveExpectedFailures.map((entry) => `${entry.method} ${entry.url} ${entry.status}`);
    expect(rows).toContain("GET /api/session 401");
    expect(rows).toContain("GET https://api.cdp.coinbase.com/platform/v2/embedded-wallet-api/projects/75f1f0c7-83bf-47c7-a227-e94bb6d04f83/config 404");
    expect(rows).not.toContain("POST /api/client-performance 401");
    const probe = liveExpectedFailures.find((entry) => entry.method === "GET" && entry.url === "/api/session");
    expect(probe?.reason).toContain("#");
  });

  test("lists the browser-facing live hosts in the real feature map", async () => {
    const { liveHosts } = await readFeatureMap(featureMapPath);
    expect(liveHosts).toContain("api.ensideas.com");
    expect(liveHosts).toContain("pay.coinbase.com");
    expect(liveHosts).toContain("checkout.idrx.co");
    expect(liveHosts.every((host) => bareHostnamePattern.test(host))).toBe(true);
  });

  test("gives every non-manual surface in the feature map a Reach step", async () => {
    const { surfaces } = await readFeatureMap(featureMapPath);
    const missing = [...surfaces.values()]
      .filter((surface) => !surface.manual && surface.reach.length === 0)
      .map((surface) => surface.id);

    expect(missing).toEqual([]);
    expect([...surfaces.values()].filter((surface) => surface.ownedPaths.length === 0)).toEqual([]);
    expect(surfaces.get("borrow")?.live).toBe("confirm");
    expect(surfaces.get("send")?.liveReach).toContainEqual({ kind: "fill", label: "To", value: "<recipient>" });
    expect(surfaces.get("save")?.liveReach?.at(-3)).toEqual({ kind: "expect", text: "Confirm" });
    expect(surfaces.get("save")?.liveReach?.at(-1)).toEqual({ kind: "expect", text: "Deposited $1.00" });
    expect(surfaces.get("borrow")?.liveReach?.at(-3)).toEqual({ kind: "expect", text: "Confirm" });
    expect(surfaces.get("borrow")?.liveReach?.at(-1)).toEqual({ kind: "expect", text: "Borrowed $1.00" });
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

  test("replaces the fixture-backed read-only Reaches with live copy", async () => {
    const { surfaces } = await readFeatureMap(featureMapPath);
    expect(surfaces.get("home-panel")?.liveReach).toEqual([
      { kind: "goto", path: "/home" },
      { kind: "expect", text: "Total balance" },
      { kind: "expect", text: "Your money" },
    ]);
    expect(surfaces.get("balances")?.liveReach).toEqual([
      { kind: "goto", path: "/balances" },
      { kind: "expect", text: "Your money" },
    ]);
    expect(surfaces.get("send")?.liveReach).not.toContainEqual({ kind: "expect", text: "Recognized Coin" });
  });

  test("keeps fixture-visible strings out of every live read-only effective Reach", async () => {
    const { surfaces } = await readFeatureMap(featureMapPath);
    const violations: string[] = [];
    for (const surface of surfaces.values()) {
      if (surface.live !== "read-only") continue;
      for (const step of surface.liveReach ?? surface.reach) {
        for (const value of reachStepStrings(step)) {
          const lowered = value.toLowerCase();
          const fixtureValue = fixtureVisibleStrings.find((candidate) => lowered.includes(candidate));
          if (fixtureValue) violations.push(`${surface.id}: ${value} contains fixture string “${fixtureValue}”`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
