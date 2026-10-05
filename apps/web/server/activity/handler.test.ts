import { describe, expect, test } from "bun:test";
import { ChainDataError } from "@/server/chain-data/errors";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readJson } from "@/tests/helpers/read-json";
import { createActivityHandler } from "./handler";

const session: VerifiedAccountSession = {
  user: { subject: "activity-test-user" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

type Branch = "source" | "read";

function configurationFailure(branch: Branch) {
  const observed: { sourceError?: string }[] = [];
  const handler = createActivityHandler({
    authorize: async () => session,
    source: () => {
      if (branch === "source") throw new ChainDataError("not-configured", "ACTIVITY_HISTORY_SOURCE must be configured.");
      return "cdp-sql";
    },
    readActivity: async () => {
      throw new ChainDataError("not-configured", "CDP_API_KEY_ID must be configured.");
    },
    now: () => new Date("2026-10-01T12:00:00.000Z"),
    clock: () => 0,
    observe: (event) => { observed.push(event); },
    diagnosticKey: "activity-test-diagnostic-key",
  });
  return {
    observed,
    read: () => handler(new Request("https://home.test/api/activity?to=2026-10-01T12%3A00%3A00.000Z")),
  };
}

const branches: Branch[] = ["source", "read"];

describe("activity handler configuration failures", () => {
  test.each(branches)("keeps a %s not-configured failure user-safe", async (branch) => {
    const response = await configurationFailure(branch).read();
    const body = await readJson(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: { code: "ACTIVITY_NOT_CONFIGURED", message: "Try again later." } });
    expect(JSON.stringify(body)).not.toContain("ACTIVITY_HISTORY_SOURCE");
    expect(JSON.stringify(body)).not.toContain("CDP_API_KEY_ID");
  });

  test.each(branches)("keeps a %s not-configured failure observable for operators", async (branch) => {
    const failure = configurationFailure(branch);
    await failure.read();

    expect(failure.observed.some((event) => event.sourceError === "not-configured")).toBe(true);
  });
});
