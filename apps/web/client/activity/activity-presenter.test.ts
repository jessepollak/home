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
    expect(details.header?.amount).toBe("+1.000000000000000001 ZORA");
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
    expect(details.header).toMatchObject({
      amount: "+123456789 base units",
      tone: "success",
      status: { label: "Confirmed", tone: "success" },
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
    expect(details.header).toEqual({
      amount: "+1.000001 USDC",
      tone: "success",
      status: { label: "Confirmed", tone: "success" },
    });
    expect(details.rows.map((row) => row.label)).toEqual([
      "Value", "From", "Token contract", "Network", "Date", "Transaction",
    ]);
    expect(details.rows).toContainEqual({ label: "Value", value: "Unknown" });
    expect(details.rows).toContainEqual({ label: "From", value: OTHER, display: "0x2222…222222" });
    expect(details.rows).toContainEqual({
      label: "Token contract",
      value: usdc.tokenAddress,
      display: "0x8335…A02913",
    });
    expect(details.rows).toContainEqual({ label: "Network", value: "Base", network: "base" });
    expect(details.rows.some((row) => row.value.includes("8453"))).toBe(false);
    expect(details.explorer).toEqual({
      href: `https://basescan.org/tx/${TRANSACTION_HASH}`,
      label: "View on explorer",
      title: "View the transaction on BaseScan",
    });
  });

  test("keeps exact outgoing and self amounts without presentation rounding", () => {
    const outgoing = presentActivityTransferDetails(
      transfer("outgoing", { amountBaseUnits: "123450000" }), UTC,
    );
    expect(outgoing.header).toEqual({
      amount: "−123.45 USDC", tone: "default", status: { label: "Confirmed", tone: "success" },
    });
    expect(outgoing.rows.map((row) => row.label)).toEqual([
      "Value", "From", "To", "Token contract", "Network", "Date", "Transaction",
    ]);
    expect(outgoing.rows).toContainEqual({ label: "To", value: OTHER, display: "0x2222…222222" });
    const self = presentActivityTransferDetails(transfer("self"), UTC);
    expect(self.title).toBe("Self transfer USDC");
    expect(self.header).toEqual({
      amount: "1.000001 USDC", tone: "default", status: { label: "Confirmed", tone: "success" },
    });
    expect(self.rows).toContainEqual({ label: "To", value: WALLET, display: "0x1111…111111" });
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
      label: "Value", value: "Unknown",
    });
  });

  test("reports Unknown for every unpriced reason without inventing a zero value", () => {
    for (const reason of ["unknown-token", "no-recent-close", "quote-unavailable", "fx-unavailable"] as const) {
      const details = presentActivityTransferDetails(volatile("incoming", undefined, {
        status: "unpriced", currency: "USD", reason,
      }), UTC);
      expect(details.rows.find((row) => row.label === "Value")?.value).toBe("Unknown");
      expect(details.rows.some((row) => row.value.includes("$0"))).toBe(false);
    }
  });

  test("keeps the priced value without provenance rows in details", () => {
    const details = presentActivityTransferDetails(volatile("incoming"), UTC);
    expect(details.header?.amount).toBe("+56.78 TEST");
    expect(details.rows).toContainEqual({ label: "Value", value: "+$12.34" });
    expect(details.rows.map((row) => row.label)).toEqual([
      "Value", "From", "Token contract", "Network", "Date", "Transaction",
    ]);
  });

  test("keeps the priced FX value without provenance rows", () => {
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
    expect(rows.map((row) => row.label)).toEqual([
      "Value", "From", "Token contract", "Network", "Date", "Transaction",
    ]);
  });
});
