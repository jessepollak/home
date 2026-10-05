import { expect, test } from "bun:test";
import type { ActionRow } from "@/server/actions/store";
import { createRecentTransferRecipientsHandler } from "@/server/transfers/handlers";
import { readRecentTransferRecipientsResponse } from "@/shared/transfers/contracts/recipients";

const account = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const otherRecipient = "0x2222222222222222222222222222222222222222" as const;
const request = () => new Request("https://home.test/api/transfers/recent-recipients");
const authorize = async () => Response.json({
  user: { subject: "owner-a" }, smartAccount: { address: account, chainId: 8453 }, accountProvider: "cdp-embedded",
});
function send(owner: string, address: string): ActionRow {
  return {
    id: "11111111-1111-4111-8111-111111111101", owner_key: owner, account_address: account,
    provider: "cdp-embedded", kind: "send",
    summary: { title: "Send USDC", amounts: [], warnings: [`Recipient: ${address}`], expiresAt: "2026-10-03T00:00:00.000Z" },
    pending: null, created_at: "2026-10-03T00:00:00.000Z", confirmed_at: "2026-10-03T00:00:00.000Z",
    provider_handle: `0x${"ab".repeat(32)}`, transaction_hash: null, handle_recorded_at: "2026-10-03T00:00:00.000Z",
    declined_reported_at: null, dispatch_attempt: 0, outcome: null, outcome_source: null,
    settled_at: null, outcome_recorded_at: null,
  };
}

test("recent-recipients GET handler round-trips actual owner-scoped output and excludes malformed recipients", async () => {
  const rows = [send("owner-a", recipient), send("owner-b", otherRecipient), send("owner-a", "0x0000000000000000000000000000000000000000"), send("owner-a", "malformed")];
  const owners: string[] = [];
  const GET = createRecentTransferRecipientsHandler({
    authorize,
    store: { listDispatchedSends: async (owner) => {
      owners.push(owner.subject);
      return rows.filter((row) => row.owner_key === owner.subject);
    } },
    resolveLabels: async (addresses) => new Map(addresses.map((address) => [address, "example.base.eth"])),
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ version: 1, recipients: [{ address: recipient, name: "example.base.eth" }] });
  expect(readRecentTransferRecipientsResponse(body)).toEqual([{ address: recipient, name: "example.base.eth" }]);
  expect(readRecentTransferRecipientsResponse(body).some((entry) => entry.address === otherRecipient)).toBeFalse();
  expect(owners).toEqual(["owner-a"]);
});

test("a malformed session cannot read another owner's recent recipients", async () => {
  let reads = 0;
  const GET = createRecentTransferRecipientsHandler({
    authorize: async () => Response.json({ user: { subject: "owner-b" } }),
    store: { listDispatchedSends: async () => { reads++; return [send("owner-b", otherRecipient)]; } },
  });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(readRecentTransferRecipientsResponse(await response.json())).toEqual([]);
  expect(reads).toBe(0);
});
