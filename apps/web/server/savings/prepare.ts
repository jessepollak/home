import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  MoneyActionDraft,
  SavingsMoneyActionMetadata,
} from "@/shared/money-actions/types";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  getVerifiedSaveVault,
  isSaveActionAllowed,
} from "@/shared/savings/config";
import { isSavingsMetadata } from "@/shared/savings/review";
import type {
  Address,
  MorphoVaultsResult,
} from "@/shared/savings/types";
import {
  CoinbaseSmartAccountBatchSimulationError,
  getBaseCoinbaseSmartAccountBatch,
} from "@/server/chain/coinbase-smart-account";
import {
  SavingsActionAbiError,
  encodeApproveCall,
  encodeDepositCall,
  encodeWithdrawCall,
} from "./abi";
import {
  SAVINGS_ACTION_RPC_RETRY_DELAY_MS,
  SavingsActionRpcError,
  getSavingsActionState,
} from "./rpc";
import type {
  PrepareSavingsAction,
  SavingsActionBatchSimulator,
  SavingsActionInput,
  SavingsActionStateReader,
} from "./types";
import { getMorphoVaultCandidates } from "@/server/morpho";

const ACTION_VALIDITY_MS = 5 * 60_000;
const WAD = BigInt("1000000000000000000");
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const integerPattern = /^(?:0|[1-9][0-9]*)$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const RATE_LIMITED_RPC_CODES = new Set([-32016, -32005]);

export type SavingsActionErrorReason =
  | "invalid-input"
  | "unsupported-vault"
  | "unsupported-asset"
  | "limit-exceeded"
  | "rpc"
  | "rate-limited"
  | "unavailable";

export class SavingsActionError extends Error {
  readonly reason: SavingsActionErrorReason;

  constructor(reason: SavingsActionErrorReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SavingsActionError";
    this.reason = reason;
  }
}

export function createPrepareSavingsAction(options: {
  readState?: SavingsActionStateReader;
  simulateBatch?: SavingsActionBatchSimulator;
  now?: () => Date;
  retryDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readVaults?: (signal?: AbortSignal) => Promise<MorphoVaultsResult>;
} = {}): PrepareSavingsAction {
  const readState = options.readState ?? getSavingsActionState;
  const simulateBatch = options.simulateBatch ??
    getBaseCoinbaseSmartAccountBatch.simulateBatch;
  const now = options.now ?? (() => new Date());
  const retryDelayMs = options.retryDelayMs ?? SAVINGS_ACTION_RPC_RETRY_DELAY_MS;
  const sleep = options.sleep ?? wait;
  const readVaults = options.readVaults;

  return async function prepareSavingsAction({ session, action, signal }) {
    const accountAddress = verifiedAccountAddress(session);
    const normalizedAction = normalizeAction(action);
    const amount = BigInt(normalizedAction.amountBaseUnits);

    const readInput = {
      kind: normalizedAction.kind,
      accountAddress,
      vaultAddress: normalizedAction.vaultAddress,
      amount,
    };
    let state;
    try {
      state = await readState(readInput, signal);
    } catch (error) {
      const mapped = mapReadStateError(error);
      if (mapped.reason !== "rpc" && mapped.reason !== "rate-limited") throw mapped;
      if (mapped.reason === "rate-limited" && retryDelayMs > 0) {
        await sleep(retryDelayMs, signal);
      }
      try {
        state = await readState(readInput, signal);
      } catch (retryError) {
        throw mapReadStateError(retryError);
      }
    }

    if (state.assetAddress.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) {
      throw new SavingsActionError(
        "unsupported-asset",
        "The configured vault no longer reports canonical Base USDC as its asset.",
      );
    }
    if (!Number.isInteger(state.shareDecimals) || state.shareDecimals < 0 || state.shareDecimals > 255) {
      throw new SavingsActionError("unavailable", "The vault share precision is invalid.");
    }
    if (state.fee < BigInt(0) || state.fee > WAD) {
      throw new SavingsActionError("unavailable", "The vault fee is outside the supported range.");
    }
    if (state.previewShares <= BigInt(0)) {
      throw new SavingsActionError(
        "limit-exceeded",
        "The requested amount does not produce a positive vault share amount at the source block.",
      );
    }

    const preparedAt = now();
    if (Number.isNaN(preparedAt.getTime())) {
      throw new SavingsActionError("unavailable", "The action preparation time is invalid.");
    }
    const expiresAt = new Date(preparedAt.getTime() + ACTION_VALIDITY_MS).toISOString();
    const metadata = await createReviewMetadata(
      normalizedAction,
      state,
      preparedAt,
      readVaults,
      signal,
    );

    const draft = normalizedAction.kind === "deposit"
      ? prepareDeposit(normalizedAction, accountAddress, amount, state, expiresAt, metadata)
      : prepareWithdrawal(normalizedAction, accountAddress, amount, state, expiresAt, metadata);

    const simulationSource = {
      blockNumber: state.block.number,
      blockHash: state.block.hash,
    };
    try {
      await simulateBatch(draft.calls, accountAddress, simulationSource, signal);
    } catch (error) { // oxlint-disable-line home/no-silent-catch -- a rate-limited simulation retries once; a retried failure throws and a retried success continues
      const mapped = mapSimulationError(error);
      if (mapped.reason !== "rate-limited") throw mapped;
      if (retryDelayMs > 0) await sleep(retryDelayMs, signal);
      try {
        await simulateBatch(draft.calls, accountAddress, simulationSource, signal);
      } catch (retryError) {
        throw mapSimulationError(retryError);
      }
    }
    return draft;
  };
}

export const prepareSavingsAction = createPrepareSavingsAction({
  readVaults: (signal) => getMorphoVaultCandidates({ signal }),
});

function prepareDeposit(
  action: SavingsActionInput,
  account: Address,
  amount: bigint,
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  expiresAt: string,
  metadata: SavingsMoneyActionMetadata,
): MoneyActionDraft {
  if (amount > state.usdcBalance) {
    throw new SavingsActionError(
      "limit-exceeded",
      `The requested deposit exceeds the account's USDC balance at Base block ${state.block.number}.`,
    );
  }
  if (amount > state.limit) {
    throw new SavingsActionError(
      "limit-exceeded",
      `The requested deposit exceeds maxDeposit at Base block ${state.block.number}.`,
    );
  }

  const calls = [];
  if (state.allowance === null) {
    throw new SavingsActionError("unavailable", "The USDC allowance read is unavailable.");
  }
  if (state.allowance < amount) {
    calls.push(encodeApproveCall(
      BASE_USDC_ADDRESS,
      action.vaultAddress,
      amount,
      usdcAssetId(),
    ));
  }
  calls.push(encodeDepositCall(action.vaultAddress, amount, account));

  return {
    kind: "savings-deposit",
    title: "Deposit USDC into Morpho",
    calls,
    amounts: [
      {
        assetId: usdcAssetId(),
        symbol: "USDC",
        decimals: BASE_USDC_DECIMALS,
        amountBaseUnits: amount.toString(10),
        direction: "spend",
      },
      {
        assetId: vaultShareAssetId(action.vaultAddress),
        symbol: "vault shares",
        decimals: state.shareDecimals,
        amountBaseUnits: state.previewShares.toString(10),
        direction: "receive",
        estimated: true,
      },
    ],
    warnings: commonWarnings(state, expiresAt).concat([
      `Source-block limits: maxDeposit ${formatUnits(state.limit, BASE_USDC_DECIMALS)} USDC; wallet balance ${formatUnits(state.usdcBalance, BASE_USDC_DECIMALS)} USDC.`,
      "The share amount is an ERC-4626 preview, not a guaranteed minimum. The direct vault deposit call has no minimum-shares parameter and will use the exchange rate when executed.",
      state.allowance < amount
        ? `This atomic plan first sets an exact ${amount.toString(10)} base-unit USDC approval for the selected vault, then deposits that same amount.`
        : "The existing USDC allowance covers this deposit, so no new approval is included.",
    ]),
    expiresAt,
    metadata,
  };
}

function prepareWithdrawal(
  action: SavingsActionInput,
  account: Address,
  amount: bigint,
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  expiresAt: string,
  metadata: SavingsMoneyActionMetadata,
): MoneyActionDraft {
  if (amount > state.limit || state.previewShares > state.sharesBalance) {
    throw new SavingsActionError(
      "limit-exceeded",
      `The requested withdrawal exceeds the account's current maxWithdraw or share balance at Base block ${state.block.number}.`,
    );
  }

  return {
    kind: "savings-withdraw",
    title: "Withdraw USDC from Morpho",
    calls: [
      encodeWithdrawCall(action.vaultAddress, amount, account, account),
    ],
    amounts: [
      {
        assetId: vaultShareAssetId(action.vaultAddress),
        symbol: "vault shares",
        decimals: state.shareDecimals,
        amountBaseUnits: state.previewShares.toString(10),
        direction: "spend",
        estimated: true,
      },
      {
        assetId: usdcAssetId(),
        symbol: "USDC",
        decimals: BASE_USDC_DECIMALS,
        amountBaseUnits: amount.toString(10),
        direction: "receive",
      },
    ],
    warnings: commonWarnings(state, expiresAt).concat([
      `Source-block limits: maxWithdraw ${formatUnits(state.limit, BASE_USDC_DECIMALS)} USDC; share balance ${formatUnits(state.sharesBalance, state.shareDecimals)}.`,
      "The reviewed USDC amount is exact. The displayed share burn is the ERC-4626 preview and can change before execution; the direct withdraw call either returns the exact assets or reverts.",
      `Both receiver and owner are the verified smart account ${account}.`,
    ]),
    expiresAt,
    metadata,
  };
}

async function createReviewMetadata(
  action: SavingsActionInput,
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  preparedAt: Date,
  readVaults: ((signal?: AbortSignal) => Promise<MorphoVaultsResult>) | undefined,
  signal?: AbortSignal,
): Promise<SavingsMoneyActionMetadata> {
  const configuredVault = getVerifiedSaveVault(action.vaultAddress);
  let discoveryRate: SavingsMoneyActionMetadata["discoveryRate"] = {
    status: "unavailable",
    netApy: null,
    fetchedAt: null,
    stateAsOf: null,
  };
  let vaultName = configuredVault?.name ?? "Configured USDC vault";

  if (readVaults) {
    try {
      const result = await readVaults(signal);
      const candidate = result.candidates.find(
        (item) => item.vaultAddress.toLowerCase() === action.vaultAddress.toLowerCase(),
      );
      if (
        candidate &&
        candidate.netApy !== null &&
        Number.isFinite(candidate.netApy) &&
        candidate.stateAsOf !== null &&
        isValidIso(candidate.source.fetchedAt) &&
        isValidIso(candidate.stateAsOf)
      ) {
        vaultName = candidate.name;
        const preparedAtMs = preparedAt.getTime();
        const fetchedAtMs = Date.parse(candidate.source.fetchedAt);
        const stateAsOfMs = Date.parse(candidate.stateAsOf);
        const stale = result.stale ||
          fetchedAtMs > preparedAtMs + 60_000 ||
          stateAsOfMs > preparedAtMs + 60_000 ||
          preparedAtMs - fetchedAtMs > 5 * 60_000 ||
          preparedAtMs - stateAsOfMs > 24 * 60 * 60_000;
        discoveryRate = {
          status: stale ? "stale" : "current",
          netApy: candidate.netApy.toString(),
          fetchedAt: candidate.source.fetchedAt,
          stateAsOf: candidate.stateAsOf,
        };
      }
    } catch {
    }
  }

  const metadata: SavingsMoneyActionMetadata = {
    product: "savings",
    operation: action.kind,
    vaultAddress: action.vaultAddress,
    vaultName,
    network: { name: "Base", chainId: BASE_CHAIN_ID },
    feeWad: state.fee.toString(10),
    limitBaseUnits: state.limit.toString(10),
    previewSharesBaseUnits: state.previewShares.toString(10),
    shareDecimals: state.shareDecimals,
    exchangeConstraint: action.kind === "deposit"
      ? "deposit-preview-no-minimum-shares"
      : "withdraw-exact-assets-or-revert",
    discoveryRate,
    source: {
      blockNumber: state.block.number,
      blockHash: state.block.hash,
      blockTimestamp: state.block.timestamp,
    },
  };
  const validatedMetadata: unknown = metadata;
  if (isSavingsMetadata(validatedMetadata)) return validatedMetadata;

  return {
    ...metadata,
    vaultName: configuredVault?.name ?? "Configured USDC vault",
    discoveryRate: {
      status: "unavailable",
      netApy: null,
      fetchedAt: null,
      stateAsOf: null,
    },
  };
}

function commonWarnings(
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  expiresAt: string,
): string[] {
  return [
    `Prepared from exact onchain reads pinned to Base block ${state.block.number} (${state.block.hash}).`,
    `Current vault fee: ${formatWadPercent(state.fee)}. Vault APY is variable and is not guaranteed.`,
    `Current action limits and previews can change. This review expires at ${expiresAt}.`,
  ];
}

function normalizeAction(action: SavingsActionInput): SavingsActionInput {
  if (!action || (action.kind !== "deposit" && action.kind !== "withdraw")) {
    throw new SavingsActionError("invalid-input", "A supported savings action kind is required.");
  }
  if (typeof action.vaultAddress !== "string" || !addressPattern.test(action.vaultAddress)) {
    throw new SavingsActionError("invalid-input", "A valid vault address is required.");
  }
  const vault = getVerifiedSaveVault(action.vaultAddress);
  if (!vault) {
    throw new SavingsActionError(
      "unsupported-vault",
      "Savings actions are limited to the configured Morpho USDC vaults.",
    );
  }
  if (!isSaveActionAllowed(vault.capabilities.save, action.kind)) {
    throw new SavingsActionError(
      "unsupported-vault",
      action.kind === "deposit"
        ? "This savings vault is not available for new deposits."
        : "This savings vault is not available for withdrawals.",
    );
  }
  if (
    typeof action.amountBaseUnits !== "string" ||
    !integerPattern.test(action.amountBaseUnits)
  ) {
    throw new SavingsActionError("invalid-input", "The amount must be an integer base-unit string.");
  }
  const amount = BigInt(action.amountBaseUnits);
  if (amount <= BigInt(0) || amount > UINT256_MAX) {
    throw new SavingsActionError("invalid-input", "The amount must be a positive uint256 value.");
  }
  return {
    kind: action.kind,
    vaultAddress: action.vaultAddress.toLowerCase() as Address,
    amountBaseUnits: amount.toString(10),
  };
}

function mapSimulationError(error: unknown): SavingsActionError {
  if (error instanceof SavingsActionError) return error;
  if (error instanceof CoinbaseSmartAccountBatchSimulationError) {
    if (error.code === "account-capability") {
      return new SavingsActionError(
        "unavailable",
        "Savings actions require a deployed Coinbase smart account that supports ordered batch simulation.",
        { cause: error },
      );
    }
    if (
      error.httpStatus === 429 ||
      (error.rpcCode !== null && RATE_LIMITED_RPC_CODES.has(error.rpcCode))
    ) {
      return new SavingsActionError(
        "rate-limited",
        "Base RPC is rate limited. Try again shortly.",
        { cause: error },
      );
    }
  }
  return new SavingsActionError(
    "rpc",
    "The savings action could not be simulated safely against the pinned Base state.",
    { cause: error },
  );
}

function mapReadStateError(error: unknown): SavingsActionError {
  if (error instanceof SavingsActionError) return error;
  if (error instanceof SavingsActionRpcError) {
    if (error.code === "rate-limited") {
      return new SavingsActionError(
        "rate-limited",
        "Base RPC is rate limited. Try again shortly.",
        { cause: error },
      );
    }
    return new SavingsActionError("rpc", error.message, { cause: error });
  }
  if (error instanceof SavingsActionAbiError) {
    return new SavingsActionError("rpc", error.message, { cause: error });
  }
  return new SavingsActionError(
    "unavailable",
    "Current onchain savings state is unavailable.",
    { cause: error },
  );
}

function verifiedAccountAddress(session: VerifiedAccountSession): Address {
  const account = session.smartAccount;
  if (
    !session.user.subject ||
    !account ||
    account.chainId !== BASE_CHAIN_ID ||
    !addressPattern.test(account.address)
  ) {
    throw new SavingsActionError(
      "invalid-input",
      "Savings actions require a verified Base smart account.",
    );
  }
  return account.address.toLowerCase() as Address;
}

function isValidIso(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function formatWadPercent(value: bigint): string {
  const scaled = value * BigInt(100_000_000) / WAD;
  const whole = scaled / BigInt(1_000_000);
  const fraction = (scaled % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}%` : `${whole.toString()}%`;
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString(10);
  const digits = value.toString(10).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function usdcAssetId() {
  return `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC_ADDRESS.toLowerCase()}`;
}

function vaultShareAssetId(vaultAddress: Address) {
  return `eip155:${BASE_CHAIN_ID}/erc20:${vaultAddress.toLowerCase()}`;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(ms) || ms <= 0 || signal?.aborted) {
      if (signal?.aborted) {
        reject(new SavingsActionError("rpc", "The Base savings RPC request was aborted."));
        return;
      }
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new SavingsActionError("rpc", "The Base savings RPC request was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
