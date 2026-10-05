import { expect, test } from "bun:test";
import { createCodexMarketHistoryReader } from "./history";
import { parseHistoryResponse } from "@/shared/invest/contracts/market-price-history";

test("non-stock Codex history preserves exact-contract identity and decimal lexemes in v2", async () => {
  let variables: unknown;
  const read = createCodexMarketHistoryReader({ apiKey: "test-key", now: () => new Date("2026-10-05T16:00:00.000Z"), fetchImpl: async (_url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    if (!body || typeof body !== "object" || !("variables" in body)) throw new Error("Missing Codex request variables");
    variables = body.variables;
    return new Response('{"data":{"getBars":{"t":[1791216000,1791302400],"c":[0.000000001234567890123456789,64210.50],"s":"ok"}}}', { headers: { "content-type": "application/json" } });
  } });
  const response = await read("cbbtc", "1W");
  expect(parseHistoryResponse(response)).toEqual(response);
  expect(response.source).toEqual({ kind: "codex", chainId: 8453, contractAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" });
  expect(response.points.map((point) => point.value)).toEqual(["0.000000001234567890123456789", "64210.50"]);
  expect(variables).toMatchObject({ symbol: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf:8453" });
});

test("the Codex reader refuses stock identities without making upstream requests", async () => {
  let calls = 0;
  const read = createCodexMarketHistoryReader({ apiKey: "test-key", fetchImpl: async () => { calls += 1; throw new Error("Forbidden"); } });
  expect((await read("nvdac", "1W")).status).toBe("unavailable"); expect(calls).toBe(0);
});

test("malformed Codex bars fail closed instead of exposing partial prices", async () => {
  const read = createCodexMarketHistoryReader({ apiKey: "test-key", fetchImpl: async () => new Response('{"data":{"getBars":{"t":[1791216000],"c":[],"s":"ok"}}}') });
  await expect(read("cbbtc", "1W")).rejects.toThrow("malformed bars");
});
