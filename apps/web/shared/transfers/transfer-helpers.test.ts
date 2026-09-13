import { describe, expect, test } from "bun:test";
import {
  encodeErc20Transfer,
  encodeUsdcTransfer,
  getTransferAsset,
  transferRequestFromAction,
  formatSendConfirmAmount,
  formatTransferAmount,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "./transfer-helpers";
import { TransferExecutionError } from "./types";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;

describe("transfer amount helpers", () => {
  test("parses human amounts into exact integer base units without floating point", () => {
    expect(parseTransferAmount("1.000001", 6)).toBe("1000001");
    expect(parseTransferAmount("0.000000000000000001", 18)).toBe("1");
    expect(formatTransferAmount("1000001", 6)).toBe("1.000001");
    expect(formatSendConfirmAmount("25000000", "usdc")).toBe("$25.00");
    expect(formatSendConfirmAmount("1000001", "usdc")).toBe("$1.000001");
    expect(formatSendConfirmAmount("1234560000", "usdc")).toBe("$1,234.56");
    expect(formatSendConfirmAmount("1", "eth")).toBe("0.000000000000000001\u00A0ETH");
    expect(formatSendConfirmAmount("100000", "cbbtc")).toBe("0.001\u00A0cbBTC");
  });

  test("rejects exponent notation, excess precision, zero, and malformed addresses", () => {
    for (const value of ["1e-6", "1.0000001", "0", "-1", ".5", "01"]) {
      expect(() => parseTransferAmount(value, 6)).toThrow(TransferExecutionError);
    }
    expect(() => normalizeTransferRecipient("0x1234")).toThrow(TransferExecutionError);
    expect(() => normalizeTransferRecipient("0x0000000000000000000000000000000000000000")).toThrow(TransferExecutionError);
  });

  test("encodes catalog ERC-20 transfers with the token as target", () => {
    expect(encodeUsdcTransfer(RECIPIENT, BigInt(1))).toBe(
      `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}`,
    );
    expect(encodeErc20Transfer(
      "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      RECIPIENT,
      BigInt(100_000),
    )).toEqual({
      to: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(100_000).toString(16).padStart(64, "0")}`,
      value: BigInt(0),
    });
  });
});

describe("transferRequestFromAction re-validates a resumed send against the catalog", () => {
  const OWNER = { subject: "s", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
  const usdc = getTransferAsset("usdc")!;
  const cbbtc = getTransferAsset("cbbtc")!;
  const eth = getTransferAsset("eth")!;
  const erc20 = (asset: typeof usdc, amount: bigint, recipient: `0x${string}` = RECIPIENT) => {
    const call = encodeErc20Transfer(asset.contractAddress!, recipient, amount);
    return { to: call.to, data: call.data, value: call.value.toString() };
  };
  const amount = (asset: typeof usdc, amountBaseUnits: string, overrides: Partial<{ symbol: string; decimals: number; assetId: string }> = {}) => ({
    assetId: overrides.assetId ?? asset.id,
    symbol: overrides.symbol ?? asset.symbol,
    decimals: overrides.decimals ?? asset.decimals,
    amountBaseUnits,
    direction: "spend" as const,
  });
  const action = (calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: string }>, amounts: ReturnType<typeof amount>[], kind = "send") => ({
    id: "a", kind: kind as "send", title: "Send", calls, amounts, warnings: [], expiresAt: "2099-01-01T00:00:00.000Z", owner: OWNER, createdAt: "2026-09-12T00:00:00.000Z",
  });

  test.each([
    ["usdc happy path", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000")]), { assetId: "usdc", recipient: RECIPIENT, amountBaseUnits: "1000000" }],
    ["cbbtc happy path", action([erc20(cbbtc, BigInt(100000))], [amount(cbbtc, "100000")]), { assetId: "cbbtc", recipient: RECIPIENT, amountBaseUnits: "100000" }],
    ["native eth happy path", action([{ to: RECIPIENT, data: "0x", value: "1000" }], [amount(eth, "1000")]), { assetId: "eth", recipient: RECIPIENT, amountBaseUnits: "1000" }],
    ["wrong token target", action([{ ...erc20(usdc, BigInt(1000000)), to: cbbtc.contractAddress! }], [amount(usdc, "1000000")]), null],
    ["amount mismatch", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "2000000")]), null],
    ["decimals mismatch", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000", { decimals: 18 })]), null],
    ["symbol mismatch", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000", { symbol: "USDT" })]), null],
    ["non-zero value on erc20", action([{ ...erc20(usdc, BigInt(1000000)), value: "1" }], [amount(usdc, "1000000")]), null],
    ["recognized-only asset", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000", { assetId: "recognized:0xabc" })]), null],
    ["native value mismatch", action([{ to: RECIPIENT, data: "0x", value: "999" }], [amount(eth, "1000")]), null],
    ["native with calldata", action([{ to: RECIPIENT, data: "0xa9059cbb", value: "1000" }], [amount(eth, "1000")]), null],
    ["two calls", action([erc20(usdc, BigInt(1000000)), erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000")]), null],
    ["not a send", action([erc20(usdc, BigInt(1000000))], [amount(usdc, "1000000")], "savings-deposit"), null],
  ] as const)("%s", (_name, prepared, expected) => {
    expect(transferRequestFromAction(prepared as never)).toEqual(expected);
  });
});
