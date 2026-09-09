import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import { PostgresMoneyActionStore } from "@/server/money-actions/postgres-store";
import { createFakePostgresExecutor } from "@/server/money-actions/postgres-sql";
import {
  getTradeIntentStore,
  resolveTradeIntentStoreBackend,
  setTradeIntentStoreForTests,
  TradeRuntimeCapabilityError,
} from "./runtime-intent-store";

const originalUrl = process.env.DATABASE_URL;
const originalVercel = process.env.VERCEL;

const OWNER = {
  subject: "trade-user",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;

function restoreEnvironment(): void {
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
}

afterEach(() => {
  setTradeIntentStoreForTests(null);
  restoreEnvironment();
});

describe("trade intent runtime selection", () => {
  test("keeps SQLite for local no-host development and fails closed for hosted or Postgres runtimes", () => {
    expect(resolveTradeIntentStoreBackend({})).toBe("sqlite");
    expect(resolveTradeIntentStoreBackend({ DATABASE_URL: "" })).toBe("sqlite");
    expect(resolveTradeIntentStoreBackend({ VERCEL: "1" })).toBe("hosted-unavailable");
    expect(resolveTradeIntentStoreBackend({ DATABASE_URL: "postgresql://example/home" })).toBe("hosted-unavailable");
  });

  test("returns a typed hosted swap capability error instead of loading SQLite", async () => {
    delete process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    setTradeIntentStoreForTests(null);

    await expect(getTradeIntentStore()).rejects.toMatchObject({
      name: "TradeRuntimeCapabilityError",
      code: "HOSTED_SWAP_UNAVAILABLE",
      capability: "durable-trade-intent-payload-handoff",
    });
    await expect(getTradeIntentStore()).rejects.toBeInstanceOf(TradeRuntimeCapabilityError);
  });

  test("does not statically load the local SQLite adapter on the hosted selection path", () => {
    const source = readFileSync(resolve(import.meta.dir, "runtime-intent-store.ts"), "utf8");
    expect(source).not.toContain('from "./sqlite-intent-store.node"');
    expect(source.indexOf('resolveTradeIntentStoreBackend() === "hosted-unavailable"'))
      .toBeLessThan(source.indexOf('import("./sqlite-intent-store.node")'));
  });
});

test("cross-store swap payload gate remains fail-closed until executable calldata handoff is durable", async () => {
  const executor = createFakePostgresExecutor();
  const issuingStore = new PostgresMoneyActionStore(executor);
  const claimingStore = new PostgresMoneyActionStore(executor);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const claimedAt = new Date(Date.now() + 1000).toISOString();
  const sensitiveAction: PreparedMoneyAction = {
    id: "11111111-1111-4111-8111-111111111111",
    reviewHash: "a".repeat(64),
    owner: OWNER,
    kind: "swap",
    title: "Swap USDC for ETH",
    calls: [{
      to: "0x2222222222222222222222222222222222222222",
      data: "0x1234",
      dataHash: "b".repeat(64),
      value: "0",
    }],
    amounts: [
      { assetId: "base:usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" },
      { assetId: "eth", symbol: "ETH", decimals: 18, amountBaseUnits: "1", direction: "receive" },
    ],
    warnings: ["Review the exact swap before signing."],
    createdAt,
    expiresAt,
    sensitivePayload: true,
    quoteId: "quote-1",
  };
  const durableAction: PreparedMoneyAction = {
    ...sensitiveAction,
    calls: sensitiveAction.calls.map((call) => ({ ...call, data: "0x" as const })),
  };

  await issuingStore.issue(durableAction, {
    sensitiveAction,
    sensitivePayloadExpiresAt: expiresAt,
  });

  await expect(
    claimingStore.claim(OWNER, durableAction.id, durableAction.reviewHash, claimedAt),
  ).resolves.toBeNull();
  expect((await claimingStore.get(OWNER, durableAction.id))?.status).toBe("prepared");
  await expect(
    issuingStore.claim(OWNER, durableAction.id, durableAction.reviewHash, claimedAt),
  ).resolves.toMatchObject({
    disposition: "dispatch",
    action: { calls: [{ data: "0x1234" }] },
  });
});
