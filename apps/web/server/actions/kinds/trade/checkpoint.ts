import "server-only";

import cdpPackage from "../../../../node_modules/@coinbase/cdp-sdk/package.json";
import type { Address } from "@/shared/trading/server-types";
import type { CdpSwapsClient, SwapQuote } from "./cdp-swaps";
import { PRICE_PATH, SWAPS_PATH } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError, validatePermit2 } from "./permit2";
import { checkQuoteCompatibility, rfqMakerAuthorizations, swapExecutionMatches, swapTokens, validateSwapQuote, type SwapDirection } from "./quote";
import { verifyRfqMakerAuthorizations } from "./rfq-maker";

const DEFAULT_TOKEN = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Address;
const ACCEPTABLE_READINESS = new Set(["ready", "insufficient-balance"]);

export type CheckpointAmounts = { buy: bigint; sell: bigint };
export function checkpointExitCode(report: Awaited<ReturnType<typeof runSwapsCheckpoint>>): 0 | 2 {
  return report.directions.every((row) =>
    row.priceLiquidityAvailable && row.quoteLiquidityAvailable && row.permit2Compatible && row.spenderMatchesTarget &&
    row.targetMatchesRouter && row.calldataMatches && row.quoteCompatible && row.actionsVerified === true && ACCEPTABLE_READINESS.has(row.executionReadiness),
  ) ? 0 : 2;
}

export async function runSwapsCheckpoint({ client, taker, amounts, now, readBlockNumber, readSwapRouter, read, token = DEFAULT_TOKEN, deriveSellFromBuy = false }: {
  client: CdpSwapsClient;
  taker: Address;
  amounts: CheckpointAmounts;
  now: Date;
  readBlockNumber: () => Promise<bigint>;
  readSwapRouter: () => Promise<Address>;
  token?: Address;
  deriveSellFromBuy?: boolean;
  read?: (method: string, params: readonly unknown[]) => Promise<unknown>;
}) {
  let swapRouter: Address | null = null;
  try { swapRouter = await readSwapRouter(); } catch { swapRouter = null; }
  const directions = [] as Array<{
    direction: SwapDirection;
    requestedAmount: string;
    priceLiquidityAvailable: boolean;
    quoteLiquidityAvailable: boolean;
    permit2Present: boolean;
    permit2Compatible: boolean;
    permit2Reason: string | null;
    spenderMatchesTarget: boolean;
    targetMatchesRouter: boolean;
    calldataMatches: boolean;
    actionSelectors: string[] | null;
    chain: "available" | "unavailable";
    actionsVerified: boolean | null;
    quoteCompatible: boolean;
    compatibilityReason: string | null;
    allowanceSpenderIsPermit2: boolean | null;
    simulationIncomplete: boolean | null;
    balanceIssue: boolean;
    executionReadiness: "ready" | string;
  }>;
  let sellAmount = deriveSellFromBuy ? BigInt(0) : amounts.sell;
  for (const direction of ["buy", "sell"] as const) {
    const request = { direction, token, fromAmount: direction === "buy" ? amounts.buy : sellAmount, taker, slippageBps: 100 };
    const providerRequest = { ...swapTokens(direction, token), fromAmount: request.fromAmount, taker, slippageBps: request.slippageBps };
    let priceLiquidityAvailable = false;
    let quote: SwapQuote = { liquidityAvailable: false };
    let failure: string | null = null;
    let block: bigint | null = null;
    try {
      if (deriveSellFromBuy && direction === "sell" && sellAmount === BigInt(0)) throw new Error("no-reference-amount");
      const price = await client.getPrice(providerRequest);
      priceLiquidityAvailable = price.liquidityAvailable;
      quote = await client.createQuote(providerRequest);
      if (deriveSellFromBuy && direction === "buy" && quote.liquidityAvailable && quote.toAmount > BigInt(0)) sellAmount = quote.toAmount;
      if (quote.liquidityAvailable && swapRouter !== null) { try { block = await readBlockNumber(); } catch { block = null; } }
    } catch {
      failure = deriveSellFromBuy && direction === "sell" && sellAmount === BigInt(0) ? "no-reference-amount" : "provider-unavailable";
    }
    let permit2Compatible = false;
    let permit2Reason: string | null = null;
    let spenderMatchesTarget = false;
    let targetMatchesRouter = false;
    let calldataMatches = false;
    let actionSelectors: string[] | null = null;
    let actionsVerified = false as boolean | null;
    let quoteCompatible = false;
    let compatibilityReason: string | null = failure ?? "no-liquidity";
    let allowanceSpenderIsPermit2: boolean | null = null;
    let simulationIncomplete: boolean | null = null;
    let balanceIssue = false;
    let executionReadiness = failure ?? "no-liquidity";
    if (quote.liquidityAvailable) {
      ({ targetMatchesRouter, calldataMatches, actionSelectors, actionsVerified } = swapExecutionMatches(request, quote, swapRouter ?? "0x0000000000000000000000000000000000000000"));
      if (swapRouter === null || block === null) { actionsVerified = null; compatibilityReason = "chain-unavailable"; executionReadiness = "chain-unavailable"; }
      allowanceSpenderIsPermit2 = quote.issues.allowance === null ? null : quote.issues.allowance.spender === PERMIT2_ADDRESS;
      simulationIncomplete = quote.issues.simulationIncomplete;
      balanceIssue = quote.issues.balance !== null;
      if (quote.permit2) {
        try {
          const permit = validatePermit2({
            eip712: quote.permit2.eip712, providerHash: quote.permit2.hash,
            token: providerRequest.fromToken, amount: request.fromAmount, now,
          });
          permit2Compatible = true;
          spenderMatchesTarget = permit.spender === quote.transaction.to;
        } catch (error) {
          permit2Reason = error instanceof TradePreparationError ? error.reason : "provider-unavailable";
        }
      } else {
        permit2Reason = "quote-rejected";
      }
      if (block !== null && swapRouter !== null) {
        try {
          checkQuoteCompatibility({ request, quote, now, currentBlockNumber: block, swapRouter });
          quoteCompatible = true;
          compatibilityReason = null;
        } catch (error) {
          compatibilityReason = error instanceof TradePreparationError ? error.reason : "provider-unavailable";
        }
        let makerFailure: string | null = null;
        if (actionsVerified && actionSelectors?.includes("0xd92aadfb")) {
          try {
            if (!read) throw new TradePreparationError("provider-unavailable");
            await verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, quote, swapRouter), read, `0x${block.toString(16)}`);
          } catch (error) {
            makerFailure = error instanceof TradePreparationError ? error.reason : "provider-unavailable";
            actionsVerified = false;
          }
        }
        try {
          validateSwapQuote({ request, quote, now, currentBlockNumber: block, swapRouter });
          executionReadiness = makerFailure ?? "ready";
        } catch (error) {
          executionReadiness = makerFailure ?? (error instanceof TradePreparationError ? error.reason : "provider-unavailable");
        }
      }
    }
    directions.push({
      chain: block === null || swapRouter === null ? "unavailable" : "available",
      direction, requestedAmount: request.fromAmount.toString(), priceLiquidityAvailable,
      quoteLiquidityAvailable: quote.liquidityAvailable,
      permit2Present: quote.liquidityAvailable && quote.permit2 !== null,
      permit2Compatible, permit2Reason, spenderMatchesTarget, targetMatchesRouter, calldataMatches,
      actionSelectors, actionsVerified, quoteCompatible, compatibilityReason, allowanceSpenderIsPermit2,
      simulationIncomplete, balanceIssue, executionReadiness,
    });
  }
  return {
    date: now.toISOString(),
    endpointPaths: { price: PRICE_PATH, quote: SWAPS_PATH },
    schema: `CDP OpenAPI 2.0.0 / @coinbase/cdp-sdk ${cdpPackage.version}`,
    directions,
  };
}
