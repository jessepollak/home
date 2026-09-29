import { expect, test } from "bun:test";
import { shareIdentityApproval } from "./share";
import { createRuntimeIdentityStore, MemoryIdentityStore, PostgresIdentityStore } from "./store";

const customerId = "11111111-1111-4111-8111-111111111111";
const at = "2026-04-30T08:04:23.379Z";
const input = { customerId, env: "sandbox" as const, externalUserId: `home-${"a".repeat(32)}`, level: "home-level", consentVersion: "1", at };
const event = { source: "webhook" as const, configuredLevel: "home-level" };
test("memory store scopes by customer and environment, fences CAS, records approval flips", async () => {
  const store = new MemoryIdentityStore();
  const row = await store.reserve(input);
  expect((await store.reserve({ ...input, externalUserId: `home-${"b".repeat(32)}` })).id).toBe(row.id);
  expect(await store.active(customerId, "production")).toBeNull();
  const approved = await store.apply(row, { applicantId: "applicant1", levelName: "home-level", reviewState: "approved", approvedAt: at }, event, at);
  expect(approved?.version).toBe(1);
  expect(await store.apply(row, { applicantId: "applicant2" }, event, at)).toBeNull();
  expect(store.events).toHaveLength(1);
  expect(store.approvalEvents).toEqual([{ rowId: row.id, approved: true }]);
  const removed = await store.apply(approved!, { lifecycle: "removed", applicantId: null, approvedAt: null }, event, at);
  expect(store.approvalEvents).toHaveLength(2);
  const fresh = await store.reserve({ ...input, externalUserId: `home-${"c".repeat(32)}` });
  expect(fresh.id).not.toBe(row.id);
  expect(await store.byExternalId(input.externalUserId)).toMatchObject({ supersededAt: at });
  expect(await store.active(customerId, "sandbox")).toMatchObject({ id: fresh.id });
  expect(removed?.id).toBe(row.id);
});
test("final restriction survives removal and requires explicit release", async () => {
  const store = new MemoryIdentityStore();
  const row = await store.reserve(input);
  const rejected = await store.apply(row, { reviewState: "final", levelName: "home-level" }, event, at);
  expect(await store.restriction(customerId, "sandbox")).toBe(true);
  expect(await store.restriction(customerId, "production")).toBe(false);
  await store.apply(rejected!, { lifecycle: "removed", applicantId: null }, event, at);
  expect(await store.restriction(customerId, "sandbox")).toBe(true);
});
test("restriction suppresses approval events until release and an unchanged final cannot re-restrict", async () => {
  const store = new MemoryIdentityStore();
  const row = await store.reserve(input);
  const final = (await store.apply(row, { reviewState: "final", levelName: "home-level" }, event, at))!;
  const reset = (await store.apply(final, { reviewState: "not-submitted" }, event, at))!;
  const green = (await store.apply(reset, { reviewState: "approved", approvedAt: at }, event, at))!;
  expect(await store.restriction(customerId, "sandbox")).toBe(true);
  expect(store.events.at(-1)?.approved).toBe(false);
  expect(store.approvalEvents).toEqual([]);
  const restrictionId = (store as unknown as { restrictions: Map<string, { id: string }> }).restrictions.get(`${customerId}:sandbox`)!.id;
  expect(await store.releaseRestriction(restrictionId, "operator", at, "home-level")).toBe(true);
  expect(await store.releaseRestriction(restrictionId, "operator", at, "home-level")).toBe(false);
  expect(store.approvalEvents).toEqual([{ rowId: row.id, approved: true }]);
  const againFinal = (await store.apply(green, { reviewState: "final", approvedAt: null }, event, at))!;
  const reapplied = await store.apply(againFinal, { reviewState: "final", levelName: "home-level" }, event, at);
  expect(reapplied?.reviewState).toBe("final");
  expect(await store.restriction(customerId, "sandbox")).toBe(true);
  expect(await store.releaseRestriction((store as unknown as { restrictions: Map<string, { id: string }> }).restrictions.get(`${customerId}:sandbox`)!.id, "operator", at, "home-level")).toBe(true);
  await store.apply(reapplied!, { reviewState: "final", levelName: "home-level" }, event, at);
  expect(await store.restriction(customerId, "sandbox")).toBe(false);
});
test("a newer final review after release restricts again while a same-review replay does not", async () => {
  const store = new MemoryIdentityStore();
  const restrictionId = () => (store as unknown as { restrictions: Map<string, { id: string }> }).restrictions.get(`${customerId}:sandbox`)!.id;
  const row = await store.reserve(input);
  const final = (await store.apply(row, { reviewState: "final", levelName: "home-level", attemptCount: 1, reviewId: "review1", reviewCreatedAt: at }, event, at))!;
  expect(await store.releaseRestriction(restrictionId(), "operator", at, "home-level")).toBe(true);
  const replay = (await store.apply(final, { reviewState: "final", levelName: "home-level", attemptCount: 1, reviewId: "review1", reviewCreatedAt: at }, event, at))!;
  expect(await store.restriction(customerId, "sandbox")).toBe(false);
  await store.apply(replay, { reviewState: "final", levelName: "home-level", attemptCount: 2, reviewId: "review2", reviewCreatedAt: "2026-04-30T09:00:00.000Z" }, event, at);
  expect(await store.restriction(customerId, "sandbox")).toBe(true);
});
test("runtime requires a database and share seam stays closed", async () => {
  expect(createRuntimeIdentityStore({ NODE_ENV: "development" })).toBeNull();
  expect(createRuntimeIdentityStore({ DATABASE_URL: "postgres://db.invalid/home" })).toBeInstanceOf(PostgresIdentityStore);
  expect(await shareIdentityApproval(customerId, "unknown")).toEqual({ outcome: "unsupported-recipient" });
});

test("blocked rows cannot reserve a replacement", async () => {
  const store = new MemoryIdentityStore();
  const row = await store.reserve(input);
  const deactivated = (await store.apply(row, { lifecycle: "deactivated", applicantId: "applicant1" }, event, at))!;
  const oldId = deactivated.externalUserId;
  expect((await store.reserve({ ...input, externalUserId: `home-${"b".repeat(32)}` })).id).toBe(row.id);
  expect((await store.active(customerId, "sandbox"))?.externalUserId).toBe(oldId);
});
