import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { allowedOwnedModuleSpies } from "../policy/owned-module-spies.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-owned-spies-", {
  rules: ["no-owned-module-spies"],
});

async function check(path, code) {
  return (await lint({ fixture: { path, code } })).fixture;
}

describe("no-owned-module-spies", () => {
  it("rejects direct, framework and node spies on owned namespace imports", async () => {
    expect(await check("server/example.test.ts", `
      import { spyOn as spy } from "bun:test";
      import * as local from "./example";
      import * as owned from "@/server/example";
      spyOn(local, "read");
      spy(owned, "read");
      jest.spyOn(owned, "read");
      mock.method(local, "read");
      vi["spyOn"](owned, "read");
    `)).toHaveLength(5);
  }, budgetMs);

  it("allows external namespaces, globals, instances and shadowed names", async () => {
    expect(await check("server/example.test.ts", `
      import * as provider from "provider-sdk";
      import * as owned from "./example";
      spyOn(provider, "read");
      spyOn(globalThis, "fetch");
      const client = new QueryClient();
      jest.spyOn(client, "invalidateQueries");
      function scenario(owned) { spyOn(owned, "read"); }
    `)).toHaveLength(0);
    expect(await check("server/example.ts", 'import * as owned from "./example"; spyOn(owned, "read");')).toHaveLength(0);
  }, budgetMs);

  it("grandfathers only each exact file and specifier, not equivalent paths or new modules", async () => {
    const fixtures = Object.fromEntries([...allowedOwnedModuleSpies].map(([path, sources]) => [path, {
      path, code: [...sources].map((source, index) => `import * as owned${index} from "${source}"; spyOn(owned${index}, "read");`).join("\n")
        + '\nimport * as newOwned from "@/server/unlisted"; spyOn(newOwned, "read");',
    }]));
    const found = await lint(fixtures);
    for (const findings of Object.values(found)) expect(findings).toHaveLength(1);
    const code = 'import * as owned from "@/server/cards/store"; spyOn(owned, "read");';
    expect(await check("nested/app/api/cards/webhooks/bridge/route.test.ts", code)).toHaveLength(1);
    expect(await check("app/api/cards/webhooks/bridge/route.test.ts", 'import * as owned from "../../../../../server/cards/store"; spyOn(owned, "read");')).toHaveLength(1);
  }, budgetMs);
});
