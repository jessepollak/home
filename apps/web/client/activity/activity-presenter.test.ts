import { describe, expect, test } from "bun:test";
import {
  presentActivityTransferDetails,
  presentActivityTransferRow,
  type ActivityRowViewModel,
} from "./activity-presenter";
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
    ...overrides,
  };
}

function expectSerializable(model: ActivityRowViewModel) {
  expect(JSON.parse(JSON.stringify(model))).toEqual(model);
}

describe("presentActivityTransferRow", () => {
  test("presents incoming, outgoing, and self direction semantics", () => {
    expect(presentActivityTransferRow(transfer("incoming"), UTC)).toMatchObject({
      directionLabel: "Received",
      iconKey: "incoming",
      iconTone: "incoming",
      sign: "+",
      value: "+1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("outgoing"), UTC)).toMatchObject({
      directionLabel: "Sent",
      iconKey: "outgoing",
      iconTone: "outgoing",
      sign: "−",
      value: "−1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("self"), UTC)).toMatchObject({
      directionLabel: "Self transfer",
      iconKey: "self",
      iconTone: "self",
      sign: "",
      value: "1.00 USDC",
    });
  });

  test("uses the runtime formatter with an explicit timezone for deterministic dates", () => {
    const timestamp = "2026-09-07T11:05:00.000Z";
    const utc = presentActivityTransferRow(transfer("incoming"), UTC);
    const pacific = presentActivityTransferRow(transfer("incoming"), {
      timeZone: "America/Los_Angeles",
    });

    expect(utc).toMatchObject({
      dateTime: timestamp,
      fullDate: "Sep 7, 2026, 11:05 AM",
      shortDate: "Sep 7, 11:05 AM",
    });
    expect(pacific).toMatchObject({
      fullDate: "Sep 7, 2026, 4:05 AM",
      shortDate: "Sep 7, 4:05 AM",
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
      value: "0x4444…444444",
      title: tokenAddress,
    });
  });

  test("includes serializable date accessibility metadata without a row explorer link", () => {
    const model = presentActivityTransferRow(transfer("incoming"), UTC);
    expect(model).not.toHaveProperty("explorer");
    expectSerializable(model);
  });
});

describe("presentActivityTransferDetails", () => {
  test("derives exact owner-fenced detail rows and contract identity", () => {
    const details = presentActivityTransferDetails(transfer("incoming"), UTC);

    expect(details.title).toBe("Received USDC");
    expect(details.rows).toContainEqual({ label: "Amount", value: "+1.000001 USDC" });
    expect(details.rows).toContainEqual({ label: "From", value: "0x2222…222222", title: OTHER });
    expect(details.rows).toContainEqual({ label: "To", value: "0x1111…111111", title: WALLET });
    expect(details.rows).toContainEqual({
      label: "Token contract",
      value: "0x8335…A02913",
      title: usdc.tokenAddress,
    });
    expect(details.rows).toContainEqual({ label: "Status", value: "Confirmed" });
    expect(details.rows).toContainEqual({ label: "Block", value: "20" });
    expect(details.explorer).toEqual({
      href: `https://basescan.org/tx/${TRANSACTION_HASH}`,
      label: "View on BaseScan",
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
