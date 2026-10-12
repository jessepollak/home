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
    diagnosticKey: "activity-test-diagnostic-key",
  });
  return () => handler(new Request("https://home.test/api/activity?to=2026-10-01T12%3A00%3A00.000Z"));
}

const branches: Branch[] = ["source", "read"];

describe("activity handler configuration failures", () => {
  test.each(branches)("does not disclose configuration names after a %s failure", async (branch) => {
    const response = await configurationFailure(branch)();
    const body = await readJson(response);

    expect(JSON.stringify(body)).not.toMatch(/ACTIVITY_HISTORY_SOURCE|CDP_API_KEY_ID/);
  });
});
