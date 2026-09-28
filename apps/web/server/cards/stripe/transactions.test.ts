import { describe, expect, test } from "bun:test";
import { createStripeTransactionClient } from "./transactions";

const config = { stripeSecretKey: "sk_test_synthetic", stripeApiVersion: "2026-08-26.dahlia" };
const authorization = { object: "issuing.authorization", id: "iauth_synthetic", card: "ic_synthetic", amount: 1234,
  currency: "usd", merchant_data: { name: "Synthetic Market", category: "5411" }, created: 1_780_000_000,
  approved: false, status: "closed", request_history: [{ reason: "insufficient_funds" }] };
const transaction = { object: "issuing.transaction", id: "ipi_synthetic", card: "ic_synthetic", amount: 1234,
  currency: "usd", merchant_data: { name: "Synthetic Market", category: "5411" }, created: 1_780_000_001,
  status: "posted", type: "capture", authorization: "iauth_synthetic" };
const clientFor = (fetcher: typeof fetch) => createStripeTransactionClient(config, fetcher);

describe("Stripe Issuing purchase reads", () => {
  test("reads authorization and transaction from fresh GETs without persisting unrelated fields", async () => {
    const paths: string[] = [];
    const client = clientFor((async (url: string, init: RequestInit) => {
      paths.push(new URL(url).pathname);
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeDefined();
      return Response.json(url.includes("authorizations") ? { ...authorization, number: "synthetic-unexpected" } : transaction);
    }) as typeof fetch);
    expect(await client.read("authorization", authorization.id)).toMatchObject({ id: authorization.id, status: "declined", declineReasonCode: "insufficient_funds", amountMinor: "1234" });
    expect(await client.read("transaction", transaction.id)).toMatchObject({ id: transaction.id, status: "completed", authorizationId: authorization.id });
    expect(paths).toEqual([`/v1/issuing/authorizations/${authorization.id}`, `/v1/issuing/transactions/${transaction.id}`]);
    expect(JSON.stringify(await client.read("transaction", transaction.id))).not.toContain("synthetic-unexpected");
  });
  test("lists card purchases inside the Activity window across bounded pages", async () => {
    const urls: URL[] = [];
    const client = clientFor((async (url: string) => {
      urls.push(new URL(url));
      return Response.json({ object: "list", data: urls.length === 1 ? [authorization] : [{ ...authorization, id: "iauth_next" }], has_more: urls.length === 1 });
    }) as typeof fetch);
    expect(await client.list("authorization", "ic_synthetic", 1_779_000_000)).toMatchObject({ rows: [{ id: authorization.id }, { id: "iauth_next" }], partial: false });
    expect(urls.map((url) => url.searchParams.get("created[gte]"))).toEqual(["1779000000", "1779000000"]);
    expect(urls.map((url) => url.searchParams.get("card"))).toEqual(["ic_synthetic", "ic_synthetic"]);
    expect(urls[1]?.searchParams.get("starting_after")).toBe(authorization.id);
  });
  test("pagination bound retains validated rows but reports partial; mismatched cards reject", async () => {
    let calls = 0;
    const client = clientFor((async () => Response.json({ object: "list", data: [{ ...authorization, id: `iauth_page${++calls}` }], has_more: true })) as unknown as typeof fetch);
    expect(await client.list("authorization", "ic_synthetic", 1_779_000_000)).toMatchObject({ rows: [{ id: "iauth_page1" }, { id: "iauth_page2" }, { id: "iauth_page3" }], partial: true });
    expect(calls).toBe(3);
    await expect(clientFor((async () => Response.json({ object: "list", data: [{ ...authorization, card: "ic_other" }], has_more: false })) as unknown as typeof fetch)
      .list("authorization", "ic_synthetic", 1_779_000_000)).rejects.toThrow("Partial");
  });
  test("each bounded list reports upstream rejection and timeout", async () => {
    for (const kind of ["authorization", "transaction"] as const) {
      await expect(clientFor((async () => { throw new Error("rejected"); }) as unknown as typeof fetch)
        .list(kind, "ic_synthetic", 1_779_000_000)).rejects.toThrow("rejected");
      await expect(clientFor((async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch)
        .list(kind, "ic_synthetic", 1_779_000_000)).rejects.toThrow("timed out");
    }
  });
  test("each GET rejects rejection, timeout, malformed body, oversized body and mismatched identity", async () => {
    for (const kind of ["authorization", "transaction"] as const) {
      const id = kind === "authorization" ? authorization.id : transaction.id;
      await expect(clientFor((async () => { throw new Error("rejected"); }) as unknown as typeof fetch).read(kind, id)).rejects.toThrow("rejected");
      await expect(clientFor((async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch).read(kind, id)).rejects.toThrow("timed out");
      await expect(clientFor((async () => new Response(null, { status: 503 })) as unknown as typeof fetch).read(kind, id)).rejects.toThrow("503");
      await expect(clientFor((async () => Response.json({ ...authorization, ...transaction, id: "ipi_other" })) as unknown as typeof fetch).read(kind, id)).rejects.toThrow();
      await expect(clientFor((async () => Response.json({ ...authorization, ...transaction, padding: "x".repeat(65_536) })) as unknown as typeof fetch).read(kind, id)).rejects.toThrow("response too large");
    }
  });
  test("maps approved pending, reversed, posted refund, and voided transaction states", async () => {
    const read = async (row: object, kind: "authorization" | "transaction", id: string) =>
      clientFor((async () => Response.json(row)) as unknown as typeof fetch).read(kind, id);
    expect((await read({ ...authorization, approved: true, status: "pending" }, "authorization", authorization.id)).status).toBe("pending");
    expect((await read({ ...authorization, approved: true, status: "reversed" }, "authorization", authorization.id)).status).toBe("reversed");
    expect((await read({ ...authorization, approved: true, status: "closed" }, "authorization", authorization.id)).status).toBe("pending");
    expect((await read({ ...transaction, type: "refund" }, "transaction", transaction.id)).status).toBe("refunded");
    expect((await read({ ...transaction, status: "void" }, "transaction", transaction.id)).status).toBe("reversed");
  });
});

const live = process.env.CARDS_STRIPE_LIVE_TEST === "1" && !process.env.CI;
(live ? test : test.skip)("reads existing Stripe test-card authorizations, opt-in only", async () => {
  const key = process.env.BRIDGE_STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("Live test requires a Stripe test-mode key");
  const client = createStripeTransactionClient({ ...config, stripeSecretKey: key });
  const rows = await client.list("authorization", "ic_1UKVXy1g1mZDnyPFpUOboOCx", Math.floor((Date.now() - 31 * 86_400_000) / 1000));
  expect(rows.rows.every((row) => row.cardId === "ic_1UKVXy1g1mZDnyPFpUOboOCx")).toBe(true);
});
