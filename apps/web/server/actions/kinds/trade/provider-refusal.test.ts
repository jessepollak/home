import { describe, expect, spyOn, test } from "bun:test";
import { CdpSwapsRefusalError, CdpSwapsUnavailableError, createCdpSwapsClient, type SwapsRequest } from "./cdp-swaps";
import { classifyProviderRefusal } from "./provider-refusal";
import { tradePreparationResponse } from "./prepare";
import { TradePreparationError } from "./permit2";

const buy = "The token you're trying to buy isn't authorized for this swap.";
const sell = "The token you're trying to sell isn't authorized for this swap.";
const body = (errorMessage: string) => ({ errorType: "invalid_request", errorMessage });
const env = { CDP_API_KEY_ID: "fixture-key-id", ["CDP_API_KEY_" + "SECRET"]: "fixture-private-part" };
const request: SwapsRequest = {
  fromToken: "0x1111111111111111111111111111111111111111",
  toToken: "0x2222222222222222222222222222222222222222",
  fromAmount: BigInt(1000),
  taker: "0x3333333333333333333333333333333333333333",
  slippageBps: 100,
  requestKey: "11111111-1111-4111-8111-111111111111",
};
type FetchLike = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
function injectedFetch(fetchImpl: FetchLike): typeof fetch {
  return Object.assign(fetchImpl, { preconnect: fetch.preconnect });
}
function client(fetchImpl: FetchLike) {
  return createCdpSwapsClient({ env, fetchImpl: injectedFetch(fetchImpl), generateJwtImpl: async () => "fixture.signed.token" });
}

describe("CDP swaps transport", () => {
  test.each(["getPrice", "createQuote"] as const)("%s retains refusal classification from non-ok bodies", async (method) => {
    for (const [status, response, reason] of [
      [400, body(buy), "token-not-routed"],
      [422, body("below threshold"), "below-minimum"],
      [404, { errorType: "not_found", errorMessage: "No route" }, "route-unavailable"],
    ] as const) {
      let caught: unknown;
      try {
        await client(async () => Response.json(response, { status }))[method](request);
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(reason === "token-not-routed" ? TradePreparationError : CdpSwapsRefusalError);
      expect(caught).toMatchObject({ reason });
    }
  });

  test.each(["malformed", "absent", "oversized", "unreadable"] as const)("%s refusal bodies are unavailable", async (kind) => {
    const response = kind === "unreadable"
      ? new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("read failed")); } })
      : kind === "malformed" ? "{" : kind === "absent" ? null : JSON.stringify({ ...body(buy), padding: "x".repeat(64 * 1024) });
    await expect(client(async () => new Response(response, { status: 400 })).getPrice(request))
      .rejects.toBeInstanceOf(CdpSwapsUnavailableError);
  });

  test("the deadline makes a fetch that never settles unavailable", async () => {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      await expect(client(() => {
        controller.abort();
        return new Promise<Response>(() => {});
      }).getPrice(request)).rejects.toBeInstanceOf(CdpSwapsUnavailableError);
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally { timeout.mockRestore(); }
  });

  test.each(["getPrice", "createQuote"] as const)("%s rejects malformed success bodies as unavailable", async (method) => {
    for (const value of ["{", JSON.stringify({ liquidityAvailable: true }), JSON.stringify({ liquidityAvailable: false, padding: "x".repeat(1024 * 1024) })]) {
      await expect(client(async () => new Response(value))[method](request))
        .rejects.toBeInstanceOf(CdpSwapsUnavailableError);
    }
  });

  test("retains GET encoding, signed headers and POST idempotency without redispatch", async () => {
    const signed: unknown[] = [];
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const swaps = createCdpSwapsClient({
      env,
      generateJwtImpl: async (options) => {
        signed.push([options.requestMethod, options.requestHost, options.requestPath]);
        return "fixture.signed.token";
      },
      fetchImpl: injectedFetch(async (input, init) => {
        calls.push({ input: String(input), init });
        return Response.json({ liquidityAvailable: false });
      }),
    });
    await expect(swaps.getPrice(request)).resolves.toEqual({ liquidityAvailable: false });
    await expect(swaps.createQuote(request)).resolves.toEqual({ liquidityAvailable: false });
    await expect(swaps.createQuote(request)).rejects.toBeInstanceOf(CdpSwapsUnavailableError);
    expect(signed).toEqual([
      ["GET", "api.cdp.coinbase.com", "/platform/v2/evm/swaps/quote"],
      ["POST", "api.cdp.coinbase.com", "/platform/v2/evm/swaps"],
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe("https://api.cdp.coinbase.com/platform/v2/evm/swaps/quote?network=base&fromToken=0x1111111111111111111111111111111111111111&toToken=0x2222222222222222222222222222222222222222&fromAmount=1000&taker=0x3333333333333333333333333333333333333333&slippageBps=100");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(calls[1]?.input).toBe("https://api.cdp.coinbase.com/platform/v2/evm/swaps");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({
      network: "base", fromToken: request.fromToken, toToken: request.toToken,
      fromAmount: "1000", taker: request.taker, slippageBps: 100,
    }));
    for (const [index, method] of ["GET", "POST"].entries()) {
      const init = calls[index]?.init;
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe(method);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.cache).toBe("no-store");
      expect(headers.get("authorization")).toBe("Bearer fixture.signed.token");
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe(method === "POST" ? "application/json" : null);
      expect(headers.get("x-idempotency-key")).toBe(method === "POST" ? "11111111-1111-4111-8111-111111111111" : null);
    }
  });
});

describe("provider refusal", () => {
  test("maps a not-routed failure to public-safe response data", () => {
    expect(tradePreparationResponse(new TradePreparationError("token-not-routed"))).toEqual({
      code: "TRADE_NOT_ROUTED", message: "This asset can't be traded in Home yet.", status: 422,
    });
  });
  test.each([buy, sell, buy.replaceAll("'", "’"), sell.replaceAll("'", "’")])("classifies only the token authorization refusal: %s", (message) => {
    expect(classifyProviderRefusal(400, body(message))).toBe("token-not-routed");
  });
  test.each([
    [400, body("Invalid amount"), "route-unavailable"],
    [404, { errorType: "not_found", errorMessage: buy }, "route-unavailable"],
    [400, body("The token you're trying to buy isn't authorized for this swap. Extra"), "route-unavailable"],
    [422, { errorType: "invalid_request", errorMessage: "below threshold" }, "below-minimum"],
  ] as const)("classifies a CDP refusal without leaking provider text", (status, response, reason) => {
    expect(classifyProviderRefusal(status, response)).toBe(reason);
  });
  test.each([
    [403, body(buy)], [500, body(sell)],
    [400, null], [400, "error"], [400, { errorType: "invalid_request" }],

  ])("does not classify non-CDP or outage errors: %s", (status, response) => {
    expect(classifyProviderRefusal(status as number, response)).toBeNull();
  });
});
