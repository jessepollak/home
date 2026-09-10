import { expect, test } from "bun:test";
import { BASE_CHAIN_ID, type VerifiedPortfolioAccount } from "./types";
import {
  createBasePortfolioReader,
  inspectBaseRpcUrl,
} from "./rpc";

const liveTest = process.env.BASE_RPC_LIVE_SMOKE === "1" ? test : test.skip;

const SMOKE_ACCOUNT: VerifiedPortfolioAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: BASE_CHAIN_ID,
  verification: "session-smart-account",
};

function redactSecretText(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

liveTest(
  "configured money RPC is Base mainnet and not the public default",
  async () => {
    const inspection = inspectBaseRpcUrl();
    expect(inspection.source).toBe("configured");
    expect(inspection.protocol).toBe("https");
    expect(inspection.hostClass).not.toBe("public-base");

    try {
      const snapshot = await createBasePortfolioReader()(SMOKE_ACCOUNT);
      expect(snapshot.chainId).toBe(BASE_CHAIN_ID);
      expect(snapshot.assets).toHaveLength(2);
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message =
        error instanceof Error ? redactSecretText(error.message) : "unknown";
      throw new Error(
        `Live Base RPC smoke failed (${name}): ${message} [source=${inspection.source} host=${inspection.hostClass} protocol=${inspection.protocol}]`,
      );
    }
  },
  15_000,
);
