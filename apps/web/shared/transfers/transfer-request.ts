import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { decodeMoneyActionApproval } from "@/shared/money-actions/approval";
import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import { normalizeTransferRecipientName } from "./recipient-name";
import {
  ERC20_TRANSFER_SELECTOR,
  encodeErc20Transfer,
  getTransferAsset,
  normalizeTransferRecipient,
  readBaseUnits,
} from "./transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "./types";

export function assertTransferRequest(value: TransferRequest): void {
  if (
    !value ||
    typeof value.assetId !== "string" ||
    typeof value.recipient !== "string" ||
    typeof value.amountBaseUnits !== "string" ||
    (value.recipientName !== undefined && typeof value.recipientName !== "string")
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  const asset = getTransferAsset(value.assetId);
  if (!asset) {
    throw new TransferExecutionError("invalid-request");
  }
  const recipient = normalizeTransferRecipient(value.recipient);
  if (value.recipientName !== undefined && normalizeTransferRecipientName(value.recipientName) === null) {
    throw new TransferExecutionError("invalid-request");
  }
  if (
    asset.kind === "erc20" &&
    asset.contractAddress !== null &&
    recipient.toLowerCase() === asset.contractAddress.toLowerCase()
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  readBaseUnits(value.amountBaseUnits, true);
}

export function transferRequestFromAction(
  action: PreparedMoneyAction,
): TransferRequest | null {
  const transferCalls = withoutNetworkFeeApproval(action);
  if (action.kind !== "send" || !transferCalls || transferCalls.length !== 1) return null;
  const spend = action.amounts.find((entry) => entry.direction === "spend");
  const asset = getTransferAsset(spend?.assetId);
  if (!spend || !asset || spend.symbol !== asset.symbol || spend.decimals !== asset.decimals) {
    return null;
  }
  const call = transferCalls[0];
  let recipient: `0x${string}`;
  if (asset.kind === "native") {
    if (call.data !== "0x" || call.value !== spend.amountBaseUnits) return null;
    recipient = call.to;
  } else {
    if (!asset.contractAddress || call.to.toLowerCase() !== asset.contractAddress.toLowerCase() || call.value !== "0") {
      return null;
    }
    if (!call.data.startsWith(ERC20_TRANSFER_SELECTOR) || call.data.length !== 138) return null;
    recipient = `0x${call.data.slice(34, 74)}` as `0x${string}`;
    try {
      if (encodeErc20Transfer(asset.contractAddress, recipient, BigInt(spend.amountBaseUnits)).data !== call.data.toLowerCase()) {
        return null;
      }
    } catch {
      return null;
    }
  }
  try {
    const request = {
      assetId: spend.assetId,
      recipient: normalizeTransferRecipient(recipient),
      amountBaseUnits: spend.amountBaseUnits,
    } satisfies TransferRequest;
    assertTransferRequest(request);
    return request;
  } catch {
    return null;
  }
}

function withoutNetworkFeeApproval(action: PreparedMoneyAction): PreparedMoneyAction["calls"] | null {
  if (action.networkFee === undefined || action.networkFee.payment === "native") return action.calls;
  const fee = parseMoneyActionNetworkFee(action.networkFee);
  if (fee?.payment !== "usdc") return null;
  const [approval, ...rest] = action.calls;
  const decoded = approval ? decodeMoneyActionApproval(approval) : null;
  if (
    !decoded ||
    decoded.token !== fee.token.toLowerCase() ||
    decoded.spender !== fee.paymaster.toLowerCase() ||
    decoded.amountBaseUnits !== fee.maxFeeBaseUnits ||
    approval.value !== "0"
  ) {
    return null;
  }
  return rest;
}
