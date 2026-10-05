import { expect, test } from "bun:test";
import { readJson } from "@/tests/helpers/read-json";
import { parseRecentActionsPayload, RECENT_ACTIONS_LIMIT } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createListActionsHandler } from "./handler";
import type { ActionRow } from "./store";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}`;
const instant = "2026-09-15T12:00:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "owner" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded",
};
const withdrawalMetadata = { product: "cashout", operation: "withdraw", depositId: "escrow-1", providerId: "peer", providerName: "Peer",
  environment: "production", platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "0",
  minConversionRate: "1", intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "", escrow: "0x0000000000000000000000000000000000000001" } as const;

function row(changes: Partial<ActionRow> = {}): ActionRow {
  const kind = changes.kind ?? "cash-out-withdraw";
  const metadata = kind === "cash-out-withdraw" ? withdrawalMetadata : kind === "cash-out"
    ? { ...withdrawalMetadata, operation: "deposit" as const, depositId: undefined, canonicalHandle: "alice" } : undefined;
  return {
    id: "11111111-1111-4111-8111-111111111111", owner_key: JSON.stringify(["owner", address, 8453, "cdp-embedded"]),
    account_address: address, provider: "cdp-embedded", kind,
    summary: { title: "Return cash-out funds", amounts: [], warnings: [], expiresAt: instant, metadata }, pending: null,
    created_at: instant, confirmed_at: instant, provider_handle: null, transaction_hash: hash,
    handle_recorded_at: instant, declined_reported_at: null, dispatch_attempt: 0,
    outcome: "succeeded", outcome_source: "chain", settled_at: instant, outcome_recorded_at: instant,
    observed_receipt_transaction_hash: hash.toUpperCase(), observed_receipt_outcome: "succeeded", observed_receipt_block_number: "123",
    ...changes,
  };
}

async function list(rows: ActionRow[]) {
  const handler = createListActionsHandler({
    authorize: async () => Response.json(session),
    store: {
      list: async () => rows,
      recordHandle: async () => { throw new Error("Unexpected handle reconciliation"); },
      recordOutcome: async () => { throw new Error("Unexpected outcome write"); },
    },
    refreshCashouts: async () => [],
    now: () => new Date(instant),
  });
  const response = await handler(new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
  expect(response.status).toBe(200);
  const payload = await readJson(response);
  const parsed = parseRecentActionsPayload(payload, session);
  expect(parsed.operations).toHaveLength(rows.length);
  expect(parsed.incomplete).toBe(false);
  if (rows.length < RECENT_ACTIONS_LIMIT) expect(parsed.truncated).toBe(false);
  return { payload, parsed };
}

test("GET /api/actions always reports version 1 and explicit false or true truncation", async () => {
  expect(await list([])).toMatchObject({ payload: { version: 1, truncated: false, actions: [] }, parsed: { truncated: false } });
  expect(await list([row()])).toMatchObject({ payload: { version: 1, truncated: false }, parsed: { truncated: false } });
  const full = Array.from({ length: RECENT_ACTIONS_LIMIT }, (_, index) => row({ id: String(index), kind: "send" }));
  expect(await list(full)).toMatchObject({ payload: { version: 1, truncated: false }, parsed: { truncated: false } });
  for (const kind of ["cash-out", "cash-out-withdraw"] as const) {
    expect(await list([...full.slice(0, -1), row({ kind })])).toMatchObject({ payload: { version: 1, truncated: true }, parsed: { truncated: true } });
  }
});

test("GET /api/actions emits a withdrawal receipt block for matching succeeded observations", async () => {
  const { payload, parsed } = await list([row()]);
  expect(payload).toMatchObject({ actions: [{ kind: "cash-out-withdraw", status: "confirmed", receiptBlockNumber: "123" }] });
  expect(parsed.operations).toMatchObject([{ action: { kind: "cash-out-withdraw" }, status: "confirmed", receiptBlockNumber: "123" }]);
});

const omittedReceiptBlockCases: [string, Partial<ActionRow>][] = [
  ["mismatched transaction hash", { observed_receipt_transaction_hash: `0x${"cd".repeat(32)}` }],
  ["reverted observation", { observed_receipt_outcome: "reverted" }],
  ["reverted outcome", { outcome: "reverted" }],
  ["missing block", { observed_receipt_block_number: null }],
  ["missing transaction hash", { transaction_hash: null }],
  ["missing observed transaction hash", { observed_receipt_transaction_hash: null }],
  ["non-withdrawal kind", { kind: "send" }],
];

test.each(omittedReceiptBlockCases)("GET /api/actions omits a withdrawal receipt block for %s", async (_label, changes) => {
  const { payload, parsed } = await list([row(changes)]);
  expect(payload).toMatchObject({ version: 1, truncated: false, actions: [expect.not.objectContaining({ receiptBlockNumber: expect.anything() })] });
  expect(parsed.operations[0]?.action.kind).toBe(changes.kind ?? "cash-out-withdraw");
  expect(parsed.operations[0]).not.toHaveProperty("receiptBlockNumber");
});
