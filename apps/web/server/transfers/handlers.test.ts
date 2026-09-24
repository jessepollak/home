import { describe, expect, test } from "bun:test";
import type { ActionRow, ActionsStore } from "@/server/actions/store";
import { createRecentTransferRecipientsHandler, createTransferRecipientNameHandler } from "./handlers";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

function authorize(subject = "owner-a") {
  return async () => Response.json({
    user: { subject },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "cdp-embedded",
  });
}

function request(path: string) {
  return new Request(`https://home.test${path}`, {
    headers: { "X-Home-Account-Provider": "cdp-embedded" },
  });
}

function sendRow(id: string, recipient: string, confirmedAt: string): ActionRow {
  return {
    id,
    owner_key: "owner-a",
    provider: "cdp-embedded",
    kind: "send",
    summary: {
      title: "Send USDC",
      amounts: [],
      warnings: [`Recipient: ${recipient}`],
      expiresAt: "2026-09-12T12:30:00.000Z",
    },
    pending: null,
    created_at: confirmedAt,
    confirmed_at: confirmedAt,
    provider_handle: `0x${"ab".repeat(32)}`,
    transaction_hash: null,
    handle_recorded_at: confirmedAt,
  };
}

function store(rows: ActionRow[]): Pick<ActionsStore, "listDispatchedSends"> {
  return { listDispatchedSends: async () => rows };
}

describe("recipient name handler", () => {
  test("resolves a supported name for the verified session", async () => {
    const handler = createTransferRecipientNameHandler({
      authorize: authorize(),
      resolve: async (name) => (name === "example.base.eth" ? RECIPIENT : null),
    });

    const response = await handler(request("/api/transfers/recipient-name?name=EXAMPLE.BASE.ETH"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      name: "example.base.eth",
      address: RECIPIENT,
    });
  });

  test.each([
    ["/api/transfers/recipient-name", "missing name"],
    ["/api/transfers/recipient-name?name=example", "unsupported name"],
    ["/api/transfers/recipient-name?name=0x0000000000000000000000000000000000000000", "address"],
  ])("refuses %s (%s) without calling the resolver", async (path) => {
    let calls = 0;
    const handler = createTransferRecipientNameHandler({
      authorize: authorize(),
      resolve: async () => {
        calls += 1;
        return RECIPIENT;
      },
    });

    const response = await handler(request(path));

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("reports an unresolved name as not found", async () => {
    const handler = createTransferRecipientNameHandler({
      authorize: authorize(),
      resolve: async () => null,
    });

    const response = await handler(request("/api/transfers/recipient-name?name=missing.base.eth"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "RECIPIENT_NAME_UNRESOLVED", message: "That name does not resolve to an address." },
    });
  });

  test("keeps the session boundary in front of resolution", async () => {
    let calls = 0;
    const handler = createTransferRecipientNameHandler({
      authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }),
      resolve: async () => {
        calls += 1;
        return RECIPIENT;
      },
    });

    const response = await handler(request("/api/transfers/recipient-name?name=example.base.eth"));

    expect(response.status).toBe(401);
    expect(calls).toBe(0);
  });
});

describe("recent recipients handler", () => {
  test("derives distinct send recipients in confirmed order with resolved labels", async () => {
    const handler = createRecentTransferRecipientsHandler({
      authorize: authorize(),
      store: store([
        sendRow("11111111-1111-4111-8111-111111111101", RECIPIENT, "2026-09-12T12:03:00.000Z"),
        { ...sendRow("11111111-1111-4111-8111-111111111102", OTHER, "2026-09-12T12:02:00.000Z"), kind: "savings-deposit" },
        sendRow("11111111-1111-4111-8111-111111111103", RECIPIENT, "2026-09-12T12:01:00.000Z"),
        sendRow("11111111-1111-4111-8111-111111111104", OTHER, "2026-09-12T12:00:00.000Z"),
      ]),
      resolveLabels: async (addresses) => new Map(addresses.flatMap((address) =>
        address === RECIPIENT ? [[address, "example.base.eth"] as const] : [])),
    });

    const response = await handler(request("/api/transfers/recent-recipients"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      recipients: [
        { address: RECIPIENT, name: "example.base.eth" },
        { address: OTHER, name: null },
      ],
    });
  });

  test("answers with an empty list when the durable read fails", async () => {
    const failed: Pick<ActionsStore, "listDispatchedSends"> = {
      listDispatchedSends: async () => { throw new Error("database unavailable"); },
    };
    let labels = 0;
    const handler = createRecentTransferRecipientsHandler({
      authorize: authorize(),
      store: failed,
      resolveLabels: async () => {
        labels += 1;
        return new Map();
      },
    });

    const response = await handler(request("/api/transfers/recent-recipients"));

    expect(await response.json()).toEqual({ version: 1, recipients: [] });
    expect(labels).toBe(0);
  });

  test("keeps recipients owner-scoped to the verified session", async () => {
    const owners: string[] = [];
    const handler = createRecentTransferRecipientsHandler({
      authorize: authorize("owner-b"),
      store: {
        listDispatchedSends: async (owner, limit) => {
          owners.push(`${owner.subject}:${limit}`);
          return [];
        },
      },
    });

    await handler(request("/api/transfers/recent-recipients"));

    expect(owners).toEqual(["owner-b:100"]);
  });
});
