import { describe, expect, it } from "bun:test";
import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-cdp-auth-", {
  rules: ["no-local-cdp-jwt"],
});

describe("no-local-cdp-jwt", () => {
  it("rejects direct SDK auth access in every static import and re-export form", async () => {
    const cases = [
      'import { generateJwt } from "@coinbase/cdp-sdk/auth";',
      'import { generateJwt as sign } from "@coinbase/cdp-sdk/auth";',
      'import auth from "@coinbase/cdp-sdk/auth";',
      'import * as auth from "@coinbase/cdp-sdk/auth";',
      'import "@coinbase/cdp-sdk/auth";',
      'import type { JwtOptions } from "@coinbase/cdp-sdk/auth";',
      'export * from "@coinbase/cdp-sdk/auth";',
      'export * as auth from "@coinbase/cdp-sdk/auth";',
      'export { generateJwt } from "@coinbase/cdp-sdk/auth";',
      'export { generateJwt as sign } from "@coinbase/cdp-sdk/auth";',
      'void import("@coinbase/cdp-sdk/auth");',
      'void import(`@coinbase/cdp-sdk/auth`);',
      'void import("@coinbase/" + "cdp-sdk/auth");',
      'const auth = require("@coinbase/cdp-sdk/auth");',
      'import auth = require("@coinbase/cdp-sdk/auth");',
      'type Auth = typeof import("@coinbase/cdp-sdk/auth");',
    ];
    const fixtures = Object.fromEntries(cases.map((code, index) => [
      `case${index}`, { code, path: `server/consumer-${index}.ts` },
    ]));
    for (const findings of Object.values(await lint(fixtures))) {
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("home(no-local-cdp-jwt)");
    }
  }, budgetMs);

  it("allows the exact signing owner and callers using its surface", async () => {
    const findings = await lint({
      owner: { path: "server/cdp/auth.ts", code: 'import { generateJwt } from "@coinbase/cdp-sdk/auth";' },
      caller: { path: "server/consumer.ts", code: 'import { signCdpRequest } from "@/server/cdp/auth";' },
      unrelated: { path: "server/unrelated.ts", code: 'import { CdpClient } from "@coinbase/cdp-sdk";' },
    });
    for (const values of Object.values(findings)) expect(values).toHaveLength(0);
  }, budgetMs);

  it("does not authorize a similar basename or nested owner suffix", async () => {
    const findings = await lint({
      similar: { path: "server/cdp/auth-other.ts", code: 'import { generateJwt } from "@coinbase/cdp-sdk/auth";' },
      nested: { path: "other/server/cdp/auth.ts", code: 'import { generateJwt } from "@coinbase/cdp-sdk/auth";' },
    });
    for (const values of Object.values(findings)) expect(values).toHaveLength(1);
  }, budgetMs);
});
