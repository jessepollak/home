import "server-only";

import { decodeAbiParameters, encodeAbiParameters, hashTypedData, parseAbiParameters } from "viem";
import { cryptoAssets } from "@/config/invest-assets";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { Address, Hex } from "@/shared/trading/server-types";
import type { SwapQuote } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError, validatePermit2 } from "./permit2";

const USDC = BASE_USDC_ADDRESS.toLowerCase() as Address;
const CBBTC = cryptoAssets.find((asset) => asset.id === "cbbtc")!.contractAddress.toLowerCase() as Address;
const ZERO = "0x0000000000000000000000000000000000000000";
const EXECUTE_SELECTOR = "0x1fff991f";
const TRANSFER_FROM = "0xc1fb425e";
const BASIC = "0x38c9c147";
const UNISWAPV3 = "0x8d68a156";
const UNISWAPV2 = "0x103b48be";
const MAVERICKV2 = "0x9b59756f";
const RFQ = "0xd92aadfb";
const POSITIVE_SLIPPAGE = "0x34ee90ca";
const FORBIDDEN_BASIC_CALLS = new Set([
  "0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0x39509351", "0xd505accf", "0x8fcbaf0c",
  "0x42842e0e", "0xb88d4fde", "0xf242432a", "0x2eb2c2d6", "0xa22cb465",
]);
const BASIC_ABI = parseAbiParameters("address sellToken, uint256 ppm, address pool, uint256 offset, bytes data");
const V2_ABI = parseAbiParameters("address recipient, address sellToken, uint256 ppm, address pool, uint24 swapInfo, uint256 amountOutMin");
const MAVERICK_ABI = parseAbiParameters("address recipient, address sellToken, uint256 ppm, address pool, bool tokenAIn, int32 tickLimit, uint256 minBuyAmount");
const V3_ABI = parseAbiParameters("address recipient, uint256 ppm, bytes path, uint256 amountOutMin");
const RFQ_ABI = parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount");
const SLIPPAGE_ABI = parseAbiParameters("address recipient, address token, uint256 expectedAmount, uint256 maxPpm");
const DEPLOYER = "0x00000000000004533Fe15556B1E086BB1A72cEae";
const OWNER_OF_TWO = "0x6352211e" + "0".repeat(63) + "2";
const MAX_SWAP_GAS = BigInt(3_000_000);
type ActionContext = { actions: Hex[]; request: SwapReviewRequest; quote: LiquidQuote; router: Address; fromToken: Address; toToken: Address };
const SETTLER_ACTION_VALIDATORS: ReadonlyMap<Hex, (action: Hex, context: ActionContext, index: number) => boolean> = new Map([
  [TRANSFER_FROM, validateTransferFrom], [BASIC, validateBasic], [UNISWAPV2, validateV2],
  [MAVERICKV2, validateMaverick], [UNISWAPV3, validateV3], [RFQ, validateRfq], [POSITIVE_SLIPPAGE, validateSlippage],
]);

export async function readSettlerRouter(ethCall: (method: string, params: readonly unknown[]) => Promise<unknown>): Promise<Address> {
  const result = await ethCall("eth_call", [{ to: DEPLOYER, data: OWNER_OF_TWO }, "latest"]);
  if (typeof result !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(result)) reject();
  const router = `0x${result.slice(-40).toLowerCase()}` as Address;
  if (router === ZERO || router === PERMIT2_ADDRESS || router === USDC || router === CBBTC) reject();
  return router;
}

export type SwapDirection = "buy" | "sell";
export type SwapReviewRequest = {
  direction: SwapDirection;
  fromAmount: bigint;
  taker: Address;
  signerAddress?: Address;
  slippageBps: number;
};
export function swapTokens(direction: SwapDirection): { fromToken: Address; toToken: Address } {
  if (direction === "buy") return { fromToken: USDC, toToken: CBBTC };
  if (direction === "sell") return { fromToken: CBBTC, toToken: USDC };
  throw new TradePreparationError("invalid-request");
}

type QuoteCheck = { request: SwapReviewRequest; quote: SwapQuote; now: Date; currentBlockNumber: bigint; swapRouter: Address };
type LiquidQuote = Extract<SwapQuote, { liquidityAvailable: true }>;

function checkQuoteIdentity({ request, quote, currentBlockNumber }: QuoteCheck): LiquidQuote {
  const { fromToken, toToken } = swapTokens(request.direction);
  if (request.fromAmount <= BigInt(0) || !Number.isInteger(request.slippageBps) || request.slippageBps < 1 || request.slippageBps > 300) {
    throw new TradePreparationError("invalid-request");
  }
  if (!quote.liquidityAvailable) throw new TradePreparationError("no-liquidity");
  if (
    quote.fromToken !== fromToken || quote.toToken !== toToken || quote.fromAmount !== request.fromAmount ||
    quote.toAmount <= BigInt(0) || quote.minToAmount <= BigInt(0) || quote.minToAmount > quote.toAmount ||
    quote.minToAmount < quote.toAmount * BigInt(10_000 - request.slippageBps) / BigInt(10_000)
  ) reject();
  if (quote.blockNumber < currentBlockNumber - BigInt(30) || quote.blockNumber > currentBlockNumber + BigInt(2)) {
    throw new TradePreparationError("stale-quote");
  }
  return quote;
}

function word(data: string, byteOffset: number): bigint {
  const start = 2 + byteOffset * 2;
  const hex = data.slice(start, start + 64);
  if (hex.length !== 64) throw new Error("short word");
  return BigInt(`0x${hex}`);
}

function addressWord(data: string, byteOffset: number): Address {
  const value = word(data, byteOffset);
  if (value >> BigInt(160)) throw new Error("invalid address word");
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function parseExecution(data: Hex): { recipient: Address; buyToken: Address; minAmountOut: bigint; actions: Hex[]; actionOffsets: number[] } {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(data) || data.slice(0, 10).toLowerCase() !== EXECUTE_SELECTOR) throw new Error("invalid execute");
  const bytes = (data.length - 2) / 2;
  const recipient = addressWord(data, 4);
  const buyToken = addressWord(data, 36);
  const minAmountOut = word(data, 68);
  if (word(data, 100) !== BigInt(0xa0)) throw new Error("invalid offset");
  word(data, 132);
  const count = word(data, 164);
  if (count < BigInt(1) || count > BigInt(8)) throw new Error("invalid action count");
  const n = Number(count);
  const bodyStart = 196;
  let cursor = bodyStart + n * 32;
  const actions: Hex[] = Array(n);
  const actionOffsets: number[] = Array(n);
  for (let index = 1; index < n; index++) {
    const offset = word(data, bodyStart + index * 32);
    if (offset !== BigInt(cursor - bodyStart)) throw new Error("invalid element offset");
    const length = word(data, cursor);
    cursor += 32;
    if (length < BigInt(4) || length > BigInt(bytes - cursor)) throw new Error("invalid element length");
    const padded = Math.ceil(Number(length) / 32) * 32;
    if (cursor + padded > bytes) throw new Error("invalid element padding");
    const action = `0x${data.slice(2 + cursor * 2, 2 + (cursor + Number(length)) * 2).toLowerCase()}` as Hex;
    actionOffsets[index] = cursor;
    if (!/^0*$/.test(data.slice(2 + (cursor + Number(length)) * 2, 2 + (cursor + padded) * 2))) throw new Error("nonzero padding");
    if (action.slice(0, 10) === TRANSFER_FROM) throw new Error("duplicate transfer");
    actions[index] = action;
    cursor += padded;
  }
  if (word(data, bodyStart) !== BigInt(cursor - bodyStart) || word(data, cursor) !== BigInt(0xffff) || cursor + 32 + 196 !== bytes) {
    throw new Error("invalid signature placeholder");
  }
  const action = `0x${data.slice(2 + (cursor + 32) * 2).toLowerCase()}` as Hex;
  if (action.slice(0, 10) !== TRANSFER_FROM || word(action, 164) !== BigInt(0xc0)) throw new Error("invalid transfer placeholder");
  actions[0] = action;
  actionOffsets[0] = cursor + 32;
  return { recipient, buyToken, minAmountOut, actions, actionOffsets };
}

function decodeAction<T extends typeof BASIC_ABI | typeof V2_ABI | typeof MAVERICK_ABI | typeof V3_ABI | typeof RFQ_ABI | typeof SLIPPAGE_ABI>(abi: T, action: Hex) {
  const body = `0x${action.slice(10)}` as Hex;
  const args = decodeAbiParameters(abi, body);
  if (encodeAbiParameters(abi, args as never).toLowerCase() !== body) throw new Error("noncanonical action");
  return args;
}

function special(address: string, context: ActionContext): boolean {
  return [ZERO, PERMIT2_ADDRESS, context.request.taker, context.request.signerAddress, USDC, CBBTC, context.router]
    .some((value) => value?.toLowerCase() === address.toLowerCase());
}

function forbiddenToken(token: string, context: ActionContext): boolean {
  return [ZERO, PERMIT2_ADDRESS, context.request.taker, context.request.signerAddress, context.router]
    .some((value) => value?.toLowerCase() === token.toLowerCase());
}

function routedPool(action: Hex): Address | null {
  const selector = action.slice(0, 10);
  if (selector === UNISWAPV2) return decodeAction(V2_ABI, action)[3].toLowerCase() as Address;
  if (selector === MAVERICKV2) return decodeAction(MAVERICK_ABI, action)[3].toLowerCase() as Address;
  return null;
}

function validateRoutedSwap(action: Hex, context: ActionContext, index: number, abi: typeof V2_ABI | typeof MAVERICK_ABI): boolean {
  const [recipient, sellToken, ppm, pool] = decodeAction(abi, action);
  const laterPools = context.actions.slice(index + 1).map(routedPool);
  const priorRecipients = context.actions.slice(1, index).flatMap((prior) => {
    const selector = prior.slice(0, 10);
    return selector === UNISWAPV2 ? [decodeAction(V2_ABI, prior)[0].toLowerCase()]
      : selector === MAVERICKV2 ? [decodeAction(MAVERICK_ABI, prior)[0].toLowerCase()] : [];
  });
  const funded = pool.toLowerCase() === addressWord(context.actions[0], 4) || priorRecipients.includes(pool.toLowerCase());
  return (recipient.toLowerCase() === context.router.toLowerCase() || laterPools.includes(recipient.toLowerCase() as Address)) &&
    !forbiddenToken(sellToken, context) && !special(pool, context) && ppm <= BigInt(1_000_000) &&
    (ppm > BigInt(0) || funded);
}

function validBasicCall(data: Hex, offset: bigint, context: ActionContext): boolean {
  if (!/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(data) || FORBIDDEN_BASIC_CALLS.has(data.slice(0, 10).toLowerCase())) return false;
  const payload = data.slice(10).toLowerCase();
  if ([context.request.taker, context.request.signerAddress, PERMIT2_ADDRESS]
    .some((address) => address !== undefined && payload.includes(address.slice(2).toLowerCase()))) return false;
  return offset === BigInt(0) || (offset >= BigInt(4) && offset + BigInt(32) <= BigInt((data.length - 2) / 2));
}

function basicPool(action: Hex, context: ActionContext): Address | null {
  if (action.slice(0, 10) !== BASIC) return null;
  const [sellToken, , pool, offset, data] = decodeAction(BASIC_ABI, action);
  return pool.toLowerCase() !== sellToken.toLowerCase() && !forbiddenToken(sellToken, context) && !special(pool, context) &&
    validBasicCall(data, offset, context) ? pool.toLowerCase() as Address : null;
}

function permitUint(value: unknown): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

function validateTransferFrom(action: Hex, context: ActionContext): boolean {
  if (!context.quote.permit2) return false;
  const message = (context.quote.permit2.eip712 as { message?: { nonce?: unknown; deadline?: unknown } })?.message;
  const recipient = addressWord(action, 4);
  const token = addressWord(action, 36);
  const amount = word(action, 68);
  const nonce = word(action, 100);
  const deadline = word(action, 132);
  const pools = context.actions.slice(1).flatMap((other) => {
    if (other.slice(0, 10) === BASIC) return [basicPool(other, context)];
    return [routedPool(other)];
  });
  return token === context.fromToken && amount === context.request.fromAmount &&
    nonce === permitUint(message?.nonce) && deadline === permitUint(message?.deadline) &&
    (recipient === context.router.toLowerCase() || pools.includes(recipient));
}

function validateBasic(action: Hex, context: ActionContext): boolean {
  const [sellToken, ppm, pool, offset, data] = decodeAction(BASIC_ABI, action);
  if (pool.toLowerCase() === sellToken.toLowerCase()) {
    const fee = context.quote.fees.protocolFee;
    if (!fee || sellToken.toLowerCase() !== fee.token.toLowerCase() || offset !== BigInt(36) ||
      !/^0xa9059cbb[0-9a-f]{128}$/i.test(data)) return false;
    const to = addressWord(data, 4);
    if (special(to, context)) return false;
    return ppm <= BigInt(50_000);
  }
  return !special(pool, context) && !forbiddenToken(sellToken, context) && ppm >= BigInt(1) && ppm <= BigInt(1_000_000) &&
    validBasicCall(data, offset, context);
}

function validateV2(action: Hex, context: ActionContext, index: number): boolean {
  return validateRoutedSwap(action, context, index, V2_ABI);
}

function validateMaverick(action: Hex, context: ActionContext, index: number): boolean {
  return validateRoutedSwap(action, context, index, MAVERICK_ABI);
}

function validateV3(action: Hex, context: ActionContext): boolean {
  const [recipient, ppm, path] = decodeAction(V3_ABI, action);
  const size = (path.length - 2) / 2;
  if (size < 64 || (size - 20) % 44 !== 0) return false;
  let previous = `0x${path.slice(2, 42)}`.toLowerCase();
  if (forbiddenToken(previous, context)) return false;
  for (let offset = 20; offset < size; offset += 44) {
    const next = `0x${path.slice(2 + (offset + 24) * 2, 2 + (offset + 44) * 2)}`.toLowerCase();
    if (next === previous || forbiddenToken(next, context)) return false;
    previous = next;
  }
  return recipient.toLowerCase() === context.router.toLowerCase() && ppm >= BigInt(1) && ppm <= BigInt(1_000_000);
}

function validateRfq(action: Hex, context: ActionContext): boolean {
  const [recipient, permit, maker, makerSig, takerToken, maxTakerAmount] = decodeAction(RFQ_ABI, action);
  return [context.router.toLowerCase(), context.request.taker.toLowerCase()].includes(recipient.toLowerCase()) &&
    takerToken.toLowerCase() === context.fromToken && permit.permitted.token.toLowerCase() === context.toToken &&
    maxTakerAmount > BigInt(0) && maxTakerAmount <= context.request.fromAmount && permit.permitted.amount > BigInt(0) &&
    !special(maker, context) && makerSig.length > 2;
}

function validateSlippage(action: Hex, context: ActionContext): boolean {
  const [recipient, token, expectedAmount, maxPpm] = decodeAction(SLIPPAGE_ABI, action);
  return token.toLowerCase() === context.toToken && expectedAmount >= context.quote.toAmount &&
    !special(recipient, context) && maxPpm >= BigInt(1) && maxPpm <= BigInt(1_000_000);
}

function sellsFromToken(action: Hex, context: ActionContext): boolean {
  const selector = action.slice(0, 10);
  if (selector === BASIC) return basicPool(action, context) !== null && decodeAction(BASIC_ABI, action)[0].toLowerCase() === context.fromToken;
  if (selector === UNISWAPV2) return decodeAction(V2_ABI, action)[1].toLowerCase() === context.fromToken;
  if (selector === MAVERICKV2) return decodeAction(MAVERICK_ABI, action)[1].toLowerCase() === context.fromToken;
  if (selector === UNISWAPV3) return decodeAction(V3_ABI, action)[2].slice(0, 42).toLowerCase() === context.fromToken;
  if (selector === RFQ) return decodeAction(RFQ_ABI, action)[4].toLowerCase() === context.fromToken;
  return false;
}

function feesMatch(context: ActionContext): boolean {
  const fees = context.actions.filter((action) => action.slice(0, 10) === BASIC)
    .map((action) => decodeAction(BASIC_ABI, action))
    .filter(([sellToken, , pool]) => sellToken.toLowerCase() === pool.toLowerCase());
  if (!fees.length) return context.quote.fees.protocolFee === null;
  const fee = context.quote.fees.protocolFee;
  if (!fee || !fees.every(([token]) => token.toLowerCase() === fee.token.toLowerCase())) return false;
  const ppm = fees.reduce((sum, [, rate]) => sum + rate, BigInt(0));
  if (ppm > BigInt(50_000)) return false;
  if (fee.token.toLowerCase() === context.fromToken) {
    return fees.reduce((sum, [, rate]) => sum + context.request.fromAmount * rate / BigInt(1_000_000), BigInt(0)) === fee.amount;
  }
  if (fee.token.toLowerCase() !== context.toToken) return false;
  const predicted = ppm * (context.quote.toAmount + fee.amount);
  const actual = fee.amount * BigInt(1_000_000);
  const delta = predicted > actual ? predicted - actual : actual - predicted;
  const tolerance = fee.amount * BigInt(10_000);
  return delta <= (tolerance > BigInt(1_000_000) ? tolerance : BigInt(1_000_000));
}

export type RfqMakerAuthorization = {
  maker: Address;
  permit: { permitted: { token: Address; amount: bigint }; nonce: bigint; deadline: bigint };
  makerSig: Hex;
  takerToken: Address;
  maxTakerAmount: bigint;
  digest: Hex;
};

export function rfqMakerAuthorizations(request: SwapReviewRequest, quote: LiquidQuote, router: Address): RfqMakerAuthorization[] {
  const { actions } = parseExecution(quote.transaction.data);
  return actions.filter((action) => action.slice(0, 10) === RFQ).map((action) => {
    const [, permit, maker, makerSig, takerToken, maxTakerAmount] = decodeAction(RFQ_ABI, action);
    const digest = hashTypedData({
      domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
      primaryType: "PermitWitnessTransferFrom",
      types: {
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
          { name: "consideration", type: "Consideration" },
        ],
        TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
        Consideration: [
          { name: "token", type: "address" }, { name: "amount", type: "uint256" },
          { name: "counterparty", type: "address" }, { name: "partialFillAllowed", type: "bool" },
        ],
      },
      message: {
        permitted: permit.permitted, spender: router, nonce: permit.nonce, deadline: permit.deadline,
        consideration: { token: takerToken, amount: maxTakerAmount, counterparty: request.taker, partialFillAllowed: true },
      },
    });
    return {
      maker: maker.toLowerCase() as Address,
      permit: { permitted: { token: permit.permitted.token.toLowerCase() as Address, amount: permit.permitted.amount }, nonce: permit.nonce, deadline: permit.deadline },
      makerSig, takerToken: takerToken.toLowerCase() as Address, maxTakerAmount, digest,
    };
  });
}

export function swapExecutionMatches(request: SwapReviewRequest, quote: LiquidQuote, swapRouter: Address) {
  const { fromToken, toToken } = swapTokens(request.direction);
  const targetMatchesRouter = /^0x[0-9a-f]{40}$/.test(swapRouter) &&
    swapRouter !== ZERO && swapRouter !== PERMIT2_ADDRESS && swapRouter !== fromToken && swapRouter !== toToken &&
    quote.transaction.to === swapRouter;
  let calldataMatches = false;
  let actionSelectors: Hex[] | null = null;
  let actionsVerified = false;
  try {
    const { recipient, buyToken, minAmountOut, actions } = parseExecution(quote.transaction.data);
    actionSelectors = actions.map((action) => action.slice(0, 10) as Hex);
    calldataMatches = recipient === request.taker.toLowerCase() && buyToken === toToken &&
      minAmountOut > BigInt(0) && minAmountOut === quote.minToAmount;
    const context = { actions, request, quote, router: swapRouter, fromToken, toToken };
    try {
      actionsVerified = actions.some((action) => sellsFromToken(action, context)) &&
        actions.every((action, index) => SETTLER_ACTION_VALIDATORS.get(action.slice(0, 10) as Hex)?.(action, context, index) === true) && feesMatch(context);
    } catch {
      actionsVerified = false;
    }
  } catch {
    calldataMatches = false;
    actionSelectors = null;
    actionsVerified = false;
  }
  return { targetMatchesRouter, calldataMatches, actionSelectors, actionsVerified };
}

function executableCalldata(data: Hex, takerDeadline: bigint): { data: Hex; executionDeadline: bigint } {
  const { actions, actionOffsets } = parseExecution(data);
  let executionDeadline = takerDeadline;
  let rewritten = data as string;
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    const selector = action.slice(0, 10);
    if (selector === RFQ) {
      const makerDeadline = decodeAction(RFQ_ABI, action)[1].deadline;
      if (makerDeadline < executionDeadline) executionDeadline = makerDeadline;
    }
    const paramIndex = selector === UNISWAPV2 ? 5 : selector === MAVERICKV2 ? 6 : selector === UNISWAPV3 ? 3 : null;
    if (paramIndex !== null) {
      const start = 2 + (actionOffsets[index]! + 4 + paramIndex * 32) * 2;
      rewritten = `${rewritten.slice(0, start)}${"0".repeat(64)}${rewritten.slice(start + 64)}`;
    }
  }
  return { data: rewritten as Hex, executionDeadline };
}

function checkQuoteExecutionShape(request: SwapReviewRequest, quote: LiquidQuote, now: Date, swapRouter: Address) {
  const { fromToken } = swapTokens(request.direction);
  if (!quote.permit2) reject();
  const permit = validatePermit2({
    eip712: quote.permit2.eip712, providerHash: quote.permit2.hash, token: fromToken,
    amount: request.fromAmount, now,
  });
  const { targetMatchesRouter, calldataMatches } = swapExecutionMatches(request, quote, swapRouter);
  if (!targetMatchesRouter || !calldataMatches || permit.spender !== quote.transaction.to) reject();
  if (quote.issues.allowance !== null && quote.issues.allowance.spender !== PERMIT2_ADDRESS) reject();
  if (quote.transaction.value !== BigInt(0) || quote.transaction.gas <= BigInt(0) || quote.transaction.gas > MAX_SWAP_GAS) reject();
  return permit;
}

export function checkQuoteCompatibility(input: QuoteCheck): void {
  checkQuoteExecutionShape(input.request, checkQuoteIdentity(input), input.now, input.swapRouter);
}

export function validateSwapQuote(input: QuoteCheck) {
  const { request, now } = input;
  const { fromToken, toToken } = swapTokens(request.direction);
  const quote = checkQuoteIdentity(input);
  if (quote.issues.balance !== null) throw new TradePreparationError("insufficient-balance");
  if (quote.issues.simulationIncomplete !== false) reject();
  const permit = checkQuoteExecutionShape(request, quote, now, input.swapRouter);
  if (!swapExecutionMatches(request, quote, input.swapRouter).actionsVerified) throw new TradePreparationError("unverified-actions");
  const executable = executableCalldata(quote.transaction.data, permit.deadline);
  if (executable.executionDeadline * BigInt(1000) <= BigInt(now.getTime())) throw new TradePreparationError("stale-quote");
  const target = quote.transaction.to;
  return {
    direction: request.direction, fromToken, toToken, fromAmount: request.fromAmount,
    toAmount: quote.toAmount, minToAmount: quote.minToAmount, slippageBps: request.slippageBps,
    blockNumber: quote.blockNumber, fees: quote.fees,
    permit: { typedData: permit.typedData, hash: permit.permitHash, deadline: permit.deadline, nonce: permit.nonce, spender: permit.spender },
    swapCall: { to: target, data: executable.data, value: BigInt(0), gas: quote.transaction.gas },
    executionDeadline: executable.executionDeadline,
    expiresAt: new Date(Number(executable.executionDeadline) * 1000),
  };
}
function reject(): never { throw new TradePreparationError("quote-rejected"); }
