import { expect, test } from "bun:test";
import { parseActivityTransferValuation } from "./valuation";

const blockTimestamp = "2026-09-07T11:00:00.000Z";
const transfer = {
  tokenAddress: "0x5555555555555555555555555555555555555555",
  tokenDecimals: 18,
  amountBaseUnits: "1000000000000000000",
  blockTimestamp,
};

function valuation(closedAt: string) {
  return {
    status: "priced",
    currency: "USD",
    amount: { atoms: "2000000000000000000", scale: 18 },
    method: "historical-close",
    peg: null,
    close: {
      provider: "Codex",
      closedAt,
      resolutionMinutes: 15,
      priceUsd: { atoms: "2", scale: 0 },
    },
    fx: null,
  };
}

test("shared valuation parser accepts a close 24 hours before transfer, but no earlier or later than the transfer", () => {
  expect(parseActivityTransferValuation(valuation("2026-09-06T11:00:00.000Z"), transfer, "USD")).toMatchObject({
    status: "priced", close: { closedAt: "2026-09-06T11:00:00.000Z" },
  });
  for (const closedAt of ["2026-09-06T10:59:59.000Z", "2026-09-07T11:00:01.000Z"]) {
    expect(parseActivityTransferValuation(valuation(closedAt), transfer, "USD")).toEqual({
      status: "unpriced", currency: "USD", reason: "quote-unavailable",
    });
  }
});
