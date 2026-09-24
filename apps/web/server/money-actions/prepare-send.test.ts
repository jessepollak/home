import { afterEach, describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { recentSendRecipientAddresses } from "@/shared/transfers/recent-recipients";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import { setActionsStoreForTests, type ActionsStore } from "@/server/actions/store";
import {
  buildSendMoneyActionDraft,
  createPrepareSendMoneyActionHandler,
  issueSendMoneyAction,
} from "./prepare-send";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NOW = new Date("2026-09-13T12:00:00.000Z");

type InsertInput = Parameters<ActionsStore["insert"]>[0];

afterEach(() => setActionsStoreForTests(null));

function session(): VerifiedAccountSession {
  return {
    user: { subject: "prepare-send-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function authorized() {
  return Response.json({
    user: { subject: "prepare-send-test-user" },
    smartAccount: { address: OWNER, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

function request(assetId: string, amountBaseUnits: string, extra: Record<string, unknown> = {}): Request {
  return new Request("https://home.test/api/money-actions/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
    },
    body: JSON.stringify({ assetId, recipient: OTHER, amountBaseUnits, ...extra }),
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
        recipient: OTHER,
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
          to: OTHER,
          data: "0x",
          value: entry.amountBaseUnits,
        });
      } else {
        expect(draft.calls[0]).toEqual({
          to: asset.contractAddress!.toLowerCase() as `0x${string}`,
          data: `0xa9059cbb${OTHER.slice(2).padStart(64, "0")}${BigInt(entry.amountBaseUnits).toString(16).padStart(64, "0")}`,
          value: "0",
        });
      }
    });
  }

  test("authors a recipient warning the recent-recipient list can derive", () => {
    const draft = buildSendMoneyActionDraft({
      assetId: "usdc",
      recipient: RECIPIENT,
      amountBaseUnits: "1000000",
    }, NOW);

    expect(recentSendRecipientAddresses([{ kind: draft.kind, summary: { warnings: draft.warnings } }]))
      .toEqual([RECIPIENT]);
  });

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

  test("re-resolves a named recipient and stores the resolved checksummed address", async () => {
    const stored: InsertInput[] = [];
    setActionsStoreForTests({
      insert: async (input: InsertInput) => { stored.push(input); },
    } as unknown as ActionsStore);
    const resolved: Array<{ name: string; signal: AbortSignal | undefined }> = [];

    const action = await issueSendMoneyAction(session(), {
      assetId: "usdc",
      recipient: RECIPIENT,
      amountBaseUnits: "1000000",
      recipientName: "EXAMPLE.BASE.ETH",
    }, new Date(), {
      signal: AbortSignal.timeout(1_000),
      resolveName: async (name, options) => {
        resolved.push({ name, signal: options?.signal });
        return name === "example.base.eth" ? RECIPIENT : null;
      },
    });

    expect(resolved.map((entry) => entry.name)).toEqual(["example.base.eth"]);
    expect(resolved[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(action.calls[0]?.to).toBe(USDC);
    expect(action.calls[0]?.data).toContain(RECIPIENT.slice(2).toLowerCase());
    expect(stored[0]?.summary.warnings[0]).toBe(`Recipient: ${RECIPIENT}`);
  });

  test("refuses a named send whose resolution does not match the submitted address", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);

    await expect(issueSendMoneyAction(session(), {
      assetId: "usdc",
      recipient: OTHER,
      amountBaseUnits: "1000000",
      recipientName: "example.base.eth",
    }, new Date(), { resolveName: async () => RECIPIENT })).rejects.toMatchObject({
      reason: "invalid-request",
    } satisfies Partial<TransferExecutionError>);
  });

  test("refuses a named send the server resolver cannot confirm", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);

    await expect(issueSendMoneyAction(session(), {
      assetId: "usdc",
      recipient: RECIPIENT,
      amountBaseUnits: "1000000",
      recipientName: "example.base.eth",
    }, new Date(), { resolveName: async () => null })).rejects.toMatchObject({
      reason: "invalid-request",
    } satisfies Partial<TransferExecutionError>);
  });

  test("refuses a malformed recipient name before issuing anything", async () => {
    let inserts = 0;
    setActionsStoreForTests({
      insert: async () => { inserts += 1; },
    } as unknown as ActionsStore);

    await expect(issueSendMoneyAction(session(), {
      assetId: "usdc",
      recipient: RECIPIENT,
      amountBaseUnits: "1000000",
      recipientName: "example",
    }, new Date(), { resolveName: async () => RECIPIENT })).rejects.toMatchObject({
      reason: "invalid-request",
    } satisfies Partial<TransferExecutionError>);
    expect(inserts).toBe(0);
  });

  test("does not consult the resolver for a plain address send", async () => {
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    let calls = 0;

    const action = await issueSendMoneyAction(session(), {
      assetId: "usdc",
      recipient: OTHER,
      amountBaseUnits: "1000000",
    }, new Date(), {
      resolveName: async () => {
        calls += 1;
        return OTHER;
      },
    });

    expect(calls).toBe(0);
    expect(action.kind).toBe("send");
  });

  test("returns 400 for a malformed name or an unsupported request key", async () => {
    const handler = createPrepareSendMoneyActionHandler({
      authorize: async () => authorized(),
      issue: async () => { throw new Error("malformed request reached issuance"); },
    });

    const malformedName = await handler(request("usdc", "1", { recipientName: "example" }));
    const extraKey = await handler(request("usdc", "1", { recipientName: "example.base.eth", memo: "hi" }));

    expect(malformedName.status).toBe(400);
    expect(extraKey.status).toBe(400);
  });
});
