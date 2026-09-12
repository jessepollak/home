import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  getDirectPortfolioAssets,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import {
  CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS,
  CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT,
  createConfiguredErc20BalanceReader,
} from "./inventory-erc20-rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

function dataWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("configured ERC-20 RPC recovery", () => {
  test("binds latest balanceOf to the verified owner and keeps confirmed zero", async () => {
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params: Array<{ to: string; data: string } | string>;
        };
        expect(Array.isArray(body)).toBeFalse();
        expect(body.method).toBe("eth_call");
        expect(body.params[1]).toBe("latest");
        expect(body.params[0]).toEqual({
          to: PORTFOLIO_USDC_ADDRESS.toLowerCase(),
          data: `0x70a08231${OWNER.slice(2).padStart(64, "0")}`,
        });
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

  test("dedupes contracts, preserves partial success, and never sends a batch", async () => {
    const bodies: unknown[] = [];
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          params: Array<{ to: string } | string>;
        };
        bodies.push(body);
        const target = (body.params[0] as { to: string }).to;
        if (target === verifiedLocalCashAssets.IDR.contractAddress.toLowerCase()) {
          return new Response("upstream miss", { status: 503 });
        }
        return Response.json({ jsonrpc: "2.0", id: "1", result: "0x5" });
      },
    });

    const amounts = await reader(
      [
        { id: "usdc-a", contractAddress: PORTFOLIO_USDC_ADDRESS },
        { id: "usdc-b", contractAddress: PORTFOLIO_USDC_ADDRESS.toLowerCase() as `0x${string}` },
        { id: "idrx", contractAddress: verifiedLocalCashAssets.IDR.contractAddress },
      ],
      OWNER,
      new AbortController().signal,
    );
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => !Array.isArray(body))).toBeTrue();
    expect(amounts.get("usdc-a")).toBe("5");
    expect(amounts.get("usdc-b")).toBe("5");
    expect(amounts.get("idrx")).toBeNull();
  });

  test("keeps completed singles when the helper stage deadline aborts a later call", async () => {
    const controller = new AbortController();
    let calls = 0;
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        calls += 1;
        if (calls === 1) {
          return Response.json({ jsonrpc: "2.0", id: 1, result: "0x5" });
        }
        queueMicrotask(() =>
          controller.abort(CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT),
        );
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("stage deadline", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const amounts = await reader(
      [
        { id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS },
        { id: "idrx", contractAddress: verifiedLocalCashAssets.IDR.contractAddress },
        { id: "eurc", contractAddress: verifiedLocalCashAssets.EUR.contractAddress },
      ],
      OWNER,
      controller.signal,
    );
    expect(calls).toBe(2);
    expect(amounts).toEqual(
      new Map<string, string | null>([
        ["usdc", "5"],
        ["idrx", null],
        ["eurc", null],
      ]),
    );
  });

  test("covers the fixed configured Base ERC-20 set within the 20-contract bound", async () => {
    const configured = getDirectPortfolioAssets().filter(
      (asset): asset is typeof asset & { contractAddress: `0x${string}` } =>
        asset.kind === "erc20" && asset.contractAddress !== null,
    );
    expect(configured).toHaveLength(CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS);

    let calls = 0;
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ jsonrpc: "2.0", id: 1, result: dataWord(BigInt(calls)) });
      },
    });
    const amounts = await reader(configured, OWNER, new AbortController().signal);
    expect(calls).toBe(CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS);
    expect(amounts.size).toBe(CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS);
  });

  test("fails closed before transport when the deduped request exceeds the bound", async () => {
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () => {
        throw new Error("transport must not run");
      },
    });
    const requests = Array.from(
      { length: CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS + 1 },
      (_, index) => ({
        id: `asset-${index}`,
        contractAddress: `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
      }),
    );
    await expect(
      reader(requests, OWNER, new AbortController().signal),
    ).rejects.toThrow("fixed contract bound");
  });

  test("throws on abort instead of silently mapping the read to null", async () => {
    const controller = new AbortController();
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (_input, init) => {
        controller.abort();
        if (init?.signal?.aborted) {
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

  test("rejects an already-aborted external caller before transport", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("request canceled", "AbortError"));
    let calls = 0;
    const reader = createConfiguredErc20BalanceReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0" });
      },
    });

    await expect(
      reader(
        [{ id: "usdc", contractAddress: PORTFOLIO_USDC_ADDRESS }],
        OWNER,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  test("rejects an implicit public-default recovery URL", () => {
    expect(() =>
      createConfiguredErc20BalanceReader({ rpcUrl: "" }),
    ).toThrow("requires BASE_RPC_URL");
  });

  test("empty 0x result stays null and does not invent 0", async () => {
    const reader = createConfiguredErc20BalanceReader({
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
