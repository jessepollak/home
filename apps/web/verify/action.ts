import { decodeFunctionData, erc20Abi, isAddress, getAddress } from "viem";
import type { PreparedMoneyAction, MoneyActionCall } from "../shared/money-actions/types";
import { BASE_USDC } from "../shared/assets/base";
import { visibleNameScript } from "./live";

export type ActionCheck = { amountUsd: number; recipient: string | null };

const kindForSurface: Record<string, readonly string[]> = {
  send: ["send"],
  save: ["savings-deposit", "savings-withdraw"],
  borrow: ["borrow", "repay"],
  "cash-out": ["cash-out", "cash-out-withdraw"],
};

export function checkPreparedAction(
  value: unknown,
  id: string,
  surface: string,
  operation: string | null,
  recipient: string | null,
  payoutHandle: string | null,
  pinnedAccount: string,
  now = Date.now(),
): ActionCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The prepared action response is invalid.");
  const action = value as Partial<PreparedMoneyAction>;
  if (action.id !== id || !kindForSurface[surface]?.includes(action.kind ?? "") || !Array.isArray(action.calls) ||
      !Array.isArray(action.amounts) || !action.owner || !isAddress(action.owner.address) ||
      !isAddress(pinnedAccount) || action.owner.address.toLowerCase() !== pinnedAccount.toLowerCase() ||
      typeof action.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(action.expiresAt)) || Date.parse(action.expiresAt) <= now) {
    throw new Error("The prepared action is missing, expired, or for a different surface.");
  }
  const kind = action.kind!;
  if (operation !== null) {
    const expected = operation === "deposit" ? "savings-deposit" : operation === "withdraw" && surface === "save" ? "savings-withdraw"
      : operation === "repay" ? "repay" : operation === "borrow" ? "borrow"
      : operation === "cash-out" ? "cash-out" : operation === "withdraw" ? "cash-out-withdraw" : "send";
    if (kind !== expected) throw new Error("The prepared action kind does not match the selected operation.");
  }
  const metadata = action.metadata;
  if (kind === "repay" && (operation === "repay") && (metadata?.product !== "borrow" || metadata.operation !== "repay-all")) {
    throw new Error("The repay canary requires the reviewed maximum repayment.");
  }
  if (kind === "cash-out" && (metadata?.product !== "cashout" || metadata.operation !== "deposit" ||
      !payoutHandle || metadata.canonicalHandle !== payoutHandle)) {
    throw new Error("The prepared payout handle does not match the pinned handle.");
  }
  if (kind === "cash-out-withdraw" && (metadata?.product !== "cashout" || metadata.operation !== "withdraw")) {
    throw new Error("The prepared withdrawal metadata is invalid.");
  }
  const amounts = action.amounts;
  const receive = kind === "borrow" || kind === "savings-withdraw" || kind === "cash-out-withdraw";
  const maximum = kind === "repay" && metadata?.product === "borrow" && metadata.operation === "repay-all";
  const matches = amounts.filter((amount) => amount && typeof amount === "object" && amount.symbol === "USDC" &&
    amount.decimals === 6 && amount.direction === (receive ? "receive" : "spend") && Boolean(amount.maximum) === maximum);
  if (matches.length !== 1) throw new Error("The prepared action must have exactly one applicable USDC amount.");
  const selected = matches[0];
  const usdcIds = [BASE_USDC.id, `eip155:8453/erc20:${BASE_USDC.address.toLowerCase()}`];
  if (!usdcIds.includes(selected.assetId)) throw new Error("The prepared asset is not pinned Base USDC.");
  const extras = amounts.filter((amount) => amount !== selected);
  const allowedCollateral = kind === "borrow" && metadata?.product === "borrow" && metadata.operation === "supply-and-borrow"
    ? extras.length === 1 && extras[0]?.direction === "spend" && extras[0]?.assetId === metadata.collateralAsset.id
    : false;
  const allowedEstimated = maximum && extras.length === 1 && extras[0]?.direction === "spend" && extras[0]?.estimated === true && !extras[0]?.maximum;
  const allowedVaultShares = (kind === "savings-deposit" || kind === "savings-withdraw") && extras.length === 1 &&
    extras[0]?.symbol === "vault shares" && extras[0]?.direction === (receive ? "spend" : "receive");
  if (extras.length > 0 && !allowedCollateral && !allowedEstimated && !allowedVaultShares) {
    throw new Error("The prepared action has unexpected additional amounts.");
  }
  if (typeof selected.amountBaseUnits !== "string" || !/^[0-9]+$/.test(selected.amountBaseUnits)) {
    throw new Error("The prepared USDC amount is invalid.");
  }
  const units = BigInt(selected.amountBaseUnits);
  if (units <= BigInt(0) || units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The prepared USDC amount is invalid.");
  const amountUsd = Number(units) / 1_000_000;
  let decodedRecipient: string | null = null;
  if (kind === "send") {
    if (!recipient || !isAddress(recipient) || action.calls.length !== 1) throw new Error("The pinned recipient or send calls are invalid.");
    const call = action.calls[0];
    if (call.data === "0x" || call.to.toLowerCase() !== BASE_USDC.address.toLowerCase()) {
      throw new Error("The prepared send is not a Base USDC transfer.");
    }
    decodedRecipient = decodeSendRecipient(call, units);
    if (decodedRecipient.toLowerCase() !== recipient.toLowerCase()) throw new Error("The prepared recipient does not match the pinned recipient.");
  }
  return { amountUsd, recipient: decodedRecipient };
}

export function decodeSendRecipient(call: MoneyActionCall, amount: bigint): string {
  if (!call || !isAddress(call.to) || typeof call.data !== "string" || typeof call.value !== "string" || !/^[0-9]+$/.test(call.value)) {
    throw new Error("The send call is invalid.");
  }
  if (call.data === "0x") {
    if (BigInt(call.value) !== amount) throw new Error("The native send value differs from the prepared amount.");
    return getAddress(call.to);
  }
  const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data as `0x${string}` });
  if (decoded.functionName !== "transfer" || BigInt(call.value) !== BigInt(0) || BigInt(decoded.args[1]) !== amount) {
    throw new Error("The token transfer differs from the prepared amount.");
  }
  return getAddress(decoded.args[0]);
}

export function preparedFromHar(har: unknown, origin: string, id: string): unknown {
  if (!har || typeof har !== "object" || !('log' in har)) throw new Error("The prepare capture is invalid.");
  const entries = (har as { log?: { entries?: unknown } }).log?.entries;
  if (!Array.isArray(entries)) throw new Error("The prepare capture has no entries.");
  const prepared = entries.flatMap((entry): unknown[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { request?: { method?: string; url?: string }; response?: { status?: number; content?: { text?: string; encoding?: string } } };
    if (item.request?.method !== "POST" || item.request.url !== `${origin}/api/actions/prepare` || item.response?.status !== 201) return [];
    const text = item.response.content?.text;
    if (typeof text !== "string" || item.response.content?.encoding) throw new Error("The prepare response body is unavailable.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("The prepare response body is invalid."); }
    return parsed && typeof parsed === "object" && "id" in parsed && parsed.id === id ? [parsed] : [];
  });
  if (prepared.length !== 1) throw new Error(`Expected one prepared action for ${id}; found ${prepared.length}.`);
  return prepared[0];
}

export function confirmControlScript(attribute: string): string {
  return `(() => [...document.querySelectorAll(${JSON.stringify(`button[${attribute}],[role="button"][${attribute}]`)})].filter(node => node.getClientRects().length && !node.disabled && node.getAttribute("aria-disabled")!=="true").map(node => {${visibleNameScript}return {id:node.getAttribute(${JSON.stringify(attribute)}),name:(node.getAttribute("aria-label")?.trim()||visibleName(node))}}))()`;
}

export function protectedControlScript(attribute: string, label: string): string {
  return `(() => [...document.querySelectorAll(${JSON.stringify(`button[${attribute}],[role="button"][${attribute}]`)})].some(node => {${visibleNameScript}return node.getClientRects().length>0 && (node.getAttribute("aria-label")?.trim()||visibleName(node))===${JSON.stringify(label)}}))()`;
}
