import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import type { TransferRequest } from "@/shared/transfers/types";
import {
  buildSendMoneyActionDraft,
  createPrepareSendMoneyActionHandler,
} from "./prepare-send";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const NOW = new Date("2026-09-13T12:00:00.000Z");

function authorized() {
  return Response.json({
    user: { subject: "prepare-send-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

function request(assetId: string, amountBaseUnits: string): Request {
  return new Request("https://home.test/api/money-actions/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
    },
    body: JSON.stringify({ assetId, recipient: RECIPIENT, amountBaseUnits }),
  });
}

describe("prepare send", () => {
  const cases = [
    { assetId: "usdc", amountBaseUnits: "1000001", decimals: 6, native: false },
    { assetId: "cbbtc", amountBaseUnits: "100000", decimals: 8, native: false },
    { assetId: "eth", amountBaseUnits: "1000000000000000", decimals: 18, native: true },
  ] as const;

  for (const entry of cases) {
    test(`authors exact ${entry.assetId} calldata from catalog metadata`, () => {
      const transfer = {
        assetId: entry.assetId,
        recipient: RECIPIENT,
        amountBaseUnits: entry.amountBaseUnits,
      } satisfies TransferRequest;
      const asset = getTransferAsset(entry.assetId)!;
      const draft = buildSendMoneyActionDraft(transfer, NOW);

      expect(draft.amounts).toEqual([{
        assetId: entry.assetId,
        symbol: asset.symbol,
        decimals: entry.decimals,
        amountBaseUnits: entry.amountBaseUnits,
        direction: "spend",
      }]);
      expect(draft.calls).toHaveLength(1);
      if (entry.native) {
        expect(draft.calls[0]).toEqual({
          to: RECIPIENT,
          data: "0x",
          value: entry.amountBaseUnits,
        });
      } else {
        expect(draft.calls[0]).toEqual({
          to: asset.contractAddress!.toLowerCase() as `0x${string}`,
          data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(entry.amountBaseUnits).toString(16).padStart(64, "0")}`,
          value: "0",
        });
      }
    });
  }

  test.each([
    ["unknown", "unregistered asset"],
    ["recognized:0x9999999999999999999999999999999999999999", "recognized-only asset"],
  ])("returns 400 for %s (%s)", async (assetId) => {
    const handler = createPrepareSendMoneyActionHandler({
      authorize: async () => authorized(),
      issue: async () => { throw new Error("invalid asset reached issuance"); },
    });

    const response = await handler(request(assetId, "1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_SEND_REQUEST",
        message: "Use a valid Base recipient, asset, and integer amount.",
      },
    });
  });
});
