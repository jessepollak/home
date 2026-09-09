import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import { createOmittedCashBalanceReader } from "./inventory-cash-rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

function dataWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("omitted cash RPC reader", () => {
  test("returns RPC 0 as a confirmed amount, not unavailable", async () => {
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params: unknown[];
        };
        expect(Array.isArray(body)).toBeFalse();
        expect(body.method).toBe("eth_call");
        expect(body.params[1]).toBe("latest");
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: dataWord(BigInt(0)),
        });
      },
    });

    const amounts = await reader(
      [{ id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS }],
      OWNER,
      new AbortController().signal,
    );
    expect(amounts.get("usdc")).toBe("0");
  });

  test("recovers confirmed 0 when a JSON-RPC batch would be rate-limited", async () => {
    const bodies: unknown[] = [];
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as unknown;
        bodies.push(body);
        if (Array.isArray(body)) {
          return Response.json(
            body.map((item: { id: number }) => ({
              jsonrpc: "2.0",
              id: item.id,
              error: { code: -32016, message: "over rate limit" },
            })),
          );
        }
        const request = body as { id: number; params: unknown[] };
        expect(request.params[1]).toBe("latest");
        return Response.json({
          jsonrpc: "2.0",
          id: "1",
          result: "0x0",
        });
      },
    });

    const amounts = await reader(
      [
        { id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS },
        {
          id: "idrx",
          contractAddress: verifiedLocalCashAssets.IDR.contractAddress,
        },
      ],
      OWNER,
      new AbortController().signal,
    );
    expect(bodies.every((body) => !Array.isArray(body))).toBeTrue();
    expect(amounts.get("usdc")).toBe("0");
    expect(amounts.get("idrx")).toBe("0");
  });

  test("throws on abort instead of silently mapping the read to null", async () => {
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
      new AbortController().signal,
    );
    expect(amounts.get("idrx")).toBeNull();
  });

  test("empty 0x result stays null and does not invent 0", async () => {
    const reader = createOmittedCashBalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: "0x" }),
    });

    const amounts = await reader(
      [{ id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS }],
      OWNER,
      new AbortController().signal,
    );
    expect(amounts.get("usdc")).toBeNull();
  });
});
