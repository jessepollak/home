import "server-only";

import type { AccountProvider } from "@/shared/account/session-types";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type {
  Address,
  CoinbaseSmartWalletTypedData,
  Hex,
  SmartAccountSignatureVerifier,
} from "@/shared/trading/server-types";
import {
  appendPermit2Signature,
  recoverTradeSigner,
  wrapSmartAccountSignature,
  TradePreparationError,
} from "./permit2";

export type PendingTradeConfirmation = {
  calls: MoneyActionCall[];
  permitHash: Hex;
  signingTypedData: CoinbaseSmartWalletTypedData;
  signerAddress: Address;
  signerOwnerIndex: 0;
  signerDeployed: boolean;
  swapCallIndex: number;
};

/** Kept half of the old finalizer: verify the reviewed Permit2 signature and splice it into the reviewed swap call. */
export async function finalizeTradeCalls(input: {
  pending: PendingTradeConfirmation;
  signature: Hex;
  owner: Address;
  provider: AccountProvider;
  verifySmartAccountSignature: SmartAccountSignatureVerifier;
  signal?: AbortSignal;
}): Promise<MoneyActionCall[]> {
  const { pending } = input;
  if (
    pending.signingTypedData.message.hash.toLowerCase() !== pending.permitHash.toLowerCase() ||
    pending.signingTypedData.domain.verifyingContract.toLowerCase() !== input.owner.toLowerCase()
  ) invalid();

  let wrapper: Hex;
  if (input.provider === "cdp-embedded") {
    const recovered = await recoverTradeSigner(pending.signingTypedData, input.signature);
    if (recovered.toLowerCase() !== pending.signerAddress.toLowerCase()) invalid();
    wrapper = wrapSmartAccountSignature(pending.signerOwnerIndex, input.signature);
  } else {
    wrapper = input.signature;
  }

  if (
    pending.signerDeployed &&
    !(await input.verifySmartAccountSignature({
      smartAccount: input.owner,
      permitHash: pending.permitHash,
      wrapper,
      signal: input.signal,
    }))
  ) invalid();

  const swapCall = pending.calls[pending.swapCallIndex];
  if (!swapCall || swapCall.approval) invalid();
  return pending.calls.map((call, index) => index === pending.swapCallIndex
    ? { ...call, data: appendPermit2Signature(call.data, wrapper) }
    : { ...call });
}

function invalid(): never {
  throw new TradePreparationError("invalid-finalization");
}
