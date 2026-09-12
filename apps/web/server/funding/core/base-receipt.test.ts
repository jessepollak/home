import { expect, test } from "bun:test";
import type { FundingOrder } from "./store";
import { verifyBaseFundingReceipt } from "./base-receipt";

const hash = `0x${"2".repeat(64)}` as `0x${string}`;
const destination = "0x1111111111111111111111111111111111111111" as const;
const order = { assetId: "base:idrx", destination, expectedTokenAmountAtomic: "2000000", creationBlock: "100" } as unknown as FundingOrder;
const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function response(overrides: Record<string, unknown> = {}): typeof fetch {
  return (async () => Response.json({ jsonrpc: "2.0", id: 1, result: { status: "0x1", blockNumber: "0x64", logs: [{ address: "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22", topics: [transfer, `0x${"0".repeat(64)}`, `0x${destination.slice(2).padStart(64, "0")}`], data: "0x1e8480", logIndex: "0x3" }], ...overrides } })) as unknown as typeof fetch;
}

test("requires the exact asset, destination, amount and creation block", async () => {
  expect(await verifyBaseFundingReceipt(order, hash, {}, response())).toEqual({ transactionHash: hash, logIndex: 3 });
  expect(await verifyBaseFundingReceipt(order, hash, {}, response({ blockNumber: "0x63" }))).toBeNull();
  expect(await verifyBaseFundingReceipt({ ...order, expectedTokenAmountAtomic: "2000001" }, hash, {}, response())).toBeNull();
});
