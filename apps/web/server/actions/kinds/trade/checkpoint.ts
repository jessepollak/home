import "server-only";

import cdpPackage from "../../../../node_modules/@coinbase/cdp-sdk/package.json";
import type { Address } from "@/shared/trading/server-types";
import type { CdpSwapsClient, SwapQuote } from "./cdp-swaps";
import { PRICE_PATH, SWAPS_PATH } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError, validatePermit2 } from "./permit2";
import { checkQuoteCompatibility, rfqMakerAuthorizations, swapExecutionMatches, swapTokens, validateSwapQuote, type SwapDirection } from "./quote";
import { verifyRfqMakerAuthorizations } from "./rfq-maker";

const ACCEPTABLE_READINESS = new Set(["ready", "insufficient-balance", "unverified-actions"]);

export type CheckpointAmounts = { buy: bigint; sell: bigint };
export function checkpointExitCode(report: Awaited<ReturnType<typeof runSwapsCheckpoint>>): 0 | 2 {
  return report.directions.every((row) =>
    row.priceLiquidityAvailable && row.quoteLiquidityAvailable && row.permit2Compatible && row.spenderMatchesTarget &&
    row.targetMatchesRouter && row.calldataMatches && row.quoteCompatible && ACCEPTABLE_READINESS.has(row.executionReadiness),
  ) ? 0 : 2;
}

export async function runSwapsCheckpoint({ client, taker, amounts, now, readBlockNumber, readSwapRouter, read }: {
  client: CdpSwapsClient;
  taker: Address;
  amounts: CheckpointAmounts;
  now: Date;
  readBlockNumber: () => Promise<bigint>;
  readSwapRouter: () => Promise<Address>;
  read?: (method: string, params: readonly unknown[]) => Promise<unknown>;
}) {
  const swapRouter = await readSwapRouter();
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
    actionsVerified: boolean;
    quoteCompatible: boolean;
    compatibilityReason: string | null;
    allowanceSpenderIsPermit2: boolean | null;
    simulationIncomplete: boolean | null;
    balanceIssue: boolean;
    executionReadiness: "ready" | string;
  }>;
  for (const direction of ["buy", "sell"] as const) {
    const request = { direction, fromAmount: amounts[direction], taker, slippageBps: 100 };
    const providerRequest = { ...swapTokens(direction), fromAmount: request.fromAmount, taker, slippageBps: request.slippageBps };
    let priceLiquidityAvailable = false;
    let quote: SwapQuote = { liquidityAvailable: false };
    let failure: string | null = null;
    let block: bigint | null = null;
    try {
      const price = await client.getPrice(providerRequest);
      priceLiquidityAvailable = price.liquidityAvailable;
      quote = await client.createQuote(providerRequest);
      if (quote.liquidityAvailable) block = await readBlockNumber();
    } catch {
      failure = "provider-unavailable";
    }
    let permit2Compatible = false;
    let permit2Reason: string | null = null;
    let spenderMatchesTarget = false;
    let targetMatchesRouter = false;
    let calldataMatches = false;
    let actionSelectors: string[] | null = null;
    let actionsVerified = false;
    let quoteCompatible = false;
    let compatibilityReason: string | null = failure ?? "no-liquidity";
    let allowanceSpenderIsPermit2: boolean | null = null;
    let simulationIncomplete: boolean | null = null;
    let balanceIssue = false;
    let executionReadiness = failure ?? "no-liquidity";
    if (quote.liquidityAvailable) {
      ({ targetMatchesRouter, calldataMatches, actionSelectors, actionsVerified } = swapExecutionMatches(request, quote, swapRouter));
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
      if (block !== null) {
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
