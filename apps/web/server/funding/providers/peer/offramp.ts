import "server-only";

import {
  BASE_USDC_ADDRESS,
  CASH_ATTRIBUTION_CODE,
  MIN_CASHOUT_AMOUNT,
  buildIntentAmountRange,
  createCashClient,
  normalizeCashPayee,
  prepareCashDepositParams,
  type CashClient,
  type CashOrder,
} from "@zkp2p/cash";
import {
  BASE_BUILDER_CODE,
  Zkp2pClient,
  currencyInfo,
  getGatingServiceAddress,
  getIntentGuardianContract,
  getPaymentMethodsCatalog,
  getSpreadOracleConfig,
  resolvePaymentMethodHashFromCatalog,
  type CurrencyType,
} from "@zkp2p/sdk";
import {
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  type Hex,
  type Log,
  type Transport,
} from "viem";
import { base, mainnet, polygon } from "viem/chains";
import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import { canonicalizeCashPayee } from "@/shared/funding/cash-payee";
import type {
  FundingOfframpProvider,
  OfframpContext,
  OfframpOrder,
} from "@/shared/funding/provider-contract";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import { PEER_CREATE_DEPOSIT_ABI, PEER_ESCROW_ABI, PEER_WITHDRAW_ABI } from "./abi";
import {
  PEER_CURATOR_PRODUCTION_ORIGIN,
  PEER_CURATOR_SANDBOX_ORIGIN,
  PEER_INDEXER_ORIGIN,
  PEER_PRODUCTION_CONTRACTS,
  PEER_SANDBOX_CONTRACTS,
} from "./manifest";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const CATALOG_MAX_AGE_SECONDS = 5 * 60;
const ATTRIBUTION_SUFFIX = attributionSuffix([CASH_ATTRIBUTION_CODE, BASE_BUILDER_CODE]);

type PeerEnvironment = "production" | "staging";
type PeerClients = { environment: PeerEnvironment; cash: CashClient; sdk: Zkp2pClient };
type PeerClientFactory = (ctx: OfframpContext) => PeerClients;
let peerClientFactory: PeerClientFactory = createPeerClients;

export class PeerOfframpSafetyError extends Error {
  constructor(message = "Peer returned data outside Home's reviewed cash-out boundary.") {
    super(message);
    this.name = "PeerOfframpSafetyError";
  }
}

export function setPeerClientFactoryForTests(factory: PeerClientFactory | null): void {
  peerClientFactory = factory ?? createPeerClients;
}

export const peerOfframp: FundingOfframpProvider = {
  async capabilities(ctx) {
    const { cash, environment } = clients(ctx);
    const capability = cash.capabilities();
    if (capability.environment !== environment || capability.chainId !== 8453 ||
      capability.token.address.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) fail();
    const allowed = new Map(
      ctx.binding.paymentMethods.map((method) => [method.id.toLowerCase(), method]),
    );
    return {
      platforms: capability.platforms.flatMap((platform) => {
        const manifestMethod = allowed.get(platform.platform.toLowerCase());
        if (!manifestMethod || !platform.currencies.includes(ctx.binding.currency as CurrencyType)) return [];
        if (platform.requiresIdentityAttestation || ["venmo", "paypal", "wise", "alipay", "upi"].includes(platform.platform.toLowerCase())) return [];
        return [{
          id: platform.platform,
          label: manifestMethod.label,
          currencies: [ctx.binding.currency],
          handleHint: platform.payeeHint,
          minimumAmountAtomic: capability.amount.min.toString(10),
          maximumAmountAtomic: null,
          estimateSemantics: "approximate" as const,
          etaSemantics: "historical-not-guaranteed" as const,
          requiresIdentityAttestation: false,
          requiresAccessPolicy: false,
        }];
      }),
      asOf: new Date().toISOString(),
      maxAgeSeconds: CATALOG_MAX_AGE_SECONDS,
    };
  },

  async estimate(input, ctx) {
    assertBinding(input.platform, input.currency, ctx);
    if (input.amountAtomic < MIN_CASHOUT_AMOUNT) fail("The cash-out amount is below Peer's minimum.");
    const result = await clients(ctx).cash.estimate({
      amount: input.amountAtomic,
      currency: input.currency as CurrencyType,
      platform: input.platform,
    });
    if (result.amount !== input.amountAtomic || result.currency !== input.currency || result.stale) fail();
    const range = buildIntentAmountRange(input.amountAtomic);
    return {
      amountAtomic: input.amountAtomic.toString(10),
      currency: input.currency,
      approximateFiatAmount: decimalString(result.receiveAmount),
      minConversionRate: "1",
      intentAmountRange: { min: range.min.toString(10), max: range.max.toString(10) },
      etaSeconds: result.eta?.seconds ?? null,
      asOf: new Date(result.asOf * 1000).toISOString(),
    };
  },

  async prepareDeposit(input, ctx) {
    assertBinding(input.platform, input.currency, ctx);
    if (input.amountAtomic < MIN_CASHOUT_AMOUNT) fail("The cash-out amount is below Peer's minimum.");
    const canonical = normalizeCashPayee(input.platform, input.payoutHandle);
    if (!canonical || typeof canonical !== "object" || typeof canonical.offchainId !== "string" || !canonical.offchainId ||
      canonical.offchainId !== canonicalizeCashPayee(input.platform, input.payoutHandle)) fail("Enter a valid payout handle.");
    const { sdk } = clients(ctx);
    const params = await prepareCashDepositParams(sdk, {
      amount: input.amountAtomic,
      payouts: [{
        processorName: input.platform,
        currency: input.currency as CurrencyType,
        payeeData: { offchainId: canonical.offchainId },
      }],
    });
    if (params.paymentMethodDataOverride?.length !== 1) fail();
    const payeeHash = params.paymentMethodDataOverride[0]?.payeeDetails as Hex | undefined;
    if (!isBytes32(payeeHash)) fail();
    const { prepared } = await sdk.prepareCreateDeposit({
      ...params,
      escrowAddress: ctx.deployment.contracts.escrow,
      intentGuardian: ctx.deployment.contracts.intentGuardian,
      txOverrides: { referrer: [CASH_ATTRIBUTION_CODE] },
    });
    const call = { to: prepared.to, data: prepared.data, value: prepared.value.toString(10) } as MoneyActionCall;
    assertPeerDepositCall(call, {
      amount: input.amountAtomic,
      platform: input.platform,
      currency: input.currency,
      payeeHash,
      ctx,
    });
    return {
      depositCall: call,
      payee: {
        hash: payeeHash,
        canonicalHandle: canonical.offchainId,
        platform: input.platform,
        currency: input.currency,
      },
      accessPolicyPaymentMethods: [],
      requiresIdentityAttestation: false,
    };
  },

  async prepareWithdraw(input, ctx) {
    const { cash } = clients(ctx);
    const owned = await cash.orders(input.owner, { inFlight: false, limit: 100 });
    if (!owned.some((order) => depositIdsMatch(order.depositId, input.depositId, ctx))) fail("The cash-out deposit is not owned by this account.");
    const order = await cash.order(input.depositId);
    if (!order.nextActions.includes("withdraw")) fail("This cash-out is not withdrawable yet.");
    const result = await cash.prepareWithdraw(input.depositId);
    if (result.txs.length < 1 || result.txs.length > 2) fail();
    const depositNumber = parseDepositId(input.depositId, ctx);
    const calls = result.txs.map((tx) => {
      const call = { to: tx.to, data: tx.data, value: tx.value.toString(10) } as MoneyActionCall;
      assertPeerWithdrawCall(call, depositNumber, ctx);
      return call;
    });
    const names = calls.map((call) => decodeFunctionData({ abi: PEER_WITHDRAW_ABI, data: call.data }).functionName);
    if (names.at(-1) !== "withdrawDeposit" || (names.length === 2 && names[0] !== "pruneExpiredIntents")) fail();
    return { calls };
  },

  async readOrder(input, ctx) {
    const { cash } = clients(ctx);
    const owned = await cash.orders(input.owner, { inFlight: false, limit: 100 });
    if (!owned.some((order) => depositIdsMatch(order.depositId, input.depositId, ctx))) fail("The cash-out deposit is not owned by this account.");
    return mapOrder(await cash.order(input.depositId), input.owner, ctx);
  },

  async listOrders(input, ctx) {
    return (await clients(ctx).cash.orders(input.owner, { inFlight: input.inFlight, limit: 100 }))
      .filter((order) => validDepositId(order.depositId, ctx))
      .map((order) => mapOrder(order, input.owner, ctx));
  },

  depositIdFromReceipt(receipt, input) {
    const escrow = input.escrow.toLowerCase();
    const owner = input.owner.toLowerCase();
    const matches = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== escrow) return [];
      try {
        const decoded = decodeEventLog({
          abi: PEER_ESCROW_ABI,
          eventName: "DepositReceived",
          data: log.data,
          topics: log.topics as Log["topics"],
          strict: true,
        });
        const args = decoded.args;
        return args.depositor.toLowerCase() === owner &&
          args.token.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()
          ? [`${escrow}_${args.depositId.toString(10)}`]
          : [];
      } catch {
        return [];
      }
    });
    return matches.length === 1 ? matches[0]! : null;
  },
};

export function assertPeerDepositCall(
  call: MoneyActionCall,
  expected: {
    amount: bigint;
    platform: string;
    currency: string;
    payeeHash: Hex;
    ctx: OfframpContext;
  },
): void {
  const { ctx } = expected;
  if (getAddress(call.to) !== getAddress(ctx.deployment.contracts.escrow) || call.value !== "0" || call.approval) fail();
  const decoded = decodeFunctionData({ abi: PEER_CREATE_DEPOSIT_ABI, data: call.data });
  if (decoded.functionName !== "createDeposit" || decoded.args.length !== 1) fail();
  const params = decoded.args[0] as {
    token: `0x${string}`;
    amount: bigint;
    intentAmountRange: { min: bigint; max: bigint };
    paymentMethods: readonly Hex[];
    paymentMethodData: readonly { intentGatingService: `0x${string}`; payeeDetails: Hex; data: Hex }[];
    currencies: readonly (readonly { code: Hex; minConversionRate: bigint; oracleRateConfig: { adapter: `0x${string}`; adapterConfig: Hex; spreadBps: number; maxStaleness: number } }[])[];
    delegate: `0x${string}`;
    intentGuardian: `0x${string}`;
    retainOnEmpty: boolean;
  };
  const range = buildIntentAmountRange(expected.amount);
  const methodHash = resolvePaymentMethodHashFromCatalog(
    expected.platform,
    getPaymentMethodsCatalog(8453, environmentFromContracts(ctx)),
  );
  const currency = currencyInfo[expected.currency as CurrencyType];
  const oracle = getSpreadOracleConfig(expected.currency as CurrencyType);
  if (!currency || !oracle ||
    getAddress(params.token) !== getAddress(BASE_USDC_ADDRESS) ||
    params.amount !== expected.amount ||
    params.intentAmountRange.min !== range.min || params.intentAmountRange.max !== range.max ||
    params.paymentMethods.length !== 1 || params.paymentMethods[0]?.toLowerCase() !== methodHash.toLowerCase() ||
    params.paymentMethodData.length !== 1 ||
    getAddress(params.paymentMethodData[0]!.intentGatingService) !== getAddress(ctx.deployment.contracts.intentGatingService) ||
    params.paymentMethodData[0]!.payeeDetails.toLowerCase() !== expected.payeeHash.toLowerCase() ||
    params.paymentMethodData[0]!.data !== "0x" ||
    params.currencies.length !== 1 || params.currencies[0]?.length !== 1 ||
    params.currencies[0]![0]!.code.toLowerCase() !== currency.currencyCodeHash.toLowerCase() ||
    params.currencies[0]![0]!.minConversionRate !== BigInt(1) ||
    getAddress(params.currencies[0]![0]!.oracleRateConfig.adapter) !== getAddress(oracle.adapter) ||
    params.currencies[0]![0]!.oracleRateConfig.adapterConfig.toLowerCase() !== oracle.adapterConfig.toLowerCase() ||
    params.currencies[0]![0]!.oracleRateConfig.spreadBps !== 0 ||
    params.currencies[0]![0]!.oracleRateConfig.maxStaleness !== oracle.maxStaleness ||
    getAddress(params.delegate) !== getAddress(ZERO_ADDRESS) ||
    getAddress(params.intentGuardian) !== getAddress(ctx.deployment.contracts.intentGuardian) ||
    params.retainOnEmpty !== false) fail();
  const canonical = encodeFunctionData({ abi: PEER_CREATE_DEPOSIT_ABI, functionName: "createDeposit", args: [params] });
  if (call.data !== `${canonical}${ATTRIBUTION_SUFFIX.slice(2)}`.toLowerCase()) fail("Peer calldata attribution or trailing bytes did not match Home's boundary.");
}

export function assertPeerWithdrawCall(call: MoneyActionCall, depositId: bigint, ctx: OfframpContext): void {
  if (getAddress(call.to) !== getAddress(ctx.deployment.contracts.escrow) || call.value !== "0" || call.approval) fail();
  const decoded = decodeFunctionData({ abi: PEER_WITHDRAW_ABI, data: call.data });
  if ((decoded.functionName !== "pruneExpiredIntents" && decoded.functionName !== "withdrawDeposit") || decoded.args[0] !== depositId) fail();
  const canonical = encodeFunctionData({ abi: PEER_WITHDRAW_ABI, functionName: decoded.functionName, args: [depositId] });
  if (call.data !== `${canonical}${ATTRIBUTION_SUFFIX.slice(2)}`.toLowerCase()) fail("Peer withdrawal contained unexpected attribution or trailing bytes.");
}

function createPeerClients(ctx: OfframpContext): PeerClients {
  const environment = environmentFromContracts(ctx);
  const rpcTransport = http(resolveBaseRpcUrl(), { timeout: 6_000 });
  const origins = new Set(ctx.deployment.apiOrigins);
  const curatorUrl = environment === "production" ? PEER_CURATOR_PRODUCTION_ORIGIN : PEER_CURATOR_SANDBOX_ORIGIN;
  if (!origins.has(curatorUrl) || !origins.has(PEER_INDEXER_ORIGIN)) fail("Peer deployment origins do not match Home's pins.");
  const disabledTransport = disabledForeignRpcTransport();
  const cash = createCashClient({
    environment,
    transport: rpcTransport,
    creationRateTransport: disabledTransport,
    curatorUrl,
    indexerUrl: PEER_INDEXER_ORIGIN,
    features: {},
  });
  const sdk = new Zkp2pClient({
    walletClient: createWalletClient({ chain: base, transport: rpcTransport }),
    chainId: 8453,
    runtimeEnv: environment,
    rpcTransport,
    baseApiUrl: curatorUrl,
    indexerUrl: PEER_INDEXER_ORIGIN,
    timeouts: { api: 6_000 },
  });
  if (!sdk.escrowV2Address || getAddress(sdk.escrowV2Address) !== getAddress(ctx.deployment.contracts.escrow) ||
    !sdk.intentGuardianAddress || getAddress(sdk.intentGuardianAddress) !== getAddress(ctx.deployment.contracts.intentGuardian) ||
    getAddress(getGatingServiceAddress(8453, environment)) !== getAddress(ctx.deployment.contracts.intentGatingService) ||
    getAddress(getIntentGuardianContract(8453, environment).address) !== getAddress(ctx.deployment.contracts.intentGuardian)) fail("Peer SDK deployment does not match Home's selected deployment.");
  return { environment, cash, sdk };
}

function disabledForeignRpcTransport(): Transport {
  return ({ chain }) => ({
    config: { key: "peer-disabled-foreign-rpc", name: "Peer disabled foreign RPC", request: async () => { throw new PeerOfframpSafetyError("This Peer corridor may not use a foreign-chain RPC."); }, retryCount: 0, retryDelay: 0, timeout: 1_000, type: "custom" },
    request: async () => { throw new PeerOfframpSafetyError(`Peer may not use ${chain?.name ?? mainnet.name}/${polygon.name} RPCs for this corridor.`); },
    value: undefined,
  });
}

function clients(ctx: OfframpContext): PeerClients {
  const result = peerClientFactory(ctx);
  if (result.environment !== environmentFromContracts(ctx)) fail("Peer client environment mismatch.");
  return result;
}

function environmentFromContracts(ctx: OfframpContext): PeerEnvironment {
  const escrow = ctx.deployment.contracts.escrow.toLowerCase();
  if (escrow === PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()) return "production";
  if (escrow === PEER_SANDBOX_CONTRACTS.escrow.toLowerCase()) return "staging";
  fail("Peer escrow is not a pinned Home deployment.");
}

function assertBinding(platform: string, currency: string, ctx: OfframpContext): void {
  if (currency !== ctx.binding.currency || !ctx.binding.paymentMethods.some((method) => method.id === platform) || ctx.binding.asset.id !== "base:usdc") fail();
}

function mapOrder(order: CashOrder, owner: `0x${string}`, ctx: OfframpContext): OfframpOrder {
  if (!validDepositId(order.depositId, ctx)) fail();
  const payout = order.payouts?.length === 1 ? order.payouts[0] : undefined;
  const currency = payout?.currency;
  if (!payout || !currency || !/^[A-Z]{3}$/.test(currency)) fail("Peer order payout identity is unavailable.");
  return {
    depositId: order.depositId,
    owner,
    state: order.state,
    platform: payout.platform,
    currency: currency as OfframpOrder["currency"],
    canonicalHandle: null,
    payeeHash: requirePayeeHash(payout.payeeHash),
    amountAtomic: order.totalAmount.toString(10),
    remainingAmountAtomic: (order.totalAmount - order.filledAmount - order.returnedAmount).toString(10),
    nextActions: order.nextActions.includes("withdraw") ? ["withdraw"] : [],
    updatedAt: new Date((order.updatedAt ?? 0) * 1000).toISOString(),
  };
}

function depositIdsMatch(actual: string, expected: string, ctx: OfframpContext): boolean {
  return actual.toLowerCase() === expected.toLowerCase() && validDepositId(actual, ctx);
}

function validDepositId(value: string, ctx: OfframpContext): boolean {
  try {
    return parseDepositId(value, ctx) >= BigInt(0);
  } catch {
    return false;
  }
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function requirePayeeHash(value: unknown): Hex {
  if (!isBytes32(value)) fail("Peer order payee hash is invalid.");
  return value;
}

function parseDepositId(value: string, ctx: OfframpContext): bigint {
  const split = value.lastIndexOf("_");
  if (split < 1 || value.slice(0, split).toLowerCase() !== ctx.deployment.contracts.escrow.toLowerCase()) fail();
  const raw = value.slice(split + 1);
  if (!/^(0|[1-9]\d*)$/.test(raw)) fail();
  return BigInt(raw);
}

function attributionSuffix(codes: readonly string[]): Hex {
  const bytes = new TextEncoder().encode(codes.join(","));
  if (bytes.length > 255) fail();
  const codesHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${codesHex}${bytes.length.toString(16).padStart(2, "0")}00${"8021".repeat(8)}`;
}

function decimalString(value: number): string {
  if (!Number.isFinite(value) || value < 0) fail();
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function fail(message?: string): never {
  throw new PeerOfframpSafetyError(message);
}
