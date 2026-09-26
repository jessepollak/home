import "server-only";

import { afterEach, describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  type Hex,
} from "viem";
import {
  BASE_BUILDER_CODE,
  currencyInfo,
  getContracts,
  getGatingServiceAddress,
  getIntentGuardianContract,
  getPaymentMethodsCatalog,
  getRateManagerContracts,
  getSpreadOracleConfig,
  resolvePaymentMethodHashFromCatalog,
} from "@zkp2p/sdk";
import { BASE_USDC_ADDRESS, CASH_ATTRIBUTION_CODE, buildIntentAmountRange, derivePayouts, normalizeCashPayee } from "@zkp2p/cash";
import { canonicalizeCashPayee } from "@/shared/funding/cash-payee";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createProviderContext } from "../../core/provider-context";
import { peerProvider } from "./adapter";
import { PEER_CREATE_DEPOSIT_ABI, PEER_ESCROW_ABI, PEER_WITHDRAW_ABI } from "./abi";
import {
  PeerOfframpSafetyError,
  assertPeerDepositCall,
  assertPeerWithdrawCall,
  setPeerClientFactoryForTests,
} from "./offramp";
import { PEER_PRODUCTION_CONTRACTS, PEER_SANDBOX_CONTRACTS } from "./manifest";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PAYEE_HASH = `0x${"ab".repeat(32)}` as Hex;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

function context(paymentMethodId = "cashapp") {
  return createProviderContext({
    manifest: peerProvider.manifest,
    region: "US",
    direction: "offramp",
    paymentMethodId,
    env: { PEER_OFFRAMP_ENABLED: "1" },
  });
}

function suffix(codes = [CASH_ATTRIBUTION_CODE, BASE_BUILDER_CODE]): Hex {
  const bytes = new TextEncoder().encode(codes.join(","));
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${body}${bytes.length.toString(16).padStart(2, "0")}00${"8021".repeat(8)}`;
}

function validDepositCall(overrides: Record<string, unknown> = {}) {
  const ctx = context();
  const amount = BigInt(2_000_000);
  const range = buildIntentAmountRange(amount);
  const oracle = getSpreadOracleConfig("USD")!;
  const params = {
    token: BASE_USDC_ADDRESS,
    amount,
    intentAmountRange: range,
    paymentMethods: [resolvePaymentMethodHashFromCatalog("cashapp", getPaymentMethodsCatalog(8453, "production"))],
    paymentMethodData: [{ intentGatingService: ctx.deployment.contracts.intentGatingService, payeeDetails: PAYEE_HASH, data: "0x" }],
    currencies: [[{
      code: currencyInfo.USD.currencyCodeHash,
      minConversionRate: BigInt(1),
      oracleRateConfig: { adapter: oracle.adapter, adapterConfig: oracle.adapterConfig, spreadBps: 0, maxStaleness: oracle.maxStaleness },
    }]],
    delegate: "0x0000000000000000000000000000000000000000",
    intentGuardian: ctx.deployment.contracts.intentGuardian,
    retainOnEmpty: false,
    ...overrides,
  };
  const canonical = encodeFunctionData({ abi: PEER_CREATE_DEPOSIT_ABI, functionName: "createDeposit", args: [params] });
  return {
    ctx,
    amount,
    params,
    call: { to: ctx.deployment.contracts.escrow, data: `${canonical}${suffix().slice(2)}` as Hex, value: "0" },
  };
}

function cashOrder(payeeHash: string = PAYEE_HASH, depositId = `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`) {
  return {
    depositId,
    state: "awaiting-buyer",
    fills: [],
    totalAmount: BigInt(2_000_000), filledAmount: BigInt(0), pendingAmount: BigInt(0), returnedAmount: BigInt(0),
    nextActions: ["withdraw"], updatedAt: NOW_SECONDS, isInFlight: true,
    payouts: [{ platform: "cashapp", platformHash: "0x", currency: "USD", currencyHash: "0x", payeeHash, active: true, pricing: { marketRate: true } }],
    explain: () => "Waiting for a buyer.",
  } as const;
}

function installFakeClients(payeeHash: string = PAYEE_HASH, orders = [cashOrder(payeeHash)]) {
  const valid = validDepositCall();
  const order = orders[0]!;
  const cash = {
    capabilities: () => ({
      environment: "production", chainId: 8453, token: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      amount: { min: BigInt(10_000), recommendedMin: BigInt(1_000_000), max: null },
      platforms: [{ platform: "cashapp", currencies: ["USD"], payeeHint: "Cashtag", requiresIdentityAttestation: false }],
    }),
    estimate: async () => ({ amount: valid.amount, currency: "USD", receiveAmount: 2, asOf: NOW_SECONDS, eta: { seconds: 60 } }),
    orders: async () => orders,
    order: async () => order,
    prepareWithdraw: async () => ({ txs: [withdrawCall("withdrawDeposit")], steps: [] }),
  };
  const sdk = {
    chainId: 8453,
    runtimeEnv: "production",
    escrowV2Address: PEER_PRODUCTION_CONTRACTS.escrow,
    intentGuardianAddress: PEER_PRODUCTION_CONTRACTS.intentGuardian,
    registerPayeeDetails: async () => ({ hashedOnchainIds: [PAYEE_HASH] }),
    prepareCreateDeposit: async () => ({ prepared: { to: valid.call.to, data: valid.call.data, value: BigInt(0), chainId: 8453 } }),
  };
  setPeerClientFactoryForTests(() => ({ environment: "production", cash: cash as never, sdk: sdk as never }));
}

function withdrawCall(name: "pruneExpiredIntents" | "withdrawDeposit") {
  const canonical = encodeFunctionData({ abi: PEER_WITHDRAW_ABI, functionName: name, args: [BigInt(7)] });
  return { to: PEER_PRODUCTION_CONTRACTS.escrow, data: `${canonical}${suffix().slice(2)}` as Hex, value: BigInt(0), chainId: 8453 };
}

afterEach(() => {
  setPeerClientFactoryForTests(null);
  setObservabilityLogWriterForTests();
});

describe("Peer funding provider", () => {
  test("pins published contract sources and keeps environments separated", () => {
    for (const [environment, pinned] of [["production", PEER_PRODUCTION_CONTRACTS], ["staging", PEER_SANDBOX_CONTRACTS]] as const) {
      const contracts = getContracts(8453, environment);
      expect(getAddress(pinned.escrow)).toBe(getAddress(contracts.addresses.escrowV2!));
      expect(getAddress(pinned.intentGuardian)).toBe(getAddress(getIntentGuardianContract(8453, environment).address));
      expect(getAddress(pinned.intentGatingService)).toBe(getAddress(getGatingServiceAddress(8453, environment)));
      expect(getAddress(pinned.rateManager)).toBe(getAddress(getRateManagerContracts(8453, environment).addresses.registry!));
    }
    expect(PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()).not.toBe(PEER_SANDBOX_CONTRACTS.escrow.toLowerCase());
    expect(peerProvider.onramp).toBeUndefined();
  });

  test("queries the production indexer at its GraphQL endpoint when listing orders", async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://indexer.zkp2p.xyz/v1/graphql")) return Response.json({ data: { deposits: [] } });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      await expect(peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: true, onMalformedPayee: "throw" }, context())).resolves.toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests.some((request) => request.startsWith("POST https://indexer.zkp2p.xyz/v1/graphql"))).toBe(true);
    expect(requests.every((request) => request.startsWith("POST https://indexer.zkp2p.xyz/v1/graphql"))).toBe(true);
  });

  test("implements capabilities, estimate, payee registration, order reads, and full withdrawal", async () => {
    installFakeClients();
    const ctx = context();
    await expect(peerProvider.offramp!.capabilities(ctx)).resolves.toMatchObject({ platforms: [{ id: "cashapp", currencies: ["USD"] }] });
    await expect(peerProvider.offramp!.estimate({ amountAtomic: BigInt(2_000_000), platform: "cashapp", currency: "USD" }, ctx)).resolves.toMatchObject({ approximateFiatAmount: "2", etaSeconds: 60 });
    await expect(peerProvider.offramp!.prepareDeposit({ owner: OWNER, amountAtomic: BigInt(2_000_000), platform: "cashapp", currency: "USD", payoutHandle: "$Alice" }, ctx)).resolves.toMatchObject({ payee: { canonicalHandle: "Alice", hash: PAYEE_HASH } });
    await expect(peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: true, onMalformedPayee: "throw" }, ctx)).resolves.toMatchObject([{ state: "awaiting-buyer", canonicalHandle: null, payeeHash: PAYEE_HASH }]);
    await expect(peerProvider.offramp!.readOrder({ owner: OWNER, depositId: cashOrder().depositId }, ctx)).resolves.toMatchObject({ nextActions: ["withdraw"] });
    await expect(peerProvider.offramp!.prepareWithdraw({ owner: OWNER, depositId: cashOrder().depositId }, ctx)).resolves.toMatchObject({ calls: [{ to: PEER_PRODUCTION_CONTRACTS.escrow }] });
  });

  test("derives a legacy payee hash from its canonical handle through the Peer SDK", async () => {
    const calls: unknown[] = [];
    setPeerClientFactoryForTests(() => ({ environment: "production", cash: {} as never,
      sdk: { registerPayeeDetails: async (input: unknown) => {
        calls.push(input);
        return { hashedOnchainIds: [PAYEE_HASH.toUpperCase().replace("0X", "0x")] };
      } } as never }));
    const ctx = context();
    await expect(peerProvider.offramp!.payeeHash({ platform: "cashapp", currency: "USD", canonicalHandle: "Alice" }, ctx))
      .resolves.toBe(PAYEE_HASH);
    expect(calls).toEqual([{ processorNames: ["cashapp"], payeeData: [{ offchainId: "Alice" }] }]);
    await expect(peerProvider.offramp!.payeeHash({ platform: "cashapp", currency: "USD", canonicalHandle: "$Alice" }, ctx))
      .rejects.toBeInstanceOf(PeerOfframpSafetyError);
    expect(calls).toHaveLength(1);
  });

  test("rejects zero or multiple hashes returned for a legacy payee", async () => {
    for (const hashes of [[], [PAYEE_HASH, PAYEE_HASH], ["invalid"]]) {
      setPeerClientFactoryForTests(() => ({ environment: "production", cash: {} as never,
        sdk: { registerPayeeDetails: async () => ({ hashedOnchainIds: hashes }) } as never }));
      await expect(peerProvider.offramp!.payeeHash({ platform: "cashapp", currency: "USD", canonicalHandle: "Alice" }, context()))
        .rejects.toBeInstanceOf(PeerOfframpSafetyError);
    }
  });

  test("pins the SDK unavailable-payee representation", () => {
    const catalog = getPaymentMethodsCatalog(8453, "production");
    const paymentMethodHash = resolvePaymentMethodHashFromCatalog("cashapp", catalog);
    expect(derivePayouts(
      [{ paymentMethodHash, payeeDetailsHash: null }],
      [],
      catalog,
    )).toMatchObject([{ payeeHash: "" }]);
  });

  test("keeps Home's preview canonicalization in parity with the pinned SDK boundary", () => {
    for (const [platform, input] of [["cashapp", "  $$Alice "], ["zelle", " Alice@Example.COM "], ["monzo", " @Alice "]] as const) {
      const sdk = normalizeCashPayee(platform, input);
      expect(typeof sdk === "object" ? sdk.offchainId : null).toBe(canonicalizeCashPayee(platform, input));
    }
  });

  test("excludes only the pinned and historical unavailable-payee rows while preserving valid Home history", async () => {
    const valid = cashOrder();
    const sdkLegacy = cashOrder("", `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8`);
    const historicalLegacy = cashOrder("0x", `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_9`);
    installFakeClients(PAYEE_HASH, [valid, sdkLegacy, historicalLegacy]);
    await expect(peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: true, onMalformedPayee: "throw" }, context())).resolves.toMatchObject([
      { depositId: valid.depositId, payeeHash: PAYEE_HASH },
    ]);
  });

  test("reports skipped malformed payees from the actions list route", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const valid = cashOrder();
    installFakeClients(PAYEE_HASH, [valid, cashOrder("invalid", `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8`)]);

    const orders = await peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: false, onMalformedPayee: "skip" }, context());

    expect(orders).toHaveLength(1);
    expect(orders[0]?.depositId).toBe(valid.depositId);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "funding-order",
      route: "/api/actions",
      code: "OFFRAMP_ORDER_MALFORMED_PAYEE_SKIPPED",
      outcome: "ignored",
      provider: "peer",
      region: "US",
      sandbox: false,
    });
  });

  test("fails closed when a listed row has a malformed non-legacy payee hash", async () => {
    installFakeClients("invalid", [cashOrder("invalid", `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8`)]);
    await expect(peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: true, onMalformedPayee: "throw" }, context())).rejects.toBeInstanceOf(PeerOfframpSafetyError);
  });

  test("keeps direct reads fail-closed for a malformed payee target", async () => {
    const malformed = cashOrder("", `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8`);
    installFakeClients("", [malformed]);
    await expect(peerProvider.offramp!.readOrder({ owner: OWNER, depositId: malformed.depositId }, context())).rejects.toBeInstanceOf(PeerOfframpSafetyError);
  });

  test("retains foreign escrow filtering while listing valid Home history", async () => {
    const valid = cashOrder();
    const foreign = cashOrder(PAYEE_HASH, `${PEER_SANDBOX_CONTRACTS.escrow.toLowerCase()}_8`);
    installFakeClients(PAYEE_HASH, [valid, foreign]);
    await expect(peerProvider.offramp!.listOrders({ owner: OWNER, inFlight: true, onMalformedPayee: "throw" }, context())).resolves.toMatchObject([
      { depositId: valid.depositId, payeeHash: PAYEE_HASH },
    ]);
  });

  test("accepts only the complete reviewed createDeposit tuple and exact ERC-8021 boundary", () => {
    const valid = validDepositCall();
    const expected = { amount: valid.amount, platform: "cashapp", currency: "USD", payeeHash: PAYEE_HASH, ctx: valid.ctx };
    expect(() => assertPeerDepositCall(valid.call, expected)).not.toThrow();

    const mutations: Record<string, unknown>[] = [
      { token: "0x2222222222222222222222222222222222222222" },
      { amount: BigInt(2_000_001) },
      { intentAmountRange: { min: BigInt(2), max: valid.amount } },
      { paymentMethods: [] },
      { paymentMethods: [`0x${"cd".repeat(32)}`] },
      { paymentMethodData: [] },
      { paymentMethodData: [{ intentGatingService: PEER_SANDBOX_CONTRACTS.intentGuardian, payeeDetails: PAYEE_HASH, data: "0x" }] },
      { paymentMethodData: [{ intentGatingService: valid.ctx.deployment.contracts.intentGatingService, payeeDetails: `0x${"cd".repeat(32)}`, data: "0x" }] },
      { currencies: [] },
      { delegate: OWNER },
      { intentGuardian: PEER_SANDBOX_CONTRACTS.intentGuardian },
      { retainOnEmpty: true },
    ];
    for (const mutation of mutations) {
      const malicious = validDepositCall(mutation);
      expect(() => assertPeerDepositCall(malicious.call, expected)).toThrow(PeerOfframpSafetyError);
    }
    expect(() => assertPeerDepositCall({ ...valid.call, to: PEER_SANDBOX_CONTRACTS.escrow }, expected)).toThrow(PeerOfframpSafetyError);
    expect(() => assertPeerDepositCall({ ...valid.call, value: "1" }, expected)).toThrow(PeerOfframpSafetyError);
    expect(() => assertPeerDepositCall({ ...valid.call, data: `${valid.call.data}00` as Hex }, expected)).toThrow(PeerOfframpSafetyError);
  });

  test("validates every withdraw target, id, function, value, and suffix", () => {
    const ctx = context();
    const call = { ...withdrawCall("withdrawDeposit"), value: "0" };
    expect(() => assertPeerWithdrawCall(call, BigInt(7), ctx)).not.toThrow();
    expect(() => assertPeerWithdrawCall({ ...call, to: PEER_SANDBOX_CONTRACTS.escrow }, BigInt(7), ctx)).toThrow();
    expect(() => assertPeerWithdrawCall({ ...call, value: "1" }, BigInt(7), ctx)).toThrow();
    expect(() => assertPeerWithdrawCall(call, BigInt(8), ctx)).toThrow();
    expect(() => assertPeerWithdrawCall({ ...call, data: `${call.data}00` as Hex }, BigInt(7), ctx)).toThrow();
  });

  test("binds withdrawal receipts to the deposit, depositor, and escrow", () => {
    const escrow = PEER_PRODUCTION_CONTRACTS.escrow;
    const event = PEER_ESCROW_ABI.find((item) => item.type === "event" && item.name === "DepositWithdrawn")!;
    const log = (depositId: bigint, depositor: `0x${string}` = OWNER, address: `0x${string}` = escrow, amount = BigInt(750_000)) => ({
      address,
      topics: encodeEventTopics({ abi: [event], eventName: "DepositWithdrawn", args: { depositId, depositor } }) as ReadonlyArray<Hex>,
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    });
    const read = peerProvider.offramp!.withdrawnAmountFromReceipt;
    const input = { owner: OWNER, depositId: `${escrow.toLowerCase()}_7` };
    expect(read({ logs: [log(BigInt(7)), log(BigInt(7), OWNER, escrow, BigInt(250_000))] }, input)).toBe("1000000");
    expect(read({ logs: [log(BigInt(8))] }, input)).toBeNull();
    expect(read({ logs: [log(BigInt(7), "0x2222222222222222222222222222222222222222")] }, input)).toBeNull();
    expect(read({ logs: [log(BigInt(7), OWNER, PEER_SANDBOX_CONTRACTS.escrow)] }, input)).toBeNull();
    expect(read({ logs: [log(BigInt(7))] }, { ...input, depositId: `${escrow}_07` })).toBeNull();
  });

  test("recovers only one owner, Base-USDC, pinned-escrow DepositReceived log", () => {
    const escrow = PEER_PRODUCTION_CONTRACTS.escrow;
    const event = PEER_ESCROW_ABI.find((item) => item.type === "event" && item.name === "DepositReceived")!;
    const log = (depositId: bigint, depositor: `0x${string}` = OWNER, address: `0x${string}` = escrow, token: `0x${string}` = BASE_USDC_ADDRESS,
      amount = BigInt(1_000_000), range = { min: BigInt(1_000_000), max: BigInt(1_000_000) }) => ({
      address,
      topics: encodeEventTopics({ abi: [event], eventName: "DepositReceived", args: { depositId, depositor, token } }) as ReadonlyArray<Hex>,
      data: encodeAbiParameters([
        { type: "uint256" },
        { type: "tuple", components: [{ name: "min", type: "uint256" }, { name: "max", type: "uint256" }] },
        { type: "address" },
        { type: "address" },
      ], [amount, range, "0x0000000000000000000000000000000000000000", PEER_PRODUCTION_CONTRACTS.intentGuardian]),
    });
    const recover = peerProvider.offramp!.depositIdFromReceipt;
    const input = { owner: OWNER, escrow, amountAtomic: "1000000", intentAmountRange: { min: "1000000", max: "1000000" } };
    expect(recover({ logs: [log(BigInt(7))] }, input)).toBe(`${escrow.toLowerCase()}_7`);
    expect(recover({ logs: [log(BigInt(7), "0x2222222222222222222222222222222222222222")] }, input)).toBeNull();
    expect(recover({ logs: [log(BigInt(7), OWNER, escrow, "0x2222222222222222222222222222222222222222")] }, input)).toBeNull();
    expect(recover({ logs: [log(BigInt(7), OWNER, PEER_SANDBOX_CONTRACTS.escrow)] }, input)).toBeNull();
    expect(recover({ logs: [log(BigInt(7), OWNER, escrow, BASE_USDC_ADDRESS, BigInt(2_000_000))] }, input)).toBeNull();
    expect(recover({ logs: [log(BigInt(7), OWNER, escrow, BASE_USDC_ADDRESS, BigInt(1_000_000),
      { min: BigInt(900_000), max: BigInt(1_000_000) })] }, input)).toBeNull();
    expect(recover({ logs: [log(BigInt(7)), log(BigInt(8))] }, input)).toBeNull();
  });
});
