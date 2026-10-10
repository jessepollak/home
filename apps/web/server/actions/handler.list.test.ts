import { expect, test } from "bun:test";
import { readJson } from "@/tests/helpers/read-json";
import { parseRecentActionsPayload, RECENT_ACTIONS_LIMIT, RECENT_ACTIONS_WINDOW_MS } from "@/shared/actions/contracts/list";
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

type ListStore = NonNullable<Parameters<typeof createListActionsHandler>[0]["store"]>;

async function list(rows: ActionRow[], coverage: Partial<ListStore> = {}, parsedCount = rows.length, now = () => new Date(instant)) {
  const handler = createListActionsHandler({
    authorize: async () => Response.json(session),
    store: {
      list: async () => rows,
      recordHandle: async () => { throw new Error("Unexpected handle reconciliation"); },
      recordOutcome: async () => { throw new Error("Unexpected outcome write"); },
      ...coverage,
    },
    refreshCashouts: async () => [],
    now,
  });
  const response = await handler(new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
  expect(response.status).toBe(200);
  const payload = await readJson(response);
  const parsed = parseRecentActionsPayload(payload, session);
  expect(parsed.operations).toHaveLength(parsedCount);
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

function coveredStore(rows: ActionRow[], retained: ActionRow[] = []): Partial<ListStore> {
  return {
    listRecent: async (_owner, cutoff = new Date(instant)) => {
      expect(cutoff).toEqual(new Date(Date.parse(instant) - RECENT_ACTIONS_WINDOW_MS));
      return { rows, capped: false, skipped: false, since: cutoff };
    },
    listRetainedSavingsDepositsCoverage: async (_owner, cutoff) => {
      expect(cutoff).toEqual(new Date(Date.parse(instant) - RECENT_ACTIONS_WINDOW_MS));
      return { rows: retained, capped: false, skipped: false };
    },
  };
}

test("GET /api/actions round-trips exhaustive coverage for the authorized owner", async () => {
  const rows = [row({ kind: "send" })];
  const retained = [row({ id: "22222222-2222-4222-8222-222222222222", kind: "savings-deposit" })];
  const { payload, parsed } = await list(rows, coveredStore(rows, retained));
  const since = Date.parse(instant) - RECENT_ACTIONS_WINDOW_MS;
  expect(payload).toMatchObject({ version: 1, truncated: false, exhaustive: { owner: {
    subject: "owner", address, chainId: 8453, accountProvider: "cdp-embedded",
  }, since: new Date(since).toISOString() } });
  expect(parsed.exhaustive).toEqual({ since });
  expect(parsed.retainedSavingsDeposits).toHaveLength(1);
  expect((await list([], coveredStore([]))).parsed.exhaustive).toEqual({ since });
});

test("GET /api/actions binds one cutoff before both reads without widening it from store coverage", async () => {
  let now = Date.parse(instant);
  const since = now - RECENT_ACTIONS_WINDOW_MS;
  let recentCutoff: Date | undefined;
  let retainedCutoff: Date | undefined;
  const coverage = coveredStore([]);
  coverage.listRecent = async (_owner, cutoff) => {
    recentCutoff = cutoff;
    now += 60_000;
    await Promise.resolve();
    now += 60_000;
    return { rows: [], capped: false, skipped: false, since: new Date(since - 60_000) };
  };
  coverage.listRetainedSavingsDepositsCoverage = async (_owner, cutoff) => {
    retainedCutoff = cutoff;
    return { rows: [], capped: false, skipped: false };
  };
  const { payload, parsed } = await list([], coverage, 0, () => new Date(now));
  expect(recentCutoff).toEqual(new Date(since));
  expect(retainedCutoff).toBe(recentCutoff);
  expect(payload).toMatchObject({ exhaustive: { since: recentCutoff?.toISOString() } });
  expect(parsed.exhaustive).toEqual({ since });
});

test.each(["capped recent", "skipped recent", "capped retained", "skipped retained", "retained failure", "legacy store", "recent coverage only", "retained coverage only", "unpresentable recent", "unpresentable retained"] as const)(
  "GET /api/actions omits exhaustive coverage for %s", async (state) => {
    const valid = row({ kind: "send" });
    const malformed = row({ kind: "send", summary: { ...valid.summary, amounts: [null] } });
    const rows = state === "capped recent" ? Array.from({ length: 100 }, (_, index) => row({ id: String(index), kind: "send" }))
      : [state === "unpresentable recent" ? malformed : valid];
    const coverage = coveredStore(rows, state === "unpresentable retained"
      ? [row({ ...malformed, id: "retained", kind: "savings-deposit" })] : []);
    if (state === "capped recent" || state === "skipped recent") {
      coverage.listRecent = async (_owner, cutoff = new Date(instant)) => ({ rows, capped: state === "capped recent", skipped: state === "skipped recent", since: cutoff });
    }
    if (state === "capped retained" || state === "skipped retained") {
      coverage.listRetainedSavingsDepositsCoverage = async () => ({ rows: [], capped: state === "capped retained", skipped: state === "skipped retained" });
    }
    if (state === "retained failure") coverage.listRetainedSavingsDepositsCoverage = async () => { throw new Error("Retained read failed"); };
    if (state === "legacy store" || state === "retained coverage only") delete coverage.listRecent;
    if (state === "legacy store" || state === "recent coverage only") delete coverage.listRetainedSavingsDepositsCoverage;
    const { payload, parsed } = await list(rows, coverage, state === "unpresentable recent" ? 0 : rows.length);
    expect(payload).not.toHaveProperty("exhaustive");
    expect(parsed.exhaustive).toBeNull();
    if (state === "retained failure") expect(parsed.retainedSavingsDepositsUnavailable).toBe(true);
  },
);
