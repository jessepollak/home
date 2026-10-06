import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { fakeProgram } from "@/tests/cards/fake-program";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseCardEnrollmentResponse, parseCardRevealResponse, parseCardsResponse, parseCardWriteResponse } from "@/shared/cards/contract";
import { createCardPrograms } from "./programs";
import { createCardWriteService } from "./write-service";
import { createCardWriteHandlers } from "./write-handler";
import { createCardRevealHandler } from "./reveal-handler";
import { createCardsHandler } from "./handler";
import { createCardAccountStore } from "./account-store";
import { readCardState } from "./journey";

const url = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `cards_write_${randomBytes(4).toString("hex")}`;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const wallet = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" }, smartAccount: { chainId: 8453, address: wallet } };
const request = (body: object = {}) => new Request("http://localhost/api/cards", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "X-Home-Account-Provider": "base-account" }, body: JSON.stringify(body) });
let admin: Bun.SQL, sql: SqlExecutor;
const fake = fakeProgram();
let service: ReturnType<typeof createCardWriteService>;
let programs: ReturnType<typeof createCardPrograms>;
let cardId: string;
(url ? describe : describe.skip)("fake program card writes and handlers", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(url!); await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const name of ["011_operator_registry.sql", "018_cards.sql", "019_card_events_provider.sql", "020_card_accounts.sql", "021_card_transactions.sql", "022_card_programs.sql"])
        await tx.unsafe(await readMigrationSql(name));
    });
    sql = createPostgresSqlExecutor(url!, { schema });
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [owner, other]);
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'base-account','owner',now(),now())", [owner]);
    await sql.query("INSERT INTO customer_wallets(id,customer_id,credential_id,chain_id,address) VALUES (gen_random_uuid(),$1,(SELECT id FROM customer_credentials WHERE customer_id=$1),8453,$2)", [owner, wallet]);
    programs = createCardPrograms([fake.program], "bridge", sql); service = createCardWriteService({ sql, programs });
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });
  test("enrollment is owner-scoped and deterministic across retries", async () => {
    const handlers = createCardWriteHandlers({ authorize: async () => session, customer: async () => ({ id: owner }), service: () => service });
    const response = await handlers.enrollment(request());
    expect(parseCardEnrollmentResponse(await response.json())?.next.kind).toBe("redirect");
    await service.enroll(owner, "https://home.example/card");
    expect(fake.calls[0]?.key).toBe(fake.calls[1]?.key);
    expect((await createCardAccountStore(sql).read(owner, "sandbox"))?.accountId).toBe("account-fixture");
  });
  test("enrollment failures and unallowlisted redirects do not overwrite the owner link", async () => {
    const before = await createCardAccountStore(sql).read(owner, "sandbox");
    for (const failure of ["rejected", "timeout", "redirect"] as const) {
      const program = { ...fake.program, enroll: async () => {
        if (failure === "rejected") throw new Error("provider failed");
        if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
        return { link: { accountId: "other-account" }, next: { kind: "redirect" as const, url: "https://untrusted.example/" } };
      } };
      const failed = createCardWriteService({ sql, programs: createCardPrograms([program], "bridge", sql) });
      await expect(failed.enroll(owner, "https://home.example/card")).rejects.toThrow();
      expect(await createCardAccountStore(sql).read(owner, "sandbox")).toEqual(before);
    }
  });
  test("failed issue calls and malformed cards never create a local success", async () => {
    for (const failure of ["rejected", "timeout", "mismatch"] as const) {
      const program = { ...fake.program, issue: async () => {
        if (failure === "rejected") throw new Error("provider failed");
        if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
        return { providerCardId: "ic_mismatch", cardholderId: "other", last4: "1234", status: "active" as const };
      } };
      const failed = createCardWriteService({ sql, programs: createCardPrograms([program], "bridge", sql) });
      await expect(failed.issue(owner, session)).rejects.toThrow();
      expect((await createCardAccountStore(sql).read(owner, "sandbox"))?.cards).toEqual([]);
    }
  });
  test("rejects missing wallet ownership before issuing", async () => {
    await expect(service.issue(other, session)).rejects.toThrow("CARD_NOT_READY");
    await expect(service.issue(owner, { ...session, smartAccount: { chainId: 8453, address: "0x2222222222222222222222222222222222222222" } })).rejects.toThrow("CARD_NOT_READY");
    expect(fake.calls.filter((call) => call.purpose === "issue")).toHaveLength(0);
  });
  test("concurrent issue requests create one card and return its Home UUID", async () => {
    const [left, right] = await Promise.all([service.issue(owner, session), service.issue(owner, session)]);
    expect(left).toEqual(right); cardId = left.id;
    expect(cardId).toMatch(/^[0-9a-f-]{36}$/); expect(cardId).not.toBe("ic_fixture1");
    expect(fake.calls.filter((call) => call.purpose === "issue")).toHaveLength(1);
    const handler = createCardsHandler({ authorize: async () => session, customer: async () => ({ id: owner }),
      read: (id) => readCardState(id, "sandbox", { store: createCardAccountStore(sql), programFor: programs.programFor }) });
    expect(parseCardsResponse(await (await handler(new Request("http://localhost/api/cards", { headers: { "X-Home-Account-Provider": "base-account" } }))).json())?.cards[0]?.id).toBe(cardId);
  });
  test("freeze is owner-fenced, idempotent by fresh state, and uses new keys per transition", async () => {
    await expect(service.freeze(other, cardId, true)).rejects.toThrow("CARD_NOT_FOUND");
    const handlers = createCardWriteHandlers({ authorize: async () => session, customer: async () => ({ id: owner }), service: () => service });
    expect(parseCardWriteResponse(await (await handlers.freeze(request(), cardId, true)).json())?.card).toEqual({ id: cardId, status: "frozen" });
    await service.freeze(owner, cardId, true);
    await service.freeze(owner, cardId, false); await service.freeze(owner, cardId, true);
    const calls = fake.calls.filter((call) => call.purpose === "freeze"); expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.key)).size).toBe(3);
  });
  test("freeze and reveal provider failures never fabricate success", async () => {
    const program = { ...fake.program,
      setFrozen: async () => { throw new DOMException("timeout", "TimeoutError"); },
      reveal: async () => { throw new Error("provider unavailable"); } };
    const failed = createCardWriteService({ sql, programs: createCardPrograms([program], "bridge", sql) });
    await expect(failed.freeze(owner, cardId, false)).rejects.toThrow();
    await expect(failed.reveal(owner, cardId, { method: "stripe-issuing-elements", step: "prepare" })).rejects.toThrow();
    expect(fake.cards.get("ic_fixture1")?.status).toBe("frozen");
  });
  test("both reveal steps require ownership and eligible state; grant IDs match the owned card", async () => {
    const handler = createCardRevealHandler({ authorize: async () => session, customer: async () => ({ id: owner }), reveal: service.reveal });
    for (const step of ["prepare", "grant"] as const) {
      const body = step === "prepare" ? { method: "stripe-issuing-elements", step } : { method: "stripe-issuing-elements", step, nonce: "nonce_synthetic123" };
      const response = parseCardRevealResponse(await (await handler(request(body), cardId)).json());
      expect(response?.cardId).toBe(cardId); expect(response?.grant.issuingCard).toBe("ic_fixture1");
      await expect(service.reveal(other, cardId, step === "prepare" ? { method: "stripe-issuing-elements", step } : { method: "stripe-issuing-elements", step, nonce: "nonce_synthetic123" })).rejects.toThrow("CARD_NOT_FOUND");
    }
    const original = fake.cards.get("ic_fixture1");
    if (!original) throw new Error("Missing fixture card");
    fake.cards.set("ic_fixture1", { ...original, status: "restricted" });
    await expect(service.reveal(owner, cardId, { method: "stripe-issuing-elements", step: "prepare" })).rejects.toThrow("CARD_NOT_READY");
    fake.cards.set("ic_fixture1", original);
    const mismatch = fakeProgram({ ...fake.program, reveal: async () => ({ method: "stripe-issuing-elements", step: "grant", issuingCard: "ic_other", nonce: "nonce_synthetic123", ephemeralKeySecret: "ek_test_synthetic123456" }) });
    const bad = createCardWriteService({ sql, programs: createCardPrograms([mismatch.program], "bridge", sql) });
    await expect(bad.reveal(owner, cardId, { method: "stripe-issuing-elements", step: "grant", nonce: "nonce_synthetic123" })).rejects.toThrow("CARDS_UNAVAILABLE");
  });
  test("replacement creates a new deterministic issue key after cancellation", async () => {
    const original = fake.cards.get("ic_fixture1");
    if (!original) throw new Error("Missing fixture card");
    fake.cards.set("ic_fixture1", { ...original, status: "canceled" });
    const replacement = await service.issue(owner, session); expect(replacement.id).not.toBe(cardId);
    const calls = fake.calls.filter((call) => call.purpose === "issue"); expect(calls[0]?.key).not.toBe(calls[1]?.key);
  });
  test("cross-program conflict fails closed when the other program is unavailable", async () => {
    await sql.query("INSERT INTO card_accounts(customer_id,mode,provider,provider_account_id) VALUES ($1,'sandbox','immersve','other-account')", [other]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','immersve','other-card',$2)", [other, wallet]);
    const before = fake.calls.length; await expect(service.issue(owner, session)).rejects.toThrow("CARDS_UNAVAILABLE"); expect(fake.calls).toHaveLength(before);
    const unavailable = fakeProgram({ provider: "immersve", readCards: async () => { throw new Error("provider unavailable"); } });
    const closed = createCardWriteService({ sql, programs: createCardPrograms([fake.program, unavailable.program], "bridge", sql) });
    await expect(closed.issue(owner, session)).rejects.toThrow("CARDS_UNAVAILABLE");
    const live = fakeProgram({ provider: "immersve", readCards: async () => [{ providerCardId: "other-card", ok: true, card: { providerCardId: "other-card", cardholderId: null, last4: "1234", status: "active" } }] });
    await expect(createCardWriteService({ sql, programs: createCardPrograms([fake.program, live.program], "bridge", sql) }).issue(owner, session)).rejects.toThrow("CARD_CONFLICT");
  });
  test("sticky selection never falls back from a disabled program", async () => {
    expect(await programs.programFor(other, "sandbox")).toBeNull();
    expect((await readCardState(other, "sandbox", { store: createCardAccountStore(sql), programFor: programs.programFor })).state).toBe("unavailable");
  });
});
