import "server-only";

import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
import { base } from "viem/chains";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC } from "@/shared/assets/base";
import type { FiatCurrencyCode } from "@/config/regions";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import type { FundingProviderManifest } from "@/shared/funding/provider-contract";
import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import { getActionsStore, type ActionRow, type ActionsStore } from "@/server/actions/store";
import { moneyActionOwner } from "@/server/money-actions/session";
import { createProviderContext, environmentAvailable, resolveFundingMode, type FundingMode } from "@/server/funding/core/provider-context";
import { canonicalizeCashPayee } from "@/shared/funding/cash-payee";
import { fundingProviders, getFundingProvider } from "@/server/funding/providers";
import { assertPeerDepositCall } from "@/server/funding/providers/peer/offramp";

const APPROVE_ABI = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const ALLOWANCE_ABI = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const UNKNOWN_WINDOW_MS = 15 * 60 * 1000;
const ACTION_EXPIRY_MS = 10 * 60 * 1000;
const USDC_ACTION_ASSET_ID = BASE_USDC.id;

type CashoutInput = {
  providerId: string;
  region: string;
  assetId: string;
  amountBaseUnits: string;
  platform: string;
  currency: FiatCurrencyCode;
  payoutHandle: string;
  canonicalHandleConfirmation: string;
};

type WithdrawInput = {
  providerId: string;
  region: string;
  depositId: string;
};

export type CashoutPreparationDependencies = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: Pick<ActionsStore, "list">;
  now?: () => Date;
  readAllowance?: (owner: `0x${string}`, spender: `0x${string}`, signal?: AbortSignal) => Promise<bigint>;
};

export class CashoutPreparationError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "unavailable"
      | "duplicate-unknown"
      | "order-in-flight"
      | "identity-mismatch"
      | "not-withdrawable",
    message: string,
  ) {
    super(message);
    this.name = "CashoutPreparationError";
  }
}

export async function prepareCashoutAction(
  session: VerifiedAccountSession,
  raw: Record<string, unknown>,
  signal?: AbortSignal,
  dependencies: CashoutPreparationDependencies = {},
): Promise<MoneyActionDraft> {
  if (!session.smartAccount) invalid();
  const input = parseCashoutInput(raw);
  if (!input || input.assetId !== BASE_USDC.fundingId) invalid();
  const amount = BigInt(input.amountBaseUnits);
  if (amount <= BigInt(0)) invalid();
  const provider = getFundingProvider(input.providerId);
  const binding = provider?.manifest.bindings.find((candidate) =>
    candidate.region === input.region && candidate.assetId === input.assetId &&
    candidate.currency === input.currency &&
    candidate.directions.offramp?.paymentMethods.some((method) => method.id === input.platform),
  );
  const direction = binding?.directions.offramp;
  const env = dependencies.env ?? process.env;
  if (!provider?.offramp || !binding || !direction || !environmentAvailable(direction.env, env)) unavailable();
  const sandbox = resolveFundingMode(provider.manifest, "offramp", env) === "sandbox";
  const canonicalHandle = canonicalizeCashPayee(input.platform, input.payoutHandle);
  if (!canonicalHandle || input.canonicalHandleConfirmation !== canonicalHandle) {
    throw new CashoutPreparationError("identity-mismatch", "Confirm the canonical payout handle exactly as shown.");
  }
  const owner = moneyActionOwner(session);
  if (!owner) unavailable();
  const now = dependencies.now?.() ?? new Date();
  const rows = await (dependencies.store ?? getActionsStore()).list(owner);
  if (hasRecentHashlessCashout(rows, now)) {
    throw new CashoutPreparationError("duplicate-unknown", "A recent cash-out has no transaction hash yet. Check Activity and wait up to 15 minutes before preparing another deposit.");
  }
  const ctx = createProviderContext({
    manifest: provider.manifest,
    region: binding.region,
    direction: "offramp",
    paymentMethodId: input.platform,
    env,
    sandbox,
  });
  const catalog = await provider.offramp.capabilities(ctx);
  if (Date.parse(catalog.asOf) + catalog.maxAgeSeconds * 1000 < now.getTime()) unavailable();
  const capability = catalog.platforms.find((item) => item.id === input.platform && item.currencies.includes(input.currency));
  if (!capability || capability.requiresAccessPolicy || capability.requiresIdentityAttestation ||
    amount < BigInt(capability.minimumAmountAtomic) ||
    (capability.maximumAmountAtomic !== null && amount > BigInt(capability.maximumAmountAtomic))) unavailable();
  const existingOrders = await provider.offramp.listOrders({ owner: session.smartAccount.address, inFlight: true }, ctx);
  if (existingOrders.length > 0) {
    throw new CashoutPreparationError("order-in-flight", "This account already has an in-flight Peer cash-out. Resume or withdraw it before creating another deposit.");
  }
  const estimate = await provider.offramp.estimate({ amountAtomic: amount, platform: input.platform, currency: input.currency }, ctx);
  if (estimate.amountAtomic !== input.amountBaseUnits || estimate.currency !== input.currency ||
    estimate.minConversionRate !== "1" || BigInt(estimate.intentAmountRange.max) !== amount) unavailable();
  const prepared = await provider.offramp.prepareDeposit({
    owner: session.smartAccount.address,
    amountAtomic: amount,
    platform: input.platform,
    currency: input.currency,
    payoutHandle: canonicalHandle,
  }, ctx);
  if (prepared.accessPolicyPaymentMethods.length !== 0 || prepared.requiresIdentityAttestation ||
    prepared.payee.canonicalHandle !== canonicalHandle || prepared.payee.platform !== input.platform || prepared.payee.currency !== input.currency) unavailable();
  // The generic core treats SDK calldata as hostile and repeats every money-relevant assertion.
  assertPeerDepositCall(prepared.depositCall, {
    amount,
    platform: input.platform,
    currency: input.currency,
    payeeHash: prepared.payee.hash,
    ctx,
  });
  const allowance = await (dependencies.readAllowance ?? readAllowance)(session.smartAccount.address, ctx.deployment.contracts.escrow, signal);
  const calls = [];
  if (allowance < amount) {
    calls.push({
      to: BASE_USDC.address.toLowerCase() as `0x${string}`,
      data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [ctx.deployment.contracts.escrow, amount] }),
      value: "0",
      approval: { assetId: USDC_ACTION_ASSET_ID, spender: ctx.deployment.contracts.escrow },
    });
  }
  calls.push(prepared.depositCall);
  return {
    kind: "cash-out",
    title: "Cash out with Peer",
    calls,
    amounts: [{ assetId: USDC_ACTION_ASSET_ID, symbol: BASE_USDC.symbol, decimals: BASE_USDC.decimals, amountBaseUnits: amount.toString(10), direction: "spend" }],
    warnings: [
      `Payout app: ${direction.paymentMethods.find((method) => method.id === input.platform)?.label ?? input.platform}`,
      `Payout handle: ${canonicalHandle}`,
      `Approximate receive: ≈ ${estimate.approximateFiatAmount} ${input.currency}; the rate and ETA are not guaranteed.`,
      "USDC remains in Peer escrow until a buyer completes payment or you withdraw the unfilled balance.",
    ],
    expiresAt: new Date(now.getTime() + ACTION_EXPIRY_MS).toISOString(),
    metadata: {
      product: "cashout",
      operation: "deposit",
      providerId: provider.manifest.id,
      providerName: provider.manifest.displayName,
      environment: sandbox ? "sandbox" : "production",
      platform: input.platform,
      platformLabel: direction.paymentMethods.find((method) => method.id === input.platform)?.label ?? input.platform,
      currency: input.currency,
      canonicalHandle,
      approximateFiatAmount: estimate.approximateFiatAmount,
      etaSeconds: estimate.etaSeconds,
      minConversionRate: estimate.minConversionRate,
      intentAmountRange: estimate.intentAmountRange,
      estimateAsOf: estimate.asOf,
      escrow: ctx.deployment.contracts.escrow,
    },
  };
}

export async function prepareCashoutWithdrawAction(
  session: VerifiedAccountSession,
  raw: Record<string, unknown>,
  dependencies: Pick<CashoutPreparationDependencies, "env" | "now"> = {},
): Promise<MoneyActionDraft> {
  if (!session.smartAccount) invalid();
  const input = parseWithdrawInput(raw);
  if (!input) invalid();
  const provider = getFundingProvider(input.providerId);
  const binding = provider?.manifest.bindings.find((candidate) =>
    candidate.region === input.region && candidate.assetId === BASE_USDC.fundingId && candidate.directions.offramp,
  );
  const method = binding?.directions.offramp?.paymentMethods[0];
  const env = dependencies.env ?? process.env;
  // Recovery stays available after discovery/preparation is disabled so owners
  // can withdraw USDC already held by the pinned escrow.
  if (!provider?.offramp || !binding || !method) unavailable();
  const currentMode = resolveFundingMode(provider.manifest, "offramp", env);
  const mode = modeForDeposit(provider.manifest, input.depositId) ?? currentMode;
  const sandbox = mode === "sandbox";
  const recoveryEnv = {
    ...env,
    ...Object.fromEntries(binding.directions.offramp!.env.filter((name) => name.endsWith("_ENABLED")).map((name) => [name, "1"])),
  };
  const ctx = createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "offramp", paymentMethodId: method.id, env: recoveryEnv, sandbox });
  const order = await provider.offramp.readOrder({ owner: session.smartAccount.address, depositId: input.depositId }, ctx);
  if (!order.nextActions.includes("withdraw")) throw new CashoutPreparationError("not-withdrawable", "This cash-out cannot be withdrawn yet.");
  const prepared = await provider.offramp.prepareWithdraw({ owner: session.smartAccount.address, depositId: input.depositId }, ctx);
  if (prepared.calls.length < 1 || prepared.calls.length > 2) unavailable();
  const now = dependencies.now?.() ?? new Date();
  return {
    kind: "cash-out-withdraw",
    title: "Withdraw cash-out",
    calls: [...prepared.calls],
    amounts: [{ assetId: USDC_ACTION_ASSET_ID, symbol: BASE_USDC.symbol, decimals: BASE_USDC.decimals, amountBaseUnits: order.remainingAmountAtomic, direction: "receive" }],
    warnings: ["This fully closes the available Peer deposit and returns unfilled USDC to your Home account."],
    expiresAt: new Date(now.getTime() + ACTION_EXPIRY_MS).toISOString(),
    metadata: {
      product: "cashout", operation: "withdraw", providerId: provider.manifest.id, providerName: provider.manifest.displayName,
      environment: sandbox ? "sandbox" : "production", platform: order.platform,
      platformLabel: binding.directions.offramp?.paymentMethods.find((candidate) => candidate.id === order.platform)?.label ?? order.platform,
      currency: order.currency, approximateFiatAmount: "0", etaSeconds: null, minConversionRate: "1",
      intentAmountRange: { min: order.remainingAmountAtomic, max: order.remainingAmountAtomic },
      estimateAsOf: order.updatedAt, escrow: ctx.deployment.contracts.escrow, depositId: order.depositId,
    },
  };
}

export async function listCashoutOrders(
  session: VerifiedAccountSession,
  input: { providerId?: string; region: string; inFlight?: boolean; recover?: boolean },
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { store?: Pick<ActionsStore, "hasCashoutHistory" | "cashoutRecoveryModes"> } = {},
) {
  const actionOwner = moneyActionOwner(session);
  if (!session.smartAccount || !actionOwner) unavailable();
  const owner = session.smartAccount.address;
  const store = dependencies.store ?? getActionsStore();
  const hasHistory = await store.hasCashoutHistory(actionOwner);
  const historicalModes = hasHistory ? await store.cashoutRecoveryModes(actionOwner) : [];
  const candidates = fundingProviders.flatMap((provider) => {
    if (input.providerId && provider.manifest.id !== input.providerId) return [];
    const offramp = provider.offramp;
    if (!offramp) return [];
    const currentMode = resolveFundingMode(provider.manifest, "offramp", env);
    return provider.manifest.bindings.flatMap((binding) => {
      const direction = binding.directions.offramp;
      const method = direction?.paymentMethods[0];
      if (binding.region !== input.region || !direction || !method) return [];
      const requiredCredentials = direction.env.filter((name) => !name.endsWith("_ENABLED"));
      if (!environmentAvailable(requiredCredentials, env)) return [];
      const enabled = environmentAvailable(direction.env, env);
      if (!enabled && !hasHistory && !input.recover) return [];
      const modes = supportedRecoveryModes(provider.manifest, [currentMode, ...historicalModes]);
      return modes.map((mode) => ({ provider, offramp, binding, direction, method, mode }));
    });
  });
  if (input.providerId && candidates.length === 0 && (hasHistory || input.recover)) unavailable();
  const recoveryEnv = {
    ...env,
    ...Object.fromEntries(candidates.flatMap(({ direction }) =>
      direction.env.filter((name) => name.endsWith("_ENABLED")).map((name) => [name, "1"]),
    )),
  };
  const results = await Promise.all(candidates.map(async ({ provider, offramp, binding, method, mode }) => {
    const ctx = createProviderContext({
      manifest: provider.manifest,
      region: binding.region,
      direction: "offramp",
      paymentMethodId: method.id,
      env: recoveryEnv,
      sandbox: mode === "sandbox",
    });
    const orders = await offramp.listOrders({ owner, inFlight: input.inFlight }, ctx);
    return orders.map((order) => ({
      providerId: provider.manifest.id,
      providerName: provider.manifest.displayName,
      assetId: binding.assetId,
      assetSymbol: ctx.binding.asset.symbol,
      assetDecimals: ctx.binding.asset.decimals,
      depositId: order.depositId,
      state: order.state,
      platform: order.platform,
      platformLabel: ctx.binding.paymentMethods.find((candidate) => candidate.id === order.platform)?.label ?? order.platform,
      currency: order.currency,
      canonicalHandle: order.canonicalHandle,
      amountAtomic: order.amountAtomic,
      remainingAmountAtomic: order.remainingAmountAtomic,
      nextActions: order.nextActions,
    }));
  }));
  return {
    recoveryEligible: hasHistory,
    orders: [...new Map(results.flat().map((order) => [`${order.providerId}:${order.depositId}`, order])).values()],
  };
}

function supportedRecoveryModes(
  manifest: FundingProviderManifest,
  modes: ReadonlyArray<FundingMode>,
): FundingMode[] {
  return [...new Set(modes)].filter((mode) => mode === "production" || Boolean(manifest.offramp?.sandbox));
}

function modeForDeposit(
  manifest: FundingProviderManifest,
  depositId: string,
): FundingMode | null {
  const escrow = depositId.split("_")[0]?.toLowerCase();
  if (!escrow) return null;
  if (manifest.offramp?.sandbox?.contracts.escrow.toLowerCase() === escrow) return "sandbox";
  if (manifest.offramp?.production.contracts.escrow.toLowerCase() === escrow) return "production";
  return null;
}

export function hasRecentHashlessCashout(rows: readonly ActionRow[], now: Date): boolean {
  return rows.some((row) => row.kind === "cash-out" && row.confirmed_at !== null && row.transaction_hash === null &&
    now.getTime() - new Date(row.confirmed_at).getTime() < UNKNOWN_WINDOW_MS);
}

async function readAllowance(owner: `0x${string}`, spender: `0x${string}`, signal?: AbortSignal): Promise<bigint> {
  return await createPublicClient({ chain: base, transport: http(resolveBaseRpcUrl()) }).readContract({
    address: BASE_USDC.address,
    abi: ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, spender],
    blockTag: "safe",
    ...(signal ? { signal } : {}),
  } as never) as bigint;
}

function parseCashoutInput(value: Record<string, unknown>): CashoutInput | null {
  const keys = ["providerId", "region", "assetId", "amountBaseUnits", "platform", "currency", "payoutHandle", "canonicalHandleConfirmation"];
  if (Object.keys(value).some((key) => !keys.includes(key)) || !keys.every((key) => typeof value[key] === "string")) return null;
  if (!/^(?:[1-9]\d*)$/.test(value.amountBaseUnits as string) || !/^[A-Z]{3}$/.test(value.currency as string)) return null;
  return value as CashoutInput;
}
function parseWithdrawInput(value: Record<string, unknown>): WithdrawInput | null {
  if (Object.keys(value).some((key) => !["providerId", "region", "depositId"].includes(key)) ||
    typeof value.providerId !== "string" || typeof value.region !== "string" || typeof value.depositId !== "string") return null;
  return value as WithdrawInput;
}
function invalid(): never { throw new CashoutPreparationError("invalid-input", "Choose a valid Peer corridor, payout handle, and exact USDC amount."); }
function unavailable(): never { throw new CashoutPreparationError("unavailable", "Peer cash-out is unavailable for this selection."); }
