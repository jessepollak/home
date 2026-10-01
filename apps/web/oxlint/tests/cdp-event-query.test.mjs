import { describe, expect, test } from "bun:test";
import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { createOxlintWorkspace, budgetMs } from "./helpers/oxlint-workspace.mjs";

applyRuleCheckTimeout();
const workspace = await createOxlintWorkspace("home-cdp-event-query-");

describe("bounded-cdp-event-query", () => {
  test("requires the bounded adapter for literal, template, join and concatenated event scans", async () => {
    const result = await workspace.lint({
      literal: { path: "server/activity/read.ts", code: 'const sql = "SELECT log_id FROM base.events LIMIT 25";' },
      template: { path: "server/activity/other.ts", code: 'const sql = `SELECT log_id FROM base.events WHERE address = ${wallet}`;' },
      join: { path: "server/activity/join.ts", code: 'const sql = \'SELECT x FROM other JOIN "base"."events" ON x = y\';' },
      concatenated: { path: "server/activity/split.ts", code: 'const sql = "SELECT x FROM base." + "events LIMIT 1";' },
      commented: { path: "server/activity/comment.ts", code: 'const sql = "SELECT x FROM /* hint */ base.events LIMIT 1";' },
      lineComment: { path: "server/activity/line.ts", code: 'const sql = `SELECT x FROM -- hint\nbase.events LIMIT 1`;' },
      adapter: { path: "server/chain-data/base-erc20-transfers.ts", code: 'const sql = "SELECT log_id FROM base.events LIMIT 25";' },
      fixture: { path: "server/activity/read.test.ts", code: 'const sql = "SELECT log_id FROM base.events LIMIT 25";' },
      unrelated: { path: "server/activity/local.ts", code: 'const sql = "SELECT x FROM home_actions";' },
    }, { rule: "bounded-cdp-event-query" });
    for (const name of ["literal", "template", "join", "concatenated", "commented", "lineComment"]) expect(result[name]).toHaveLength(1);
    for (const name of ["adapter", "fixture", "unrelated"]) expect(result[name]).toHaveLength(0);
  }, budgetMs);
});
