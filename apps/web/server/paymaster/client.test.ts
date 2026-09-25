import { describe, expect, test } from "bun:test";
import { createPaymasterClient } from "./client";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("USDC paymaster transport", () => {
  test("forces the USDC payment context on quote, proxy, and accepted-token methods", async () => {
    const sent: Array<{ method: string; params: unknown[] }> = [];
    const client = createPaymasterClient({ url: "https://fee.example/secret", fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      sent.push(body);
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    } });
    for (const method of ["pm_getPaymasterStubData", "pm_getPaymasterData", "pm_getAcceptedPaymentTokens"] as const) {
      await client.request(method, [{ sender: "0x11" }, "entrypoint", "0x2105", { erc20: "0xwrong", sponsor: true }]);
      await client.request(method, [{ sender: "0x11" }, "entrypoint", "0x2105"]);
    }
    expect(sent).toHaveLength(6);
    for (const body of sent) expect(body.params[body.method === "pm_getAcceptedPaymentTokens" ? 2 : 3]).toEqual({ erc20: USDC });
  });

  test("does not expose the credential on transport errors", async () => {
    const client = createPaymasterClient({ url: "https://fee.example/private-credential", fetchImpl: async () => { throw new Error("https://fee.example/private-credential"); } });
    await expect(client.request("pm_getPaymasterData", [{}, "entry", "0x2105"])).rejects.toThrow("The USDC network fee quote is unavailable.");
  });
});
