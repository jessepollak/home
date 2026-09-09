import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import { createOmittedCashBalanceReader } from "./inventory-cash-rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK = {
  number: "16",
  hash: `0x${"ab".repeat(32)}` as `0x${string}`,
  timestamp: "100",
};

function dataWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("omitted cash RPC reader", () => {
  test("returns RPC 0 as a confirmed amount, not unavailable", async () => {
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
        return Response.json(
          body.map((item) => ({
            jsonrpc: "2.0",
            id: item.id,
            result: dataWord(BigInt(0)),
          })),
        );
      },
    });

    const amounts = await reader(
      [{ id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS }],
      OWNER,
      BLOCK,
      new AbortController().signal,
    );
    expect(amounts.get("usdc")).toBe("0");
  });

  test("throws on abort instead of silently mapping the batch to null", async () => {
    const controller = new AbortController();
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        controller.abort();
        const signal = init?.signal;
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return Response.json([]);
      },
    });

    await expect(
      reader(
        [{ id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS }],
        OWNER,
        BLOCK,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("transport failure stays null and does not invent 0", async () => {
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () => new Response("no", { status: 500 }),
    });

    const amounts = await reader(
      [{ id: "idrx", contractAddress: verifiedLocalCashAssets.IDR.contractAddress }],
      OWNER,
      BLOCK,
      new AbortController().signal,
    );
    expect(amounts.get("idrx")).toBeNull();
  });
});
