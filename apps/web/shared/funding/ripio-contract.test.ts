import { describe, expect, test } from "bun:test";
import {
  exactBaseTransferMatches,
  exactRipioEntitlement,
  ripioAvailability,
  RIPIO_ASSETS,
  type RipioQuoteRequest,
} from "./ripio-contract";

const DESTINATION = "0x1111111111111111111111111111111111111111" as const;

function arQuote(overrides: Partial<RipioQuoteRequest> = {}): RipioQuoteRequest {
  return {
    country: "AR",
    fromCurrency: "ARS",
    toCurrency: "wARS",
    fromAmount: "2100",
    chain: "BASE",
    paymentMethodType: "bank_transfer",
    destination: DESTINATION,
    ...overrides,
  } as RipioQuoteRequest;
}

describe("Ripio shared funding contract", () => {
  test("gates only AR/CO and keeps Brazil blocked on the unresolved BRZ route", () => {
    expect(ripioAvailability("AR")).toMatchObject({ available: true, token: "wARS", chainId: 8453 });
    expect(ripioAvailability("CO")).toMatchObject({ available: true, token: "wCOP", chainId: 8453 });
    expect(ripioAvailability("BR")).toEqual({ available: false, country: "BR", reason: "brazil-asset-unresolved" });
    expect(ripioAvailability("MX")).toBeNull();
  });

  test("requires the exact country token, Base network, destination, rail and decimal amount", () => {
    expect(exactRipioEntitlement(arQuote())).toBe(true);
    expect(exactRipioEntitlement(arQuote({ toCurrency: "wCOP" }))).toBe(false);
    expect(exactRipioEntitlement(arQuote({ chain: "BASE" }))).toBe(true);
    expect(exactRipioEntitlement(arQuote({ paymentMethodType: "breb" }))).toBe(false);
    expect(exactRipioEntitlement(arQuote({ fromAmount: "0" }))).toBe(false);
    expect(exactRipioEntitlement(arQuote({ destination: "0x123" as `0x${string}` }))).toBe(false);
  });

  test("never calls a provider completion Received without exact Base transfer evidence", () => {
    const evidence = {
      chainId: 8453 as const,
      transactionHash: `0x${"ab".repeat(32)}` as const,
      tokenAddress: RIPIO_ASSETS.AR.tokenAddress,
      destination: DESTINATION,
      amountAtomic: "2100000000000000000000",
      blockNumber: "51180068",
      confirmations: 2,
    };
    expect(exactBaseTransferMatches({ evidence, destination: DESTINATION, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, amountAtomic: evidence.amountAtomic, minimumConfirmations: 2 })).toBe(true);
    expect(exactBaseTransferMatches({ evidence: { ...evidence, amountAtomic: "1" }, destination: DESTINATION, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, amountAtomic: evidence.amountAtomic, minimumConfirmations: 2 })).toBe(false);
    expect(exactBaseTransferMatches({ evidence: { ...evidence, confirmations: 0 }, destination: DESTINATION, tokenAddress: RIPIO_ASSETS.AR.tokenAddress, amountAtomic: evidence.amountAtomic, minimumConfirmations: 1 })).toBe(false);
  });
});
