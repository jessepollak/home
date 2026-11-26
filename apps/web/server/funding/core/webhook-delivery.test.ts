import { expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { respondToFundingWebhook } from "./webhook-delivery";

const delivery = () => new Request("https://home.test/api/funding/webhooks/ripio", { method: "POST", body: "{\"id\":\"synthetic\"}" });

test("a failing matched delivery is retryable while an unmatched delivery stays acknowledged", async () => {
  let outcome: "throw" | "unmatched" = "throw";
  const core = {
    handleWebhook: async () => {
      if (outcome === "throw") throw new Error("database unavailable");
      return { accepted: true, matched: false };
    },
  };
  const logs: unknown[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(JSON.parse(line)); });
  try {
    const failed = await respondToFundingWebhook(delivery(), "ripio", () => core);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ accepted: false });
    expect(logs).toContainEqual(expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE", outcome: "unavailable", provider: "ripio" }));

    outcome = "unmatched";
    logs.length = 0;
    const unmatched = await respondToFundingWebhook(delivery(), "ripio", () => core);
    expect(unmatched.status).toBe(202);
    expect(await unmatched.json()).toEqual({ accepted: true, matched: false });
    expect(logs).not.toContainEqual(expect.objectContaining({ code: "WEBHOOK_UNAVAILABLE" }));
  } finally {
    setObservabilityLogWriterForTests();
  }
});
