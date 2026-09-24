import { describe, expect, test } from "bun:test";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
} from "./activity-presenter";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import {
  activityAssets,
  type ActivityAsset,
  type ActivityDirection,
  type ActivityTransfer,
} from "./types";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TRANSACTION_HASH = `0x${"a".repeat(64)}` as const;
const UTC = { timeZone: "UTC" } as const;

const usdc = requireAsset("usdc");
const cbbtc = requireAsset("cbbtc");

function requireAsset(id: NonNullable<ActivityTransfer["assetId"]>): ActivityAsset {
  const asset = activityAssets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing test asset ${id}.`);
  return asset;
}

function transfer(
  direction: ActivityDirection,
  overrides: Partial<ActivityTransfer> = {},
): ActivityTransfer {
  const tokenAddress = overrides.tokenAddress ?? usdc.tokenAddress;
  const logId = overrides.logId ?? `event-${direction}`;
  return {
    id: `8453:${tokenAddress.toLowerCase()}:${logId}`,
    logId,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress,
    tokenSymbol: usdc.symbol,
    tokenDecimals: usdc.decimals,
    tokenImageUrl: null,
    walletAddress: WALLET,
    fromAddress: direction === "incoming" ? OTHER : WALLET,
    toAddress: direction === "outgoing" ? OTHER : WALLET,
    direction,
    amountBaseUnits: "1000001",
    blockNumber: "20",
    blockHash: `0x${"b".repeat(64)}`,
    transactionHash: TRANSACTION_HASH,
    logIndex: "1",
    blockTimestamp: "2026-09-07T11:05:00.000Z",
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
    ...overrides,
  };
}

describe("presentActivityTransferRow", () => {
  test("presents incoming, outgoing, and self direction semantics", () => {
    expect(presentActivityTransferRow(transfer("incoming"), UTC)).toMatchObject({
      directionLabel: "Received",
      iconKey: "incoming",
      valueTone: "success",
      sign: "+",
      value: "+1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("outgoing"), UTC)).toMatchObject({
      directionLabel: "Sent",
      iconKey: "outgoing",
      valueTone: "default",
      sign: "−",
      value: "−1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("self"), UTC)).toMatchObject({
      directionLabel: "Self transfer",
      iconKey: "self",
      valueTone: "default",
      sign: "",
      value: "1.00 USDC",
    });
  });

  test("keeps USDC cash formatting and contract-resolved non-USDC decimals", () => {
    expect(
      presentActivityTransferRow(
        transfer("incoming", { amountBaseUnits: "1234567890000" }),
        UTC,
      ).value,
    ).toBe("+1,234,567.89 USDC");

    expect(
      presentActivityTransferRow(
        transfer("outgoing", {
          assetId: "cbbtc",
          tokenAddress: cbbtc.tokenAddress,
          tokenSymbol: cbbtc.symbol,
          tokenDecimals: cbbtc.decimals,
          amountBaseUnits: "123450000",
        }),
        UTC,
      ).value,
    ).toBe("−1.2345 cbBTC");
  });

  test("presents incoming ZORA with exact contract and dynamic decimals", () => {
    const tokenAddress = "0x1111111111166b7fe7bd91427724b487980afc69" as const;
    const zora = transfer("incoming", {
      id: `8453:${tokenAddress}:zora-log`,
      logId: "zora-log",
      assetId: null,
      tokenAddress,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
      amountBaseUnits: "1000000000000000001",
    });

    expect(presentActivityTransferRow(zora, UTC).value).toBe("+1 ZORA");
    const details = presentActivityTransferDetails(zora, UTC);
    expect(details.title).toBe("Received ZORA");
    expect(details.rows).toContainEqual({
      label: "Amount",
      value: "+1.000000000000000001 ZORA",
    });
    expect(details.rows).toContainEqual({
      label: "Token contract",
      value: tokenAddress,
      display: "0x1111…0afc69",
    });
  });

  test("presents unknown contracts honestly without a USDC fallback", () => {
    const tokenAddress = "0x4444444444444444444444444444444444444444" as const;
    const unknown = transfer("incoming", {
      id: `8453:${tokenAddress}:unknown-log`,
      logId: "unknown-log",
      assetId: null,
      tokenAddress,
      tokenSymbol: null,
      tokenDecimals: null,
      amountBaseUnits: "123456789",
    });

    expect(presentActivityTransferRow(unknown, UTC).value).toBe(
      "+123456789 base units",
    );
    const details = presentActivityTransferDetails(unknown, UTC);
    expect(details.title).toBe("Received unknown token");
    expect(details.rows).toContainEqual({
      label: "Amount",
      value: "+123456789 base units · unknown token",
    });
    expect(details.rows).toContainEqual({
      label: "Token contract",
      value: tokenAddress,
      display: "0x4444…444444",
    });
  });

  test("derives exact owner-fenced detail rows and contract identity", () => {
    const details = presentActivityTransferDetails(transfer("incoming"), UTC);

    expect(details.title).toBe("Received USDC");
    expect(details.rows).toContainEqual({ label: "Amount", value: "+1.000001 USDC" });
    expect(details.rows).toContainEqual({ label: "From", value: OTHER, display: "0x2222…222222" });
    expect(details.rows).toContainEqual({ label: "To", value: WALLET, display: "0x1111…111111" });
    expect(details.rows).toContainEqual({
      label: "Token contract",
      value: usdc.tokenAddress,
      display: "0x8335…A02913",
    });
    expect(details.rows).toContainEqual({ label: "Status", value: "Confirmed" });
    expect(details.rows).toContainEqual({ label: "Block", value: "20" });
    expect(details.explorer).toEqual({
      href: `https://basescan.org/tx/${TRANSACTION_HASH}`,
      label: "View on explorer",
      title: "View the transaction on BaseScan",
    });
  });

  test("keeps exact outgoing and self amounts without presentation rounding", () => {
    expect(
      presentActivityTransferDetails(
        transfer("outgoing", { amountBaseUnits: "123450000" }),
        UTC,
      ).rows,
    ).toContainEqual({ label: "Amount", value: "−123.45 USDC" });
    expect(presentActivityTransferDetails(transfer("self"), UTC).title).toBe(
      "Self transfer USDC",
    );
  });
});

describe("activity transfer valuation presentation", () => {
  const TEST = "0x5555555555555555555555555555555555555555" as const;
  const priceUsd = { atoms: "2173291", scale: 7 };

  function volatile(
    direction: ActivityDirection,
    amountBaseUnits = "56780000000000000000",
    valuation?: ActivityTransfer["valuation"],
  ): ActivityTransfer {
    return transfer(direction, {
      id: `8453:${TEST}:test-${direction}`,
      assetId: null,
      tokenAddress: TEST,
      tokenSymbol: "TEST",
      tokenDecimals: 18,
      amountBaseUnits,
      valuation: valuation ?? {
        status: "priced",
        currency: "USD",
        amount: computeActivityValuationAmount({
          amountBaseUnits,
          tokenDecimals: 18,
          unitPrice: priceUsd,
          fxRate: null,
        }),
        method: "historical-close",
        peg: null,
        close: {
          provider: "Codex",
          closedAt: "2026-09-07T11:00:00.000Z",
          resolutionMinutes: 15,
          priceUsd,
        },
        fx: null,
      },
    });
  }

  test("puts signed fiat above signed native quantity for every direction", () => {
    expect(presentActivityTransferRow(volatile("incoming"), UTC)).toMatchObject({
      value: "+$12.34",
      valueContext: "+56 TEST",
      priced: true,
    });
    expect(presentActivityTransferRow(volatile("outgoing"), UTC)).toMatchObject({
      value: "−$12.34",
      valueContext: "−56 TEST",
    });
    expect(presentActivityTransferRow(volatile("self"), UTC)).toMatchObject({
      directionLabel: "Self transfer",
      value: "$12.34",
      valueContext: "56 TEST",
    });
  });

  test("marks sub-cent value instead of rounding it to zero", () => {
    expect(presentActivityTransferRow(volatile("incoming", "1000"), UTC)).toMatchObject({
      value: "+<$0.01",
      priced: true,
    });
  });

  test("keeps native quantity as the only amount when the transfer is unpriced", () => {
    const unpriced = volatile("incoming", "56780000000000000000", {
      status: "unpriced",
      currency: "USD",
      reason: "no-recent-close",
    });
    expect(presentActivityTransferRow(unpriced, UTC)).toMatchObject({
      value: "+56 TEST",
      valueContext: null,
      priced: false,
    });
    expect(presentActivityTransferDetails(unpriced, UTC).rows).toContainEqual({
      label: "Value",
      value: "Not priced · no market close within 1 hour before transfer",
    });
  });

  test("shows the same value plus quote time, source, and method in details", () => {
    const rows = presentActivityTransferDetails(volatile("incoming"), UTC).rows;
    expect(rows).toContainEqual({ label: "Amount", value: "+56.78 TEST" });
    expect(rows).toContainEqual({ label: "Value", value: "+$12.34" });
    expect(rows).toContainEqual({
      label: "Valuation",
      value: "Historical close · Codex 15-minute USD bar",
    });
    expect(rows).toContainEqual({ label: "Quote time", value: "Sep 7, 2026, 11:00 AM" });
    expect(rows).toContainEqual({ label: "Unit price", value: "$0.2173291 per TEST" });
  });

  test("describes stablecoin peg and daily FX provenance", () => {
    const rows = presentActivityTransferDetails(transfer("incoming", {
      amountBaseUnits: "10000000",
      valuation: {
        status: "priced",
        currency: "EUR",
        amount: computeActivityValuationAmount({
          amountBaseUnits: "10000000",
          tokenDecimals: 6,
          unitPrice: null,
          fxRate: { atoms: "8608", scale: 4 },
        }),
        method: "peg",
        peg: "USD",
        close: null,
        fx: {
          provider: "Coinbase",
          base: "USD",
          quote: "EUR",
          date: "2026-09-07",
          rate: { atoms: "8608", scale: 4 },
          provisional: true,
        },
      },
    }), { ...UTC, regionId: "US" }).rows;
    expect(rows).toContainEqual({ label: "Value", value: "+€8.61" });
    expect(rows).toContainEqual({ label: "Valuation", value: "Stablecoin peg · 1 USDC = 1 USD" });
    expect(rows).toContainEqual({
      label: "Exchange rate",
      value: "1 USD = 0.8608 EUR · Coinbase daily rate 2026-09-07 UTC (provisional until the UTC day closes)",
    });
  });
});
