import { getAddress } from "viem";
import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "./config";
import { parseBorrowOverview, parseSnapshot } from "./contract";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const market = BORROW_MARKETS[0];
function detail(ref = market) {
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: ref.marketId, morpho: ref.morpho, loanToken: ref.loanToken, collateralToken: ref.collateralToken, oracle: ref.oracle, irm: ref.irm, lltvWad: ref.lltvWad.toString(), rank: ref.rank },
    eligibility: { mode: ref.availability, newRisk: ref.availability === "enabled", reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", fetchedAt: "2026-09-24T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "1", borrowAprWad: "1", totalSupplyAssetsRaw: "1", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "0", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "0", loanBalanceRaw: "0", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
  };
}
function overview() {
  const snapshot = detail();
  return {
    version: "2", chainId: 8453, owner: { address: OWNER, accountProvider: "cdp-embedded" },
    discovery: { status: "partial", sourceBlock: { provider: snapshot.source.provider, blockNumber: snapshot.source.blockNumber, blockHash: snapshot.source.blockHash, blockTimestamp: snapshot.source.blockTimestamp }, candidateCount: 1, verifiedCount: 1, reason: null, fetchedAt: snapshot.source.fetchedAt },
    opportunities: [{ market: snapshot.market, availability: { status: "available", mode: "enabled", reason: null, source: snapshot.source, snapshot } }],
    positions: [],
  };
}

describe("borrow contract versions", () => {
  test("validates each detail market and owner independently", () => {
    for (const ref of BORROW_MARKETS) expect(String(parseSnapshot(detail(ref), OWNER)?.market.id)).toBe(ref.marketId);
    expect(parseSnapshot({ ...detail(), version: "2" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), walletAddress: "0x2222222222222222222222222222222222222222" }, OWNER)).toBeNull();
    expect(parseSnapshot({ ...detail(), market: { ...detail().market, lltvWad: "1" } }, OWNER)).toBeNull();
  });

  test("accepts narrowing an enabled market but rejects widening or mismatched new-risk flags", () => {
    const enabled = BORROW_MARKETS.find((entry) => entry.availability === "enabled");
    if (!enabled) throw new Error("Expected an enabled borrow market fixture.");
    const reduced = { ...detail(enabled), eligibility: { mode: "reducing-only", newRisk: false, reason: null } };
    expect(parseSnapshot(reduced, OWNER)).not.toBeNull();
    const base = overview();
    const narrowed = { ...base, opportunities: [{ market: reduced.market, availability: { ...base.opportunities[0].availability, mode: "reducing-only", snapshot: reduced } }] };
    expect(parseBorrowOverview(narrowed, OWNER)).not.toBeNull();
    expect(parseSnapshot({ ...reduced, eligibility: { ...reduced.eligibility, newRisk: true } }, OWNER)).toBeNull();
    expect(parseBorrowOverview({ ...narrowed, opportunities: [{ ...narrowed.opportunities[0], availability: { ...narrowed.opportunities[0].availability, mode: "enabled" } }] }, OWNER)).toBeNull();
    const restricted = BORROW_MARKETS.find((entry) => entry.availability === "reducing-only");
    if (restricted) expect(parseSnapshot({ ...detail(restricted), eligibility: { mode: "enabled", newRisk: true, reason: null } }, OWNER)).toBeNull();
  });

  test("accepts v2 shared-block available snapshots and no-market null-source envelopes", () => {
    expect(parseBorrowOverview(overview(), OWNER)).not.toBeNull();
    const empty = { ...overview(), discovery: { ...overview().discovery, sourceBlock: null, candidateCount: 0, verifiedCount: 0 }, opportunities: [] };
    expect(parseBorrowOverview(empty, OWNER)).not.toBeNull();
    expect(parseBorrowOverview({ ...empty, version: "1" }, OWNER)).toBeNull();
    expect(parseBorrowOverview({ ...empty, discovery: { ...empty.discovery, sourceBlock: overview().discovery.sourceBlock } }, OWNER)).toBeNull();
  });

  test("rejects owner, identity, source and snapshot divergence", () => {
    const base = overview();
    const valid = (bad: unknown) => parseBorrowOverview(bad, OWNER);
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, snapshot: { ...detail(), walletAddress: "0x2222222222222222222222222222222222222222" } } }] })).toBeNull();
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, snapshot: detail(BORROW_MARKETS[1]) } }] })).toBeNull();
    expect(valid({ ...base, opportunities: [{ ...base.opportunities[0], availability: { ...base.opportunities[0].availability, source: { ...detail().source, blockHash: `0x${"cd".repeat(32)}` } } }] })).toBeNull();
    expect(valid({ ...base, discovery: { ...base.discovery, sourceBlock: { ...base.discovery.sourceBlock, blockNumber: "2" } } })).toBeNull();
    expect(valid({ ...base, discovery: { ...base.discovery, sourceBlock: null } })).toBeNull();
  });
});

test("borrow sources and owner canonicalize valid wire hex and reject invalid hex", () => {
  const owner = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const source = { ...detail().source, blockHash: `0x${"Ab".repeat(32)}` };
  const wire = { ...detail(), walletAddress: owner, source };
  expect(String(parseSnapshot(wire, owner)?.walletAddress)).toBe(owner.toLowerCase());
  expect(String(parseSnapshot(wire, owner)?.source.blockHash)).toBe(`0x${"ab".repeat(32)}`);
  expect(parseSnapshot({ ...wire, walletAddress: owner.replace("A", "a") }, owner)).toBeNull();
  expect(parseSnapshot({ ...wire, source: { ...source, blockHash: "0xzzz" } }, owner)).toBeNull();
  const base = overview();
  const response = structuredClone(base);
  Object.assign(response.owner, { address: owner });
  Object.assign(response.opportunities[0]!.availability.snapshot, { walletAddress: owner });
  expect(String(parseBorrowOverview(response, owner)?.owner.address)).toBe(owner.toLowerCase());
  expect(parseBorrowOverview({ ...response, owner: { ...response.owner, address: owner.replace("A", "a") } }, owner)).toBeNull();
});

describe("borrow missing values never become zero", () => {
  const requiredFields = [
    ["state", "oraclePriceRaw"], ["state", "borrowRatePerSecondWad"], ["state", "borrowAprWad"],
    ["state", "totalSupplyAssetsRaw"], ["state", "totalBorrowAssetsRaw"], ["state", "totalBorrowSharesRaw"],
    ["state", "liquidityAssetsRaw"], ["state", "lastUpdateTimestamp"],
    ["wallet", "collateralBalanceRaw"], ["wallet", "loanBalanceRaw"], ["wallet", "collateralAllowanceRaw"], ["wallet", "loanAllowanceRaw"],
    ["position", "collateralRaw"], ["position", "borrowSharesRaw"], ["position", "debtAssetsRaw"],
    ["position", "rawBorrowCapacityAssetsRaw"], ["position", "borrowCapacityAssetsRaw"],
    ["position", "rawWithdrawableCollateralRaw"], ["position", "withdrawableCollateralRaw"],
  ] as const;

  test("requires readable required decimals and preserves measured zero", () => {
    for (const [group, field] of requiredFields) {
      for (const invalid of [undefined, null, 0, "", "unavailable", "-1", "1.5"]) {
        const snapshot = detail();
        Object.assign(snapshot[group], { [field]: invalid });
        if (invalid === undefined) Reflect.deleteProperty(snapshot[group], field);
        expect(parseSnapshot(snapshot, OWNER)).toBeNull();
        const value = overview();
        value.opportunities[0].availability.snapshot = snapshot;
        expect(parseBorrowOverview(value, OWNER)).toBeNull();
      }
      const snapshot = detail();
      Object.assign(snapshot[group], { [field]: "0" });
      expect(parseSnapshot(snapshot, OWNER)).toMatchObject({ [group]: { [field]: "0" } });
    }
  });

  test.each(["healthFactorWad", "liquidationPriceRaw"] as const)("keeps unknown %s distinct from zero and rejects missing/unreadable data", (field) => {
    const snapshot = detail();
    expect(parseSnapshot(snapshot, OWNER)?.position[field]).toBeNull();
    Object.assign(snapshot.position, { [field]: "0" });
    expect(parseSnapshot(snapshot, OWNER)?.position[field]).toBe("0");
    for (const invalid of [undefined, 0, "", "unknown", "-1"]) {
      Object.assign(snapshot.position, { [field]: invalid });
      if (invalid === undefined) Reflect.deleteProperty(snapshot.position, field);
      expect(parseSnapshot(snapshot, OWNER)).toBeNull();
    }
  });
});

describe("borrow market identity validation", () => {
  test("rejects malformed or divergent market identity in details, opportunities and positions", () => {
    for (const invalid of [
      { id: "0xdead" }, { id: `0x${"zz".repeat(32)}` }, { id: `0x${"00".repeat(32)}` },
      { morpho: OWNER }, { oracle: "0xdead" }, { irm: OWNER }, { lltvWad: "1" }, { rank: 0 },
      { loanToken: { ...market.loanToken, decimals: 0 } },
      { collateralToken: { ...market.collateralToken, address: OWNER } },
    ]) {
      const snapshot = detail();
      Object.assign(snapshot.market, invalid);
      expect(parseSnapshot(snapshot, OWNER)).toBeNull();
      const value = overview();
      Object.assign(value.opportunities[0].market, invalid);
      expect(parseBorrowOverview(value, OWNER)).toBeNull();
      const positionOverview = { ...overview(), positions: [{ ...detail().position, market: snapshot.market, source: snapshot.source }] };
      expect(parseBorrowOverview(positionOverview, OWNER)).toBeNull();
    }
  });

  test("forbids snapshots on unavailable markets", () => {
    const snapshot = detail();
    const base = overview();
    const unavailable = { ...base, discovery: { ...base.discovery, sourceBlock: null, verifiedCount: 0 }, opportunities: [{ market: snapshot.market, availability: { status: "unavailable", mode: "enabled", reason: "unreadable", source: null } }] };
    expect(parseBorrowOverview(unavailable, OWNER)?.opportunities[0].availability).not.toHaveProperty("snapshot");
    expect(parseBorrowOverview({ ...unavailable, opportunities: [{ ...unavailable.opportunities[0], availability: { ...unavailable.opportunities[0].availability, snapshot: undefined } }] }, OWNER)).toBeNull();
  });
});
