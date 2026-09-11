import { describe, expect, test } from "bun:test";
import {
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

function requireAsset(id: ActivityTransfer["assetId"]): ActivityAsset {
  const asset = activityAssets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing test asset ${id}.`);
  return asset;
}

function transfer(
  direction: ActivityDirection,
  overrides: Partial<ActivityTransfer> = {},
): ActivityTransfer {
  return {
    id: `event-${direction}`,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: usdc.tokenAddress,
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

function expectedActivityDate(
  value: string,
  timeZone: string,
  includeYear: boolean,
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function expectSerializable(model: ActivityRowViewModel) {
  expect(JSON.parse(JSON.stringify(model))).toEqual(model);
}

describe("presentActivityTransferRow", () => {
  test("presents incoming, outgoing, and self direction semantics", () => {
    expect(
      presentActivityTransferRow(transfer("incoming"), usdc, UTC),
    ).toMatchObject({
      directionLabel: "Received",
      iconKey: "incoming",
      iconTone: "incoming",
      sign: "+",
      value: "+1.00 USDC",
    });
    expect(
      presentActivityTransferRow(transfer("outgoing"), usdc, UTC),
    ).toMatchObject({
      directionLabel: "Sent",
      iconKey: "outgoing",
      iconTone: "outgoing",
      sign: "−",
      value: "−1.00 USDC",
    });
    expect(presentActivityTransferRow(transfer("self"), usdc, UTC)).toMatchObject(
      {
        directionLabel: "Self transfer",
        iconKey: "self",
        iconTone: "self",
        sign: "",
        value: "1.00 USDC",
      },
    );
  });

  test("uses the runtime formatter with an explicit timezone for deterministic dates", () => {
    const timestamp = "2026-09-07T11:05:00.000Z";
    const utc = presentActivityTransferRow(transfer("incoming"), usdc, UTC);
    const pacific = presentActivityTransferRow(
      transfer("incoming"),
      usdc,
      { timeZone: "America/Los_Angeles" },
    );

    expect(utc).toMatchObject({
      dateTime: timestamp,
      fullDate: expectedActivityDate(timestamp, "UTC", true),
      shortDate: expectedActivityDate(timestamp, "UTC", false),
    });
    expect(pacific).toMatchObject({
      fullDate: expectedActivityDate(timestamp, "America/Los_Angeles", true),
      shortDate: expectedActivityDate(
        timestamp,
        "America/Los_Angeles",
        false,
      ),
    });
  });

  test("keeps USDC cash formatting and non-USDC token symbols", () => {
    expect(
      presentActivityTransferRow(
        transfer("incoming", { amountBaseUnits: "1234567890000" }),
        usdc,
        UTC,
      ).value,
    ).toBe("+1,234,567.89 USDC");

    expect(
      presentActivityTransferRow(
        transfer("outgoing", {
          assetId: "cbbtc",
          tokenAddress: cbbtc.tokenAddress,
          amountBaseUnits: "123450000",
        }),
        cbbtc,
        UTC,
      ).value,
    ).toBe("−1.2345 cbBTC");
  });

  test("includes serializable BaseScan and date accessibility metadata", () => {
    const model = presentActivityTransferRow(transfer("incoming"), usdc, UTC);

    expect(model.fullDate).toBe(
      expectedActivityDate(transfer("incoming").blockTimestamp, "UTC", true),
    );
    expect(model.explorer).toEqual({
      href: `https://basescan.org/tx/${TRANSACTION_HASH}`,
      label: "View received USDC transfer on BaseScan",
      title: "View on BaseScan",
    });
    expectSerializable(model);
  });

  test("fails closed when validated asset metadata is impossible or mismatched", () => {
    expect(() =>
      presentActivityTransferRow(transfer("incoming"), undefined, UTC),
    ).toThrow("Activity transfer asset metadata is unavailable.");
    expect(() =>
      presentActivityTransferRow(transfer("incoming"), cbbtc, UTC),
    ).toThrow("Activity transfer asset metadata is unavailable.");
  });
});
