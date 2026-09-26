import { describe, expect, test } from "bun:test";
import type { FundingOrder } from "@/server/funding/core/store";
import type { FundingProviderCustomer } from "@/server/funding/core/customer-store";
import type { ActionRow } from "@/server/actions/store";
import { actionConfirmedEvent, fundingOrderEvents, verificationChangedEvent } from "./events";

const owner = { subject: "unit-owner", accountProvider: "cdp-embedded" as const };
const order = {
  id: "order-id", owner, destination: "0x1111111111111111111111111111111111111111",
  providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "qris",
  fiatAmount: "20000", sandbox: true, state: "received",
  createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z",
  providerTransactionHash: "private-hash", providerStatus: "private-status",
} as unknown as FundingOrder;

describe("operator event builders", () => {
  test("funding emits created and finalized with allowlisted props and stable keys", () => {
    const events = fundingOrderEvents(order);
    expect(events.map(({ name, idempotencyKey, sandbox }) => [name, idempotencyKey, sandbox])).toEqual([
      ["funding.order_created", "funding:order-id:created", true],
      ["funding.order_finalized", "funding:order-id:received", true],
    ]);
    expect(events.map(({ props }) => props)).toEqual([
      { provider: "idrx", region: "ID", asset: "base:idrx", method: "qris", fiatAmount: "20000" },
      { provider: "idrx", region: "ID", asset: "base:idrx", method: "qris", fiatAmount: "20000", state: "received" },
    ]);
    expect(events[1].occurredAt.toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });

  test("dispatch-ambiguous funding is not finalized", () => {
    expect(fundingOrderEvents({ ...order, state: "dispatch-ambiguous" })).toHaveLength(1);
  });

  test("confirmed actions contain kind and provider but not free-text summary or hashes", () => {
    const row = {
      id: "action-id", owner_key: JSON.stringify([owner.subject, order.destination, 8453, owner.accountProvider]),
      kind: "send", confirmed_at: "2026-09-14T00:00:00Z", summary: { title: "private-title" },
      transaction_hash: "private-hash",
    } as ActionRow;
    expect(actionConfirmedEvent(row)).toMatchObject({
      name: "action.confirmed", idempotencyKey: "action:action-id:confirmed",
      owner: { ...owner, address: order.destination }, props: { kind: "send", accountProvider: "cdp-embedded" },
    });
    expect(actionConfirmedEvent({ ...row, confirmed_at: null })).toBeNull();
  });

  test("verification filters unresolved states and emits only state metadata", () => {
    const customer = {
      id: "provider-id", owner, providerId: "idrx", region: "ID", state: "verified",
      updatedAt: "2026-09-14T00:00:00Z", customerRef: "private-ref",
    } as FundingProviderCustomer;
    expect(verificationChangedEvent(customer)).toMatchObject({
      name: "verification.changed", idempotencyKey: "kyc:provider-id:verified",
      props: { provider: "idrx", region: "ID", state: "verified" },
    });
    expect(verificationChangedEvent({ ...customer, state: "reserving" })).toBeNull();
    expect(verificationChangedEvent({ ...customer, state: "dispatch-ambiguous" })).toBeNull();
  });
});
