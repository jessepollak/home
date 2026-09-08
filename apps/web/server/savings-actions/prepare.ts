import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { MoneyActionDraft } from "@/features/money-actions/types";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  isConfiguredMorphoVault,
} from "@/server/morpho/config";
import type { Address } from "@/server/morpho/types";
import {
  SavingsActionAbiError,
  encodeApproveCall,
  encodeDepositCall,
  encodeWithdrawCall,
} from "./abi";
import { SavingsActionRpcError, getSavingsActionState } from "./rpc";
import type {
  PrepareSavingsAction,
  SavingsActionInput,
  SavingsActionStateReader,
} from "./types";

const ACTION_VALIDITY_MS = 5 * 60_000;
const WAD = BigInt("1000000000000000000");
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const integerPattern = /^(?:0|[1-9][0-9]*)$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

export type SavingsActionErrorReason =
  | "invalid-input"
  | "unsupported-vault"
  | "unsupported-asset"
  | "limit-exceeded"
  | "rpc"
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
  now?: () => Date;
} = {}): PrepareSavingsAction {
  const readState = options.readState ?? getSavingsActionState;
  const now = options.now ?? (() => new Date());

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
      if (mapped.reason !== "rpc") throw mapped;
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

    return normalizedAction.kind === "deposit"
      ? prepareDeposit(normalizedAction, accountAddress, amount, state, expiresAt)
      : prepareWithdrawal(normalizedAction, accountAddress, amount, state, expiresAt);
  };
}

export const prepareSavingsAction = createPrepareSavingsAction();

function prepareDeposit(
  action: SavingsActionInput,
  account: Address,
  amount: bigint,
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  expiresAt: string,
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
    kind: "save-deposit",
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
  };
}

function prepareWithdrawal(
  action: SavingsActionInput,
  account: Address,
  amount: bigint,
  state: Awaited<ReturnType<SavingsActionStateReader>>,
  expiresAt: string,
): MoneyActionDraft {
  if (amount > state.limit || state.previewShares > state.sharesBalance) {
    throw new SavingsActionError(
      "limit-exceeded",
      `The requested withdrawal exceeds the account's current maxWithdraw or share balance at Base block ${state.block.number}.`,
    );
  }

  return {
    kind: "save-withdraw",
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
  if (!isConfiguredMorphoVault(action.vaultAddress)) {
    throw new SavingsActionError(
      "unsupported-vault",
      "Savings actions are limited to the configured Morpho USDC vaults.",
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

function mapReadStateError(error: unknown): SavingsActionError {
  if (error instanceof SavingsActionError) return error;
  if (error instanceof SavingsActionRpcError || error instanceof SavingsActionAbiError) {
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
