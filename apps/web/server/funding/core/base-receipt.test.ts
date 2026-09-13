import { describe, expect, test } from "bun:test";
import { fundingAssets } from "@/shared/funding/assets";
import type { FundingOrder } from "./store";
import { readCurrentBaseBlock, verifyBaseFundingReceipt } from "./base-receipt";

const hash = `0x${"2".repeat(64)}` as `0x${string}`;
const destination = "0x1111111111111111111111111111111111111111" as const;
const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function order(assetId: string, amount = "2000000"): FundingOrder {
  return { assetId, destination, expectedTokenAmountAtomic: amount, creationBlock: "100" } as unknown as FundingOrder;
}

function response(address: string, overrides: Record<string, unknown> = {}): typeof fetch {
  return (async () => Response.json({ jsonrpc: "2.0", id: 1, result: { status: "0x1", blockNumber: "0x64", logs: [{ address, topics: [transfer, `0x${"0".repeat(64)}`, `0x${destination.slice(2).padStart(64, "0")}`], data: "0x1e8480", logIndex: "0x3" }], ...overrides } })) as unknown as typeof fetch;
}

describe("Base funding receipt verification", () => {
  test("matches every funding asset through the shared asset catalog", async () => {
    for (const asset of Object.values(fundingAssets)) {
      await expect(verifyBaseFundingReceipt(order(asset.id), hash, {}, response(asset.address))).resolves.toEqual({ transactionHash: hash, logIndex: 3 });
    }
  });

  test("requires the exact asset, destination, amount and creation block", async () => {
    const asset = fundingAssets["base:idrx"];
    expect(await verifyBaseFundingReceipt(order(asset.id), hash, {}, response(asset.address, { blockNumber: "0x63" }))).toBeNull();
    expect(await verifyBaseFundingReceipt(order(asset.id, "2000001"), hash, {}, response(asset.address))).toBeNull();
    expect(await verifyBaseFundingReceipt(order("base:unknown"), hash, {}, response(asset.address))).toBeNull();
  });

  test("resolves and normalizes the configured Base RPC URL", async () => {
    let requestedUrl = "";
    const fetchImplementation = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x64" });
    }) as unknown as typeof fetch;
    await expect(readCurrentBaseBlock({ BASE_RPC_URL: "http://127.0.0.1:8545/" }, fetchImplementation)).resolves.toBe("100");
    expect(requestedUrl).toBe("http://127.0.0.1:8545");
  });
});
