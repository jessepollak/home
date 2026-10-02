import { expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { parseOperatorSupportListResponse } from "@/shared/support/contract";
import { SupportStore } from "./store";

test("inbox previews preserve whole code points within the 140-code-unit contract", async () => {
  for (const [body, preview] of [
    ["a".repeat(139) + "😀z", "a".repeat(139)],
    ["a".repeat(138) + "😀z", "a".repeat(138) + "😀"],
    ["😀".repeat(71), "😀".repeat(70)],
  ]) {
    const sql = { query: async () => ({ rows: [{
      id: "11111111-1111-4111-8111-111111111111", status: "open", handler: "operator",
      last_message_at: new Date("2026-09-27T12:00:00.000Z"), preview: body, author_type: "customer",
      last_customer_message_at: null, operator_read_at: null, label_wallet: null,
    }], rowCount: 1 }) } as unknown as SqlExecutor;
    const response = await new SupportStore(sql).list({ status: "all", limit: 10 });
    expect(response.conversations[0].preview).toBe(preview);
    expect(parseOperatorSupportListResponse(response)).not.toBeNull();
  }
});
