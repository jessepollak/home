import { describe, expect, test } from "bun:test";
import { RipioProviderError } from "./client";
import { classifyRipioFailure } from "./observability";

describe("Ripio failure classification", () => {
  test("distinguishes configuration, HTTP, transport, invalid response, binding, and ambiguous create", () => {
    const cases = [
      ["quote", new RipioProviderError("not-configured"), "FUNDING_PROVIDER_CONFIGURATION"],
      ["quote", new RipioProviderError("invalid-request", 400), "PROVIDER_HTTP_4XX"],
      ["status", new RipioProviderError("unavailable", 503), "PROVIDER_HTTP_5XX"],
      ["status", new RipioProviderError("unauthorized", 401), "FUNDING_PROVIDER_CONFIGURATION"],
      ["status", new RipioProviderError("unavailable"), "PROVIDER_TRANSPORT"],
      ["quote", new RipioProviderError("ambiguous-create", 302), "PROVIDER_TRANSPORT"],
      ["status", new RipioProviderError("invalid-response"), "PROVIDER_INVALID_RESPONSE"],
      ["status", new RipioProviderError("invalid-response", 200), "PROVIDER_INVALID_RESPONSE"],
      ["customer", new RipioProviderError("invalid-request"), null],
      ["quote", new RipioProviderError("binding-conflict"), "QUOTE_ECHO_MISMATCH"],
      ["order", new RipioProviderError("binding-conflict"), "ORDER_ECHO_MISMATCH"],
      ["status", new RipioProviderError("binding-conflict"), "STATUS_ECHO_MISMATCH"],
      ["order", new RipioProviderError("ambiguous-create"), "ORDER_AMBIGUOUS"],
      ["order", new RipioProviderError("ambiguous-create", null, new RipioProviderError("binding-conflict")), "ORDER_ECHO_MISMATCH"],
      ["order", new RipioProviderError("ambiguous-create", 201, new RipioProviderError("invalid-response", 201)), "ORDER_AMBIGUOUS"],
      ["order", new RipioProviderError("ambiguous-create", 503), "ORDER_AMBIGUOUS"],
      ["quote", new RipioProviderError("ambiguous-create", 200, new RipioProviderError("invalid-response", 200)), "PROVIDER_INVALID_RESPONSE"],
    ] as const;

    for (const [stage, error, expected] of cases) {
      expect(classifyRipioFailure(stage, error), `${stage}:${error.code}`).toBe(expected);
    }
  });
});
