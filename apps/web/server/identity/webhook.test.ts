import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import created from "./fixtures/applicant-created.synthetic.json";
import pending from "./fixtures/applicant-pending.synthetic.json";
import green from "./fixtures/applicant-green.synthetic.json";
import final from "./fixtures/applicant-final.synthetic.json";
import deleted from "./fixtures/applicant-deleted.synthetic.json";
import deactivated from "./fixtures/applicant-deactivated.synthetic.json";
import duplicate from "./fixtures/applicant-duplicate.synthetic.json";
import reset from "./fixtures/applicant-reset.synthetic.json";
import { IdentityService } from "./service";
import { MemoryIdentityStore } from "./store";
import { normalizeReviewState, mapIdentityRetryReason, type Applicant, type IdentityConfig } from "./sumsub";
import { handleSumsubWebhook, verifySumsubDigest } from "./webhook";

const key = "synthetic-test-key-not-for-production";
const customer = "11111111-1111-4111-8111-111111111111";
const externalId = `home-${"a".repeat(32)}`;
const at = "2026-04-30T08:04:23.379Z";
const config: IdentityConfig = { token: "sbx:synthetic-token", requestKey: "synthetic-request-key-000", digestKey: key, providerEnv: "sandbox", level: "home-level", supportUrl: "https://support.example.com" };
type Fixture = { raw: string; digest: string; alg: string; readback: unknown };
function toApplicant(fixture: Fixture): Applicant | null {
  const value = fixture.readback as { id: string; externalUserId: string; deleted?: boolean; review: { reviewStatus: string; reviewDate?: string; createDate?: string; attemptCnt?: number; reviewId?: string; levelName: string; reviewResult?: { reviewAnswer: string; reviewRejectType?: string; rejectLabels?: string[] } } } | null;
  if (!value) return null;
  const review = value.review;
  const result = review.reviewResult;
  return { id: value.id, externalUserId: value.externalUserId, deleted: value.deleted === true, reviewStatus: review.reviewStatus, reviewAnswer: result?.reviewAnswer ?? null, rejectType: result?.reviewRejectType ?? null, retryReason: mapIdentityRetryReason(result?.rejectLabels), reviewState: normalizeReviewState(review.reviewStatus, result?.reviewAnswer ?? null, result?.reviewRejectType ?? null, result?.rejectLabels), levelName: review.levelName, reviewDate: review.reviewDate ? new Date(review.reviewDate.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString() : null, reviewCreatedAt: review.createDate ?? null, attemptCount: review.attemptCnt ?? null, reviewId: review.reviewId ?? null };
}
function setup() {
  const store = new MemoryIdentityStore();
  let readback = toApplicant(created);
  let reads = 0;
  const provider = { get: async () => { reads++; return readback; }, create: async () => readback!, byExternalId: async () => readback, moveToLevel: async () => {}, token: async () => "sdk-token", link: async () => "https://sumsub.com/link" };
  const service = new IdentityService({ store, config, provider, now: () => at, randomId: () => externalId });
  const reserve = () => store.reserve({ customerId: customer, env: "sandbox", externalUserId: externalId, level: config.level, consentVersion: "1", at });
  const prime = async () => {
    const row = await reserve();
    const known = (await store.apply(row, { applicantId: toApplicant(created)!.id, levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
    await service.applyReadback(known, toApplicant(created), null, false, "session");
    return row;
  };
  const request = (fixture: Fixture, digest = fixture.digest, alg = fixture.alg) => new Request("https://home.test/api/identity/webhooks/sumsub", { method: "POST", headers: { "x-payload-digest": digest, "x-payload-digest-alg": alg }, body: fixture.raw });
  const handle = (fixture: Fixture, digest?: string, alg?: string) => handleSumsubWebhook(request(fixture, digest, alg), { config, store, provider, service });
  return { store, service, reserve, prime, handle, provider, setReadback: (value: Applicant | null) => { readback = value; }, get reads() { return reads; } };
}
afterEach(() => setObservabilityLogWriterForTests());
test("synthetic fixtures authenticate exact bytes and invalid algorithms fail before readback", async () => {
  for (const fixture of [created, pending, green, final, deleted, deactivated, duplicate, reset]) expect(verifySumsubDigest(new TextEncoder().encode(fixture.raw), fixture.digest, fixture.alg, key)).toBe(true);
  const state = setup(); await state.reserve();
  expect((await state.handle(created, "0".repeat(64))).status).toBe(401);
  expect((await state.handle(created, createHmac("sha1", key).update(created.raw).digest("hex"), "HMAC_SHA1_HEX")).status).toBe(401);
  expect(state.reads).toBe(0);
});
test("previous webhook digest key authenticates during rotation", async () => {
  const state = setup(); await state.reserve();
  const oldKey = "previous-synthetic-digest-key";
  const oldDigest = createHmac("sha256", oldKey).update(created.raw).digest("hex");
  const request = new Request("https://home.test/api/identity/webhooks/sumsub", { method: "POST", headers: { "x-payload-digest": oldDigest }, body: created.raw });
  expect((await handleSumsubWebhook(request, { config: { ...config, previousDigestKey: oldKey }, store: state.store, provider: state.provider, service: state.service })).status).toBe(200);
});
test("signed review applies readback, replays and superseded old events acknowledge", async () => {
  const state = setup(); await state.prime();
  state.setReadback(toApplicant(green));
  expect((await state.handle(green)).status).toBe(200);
  const before = await state.store.active(customer, "sandbox");
  expect((await state.handle(pending)).status).toBe(200);
  expect((await state.store.active(customer, "sandbox"))?.version).toBe(before?.version);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test.each([["green", green], ["final", final]] as const)("a %s decision on the first readback of a row with an unknown level neither approves nor restricts", async (_name, fixture) => {
  const state = setup();
  const row = await state.reserve();
  await state.store.apply(row, { applicantId: toApplicant(created)!.id }, { source: "session", configuredLevel: config.level }, at);
  state.setReadback(toApplicant(fixture));
  expect((await state.handle(fixture)).status).toBe(200);
  expect((await state.store.active(customer, "sandbox"))?.reviewState).toBe("not-submitted");
  expect(await state.store.restriction(customer, "sandbox")).toBe(false);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});
test("lagging event returns retryable error; later attempt acknowledges outdated event", async () => {
  const state = setup(); await state.reserve();
  state.setReadback(toApplicant(created));
  expect((await state.handle(green)).status).toBe(503);
  state.setReadback({ ...toApplicant(created)!, reviewCreatedAt: "2026-05-01T00:00:00.000Z", attemptCount: 2 });
  expect((await state.handle(green)).status).toBe(200);
});
test("deactivation and deletion readback revoke approval, restriction persists after 404", async () => {
  const state = setup(); await state.reserve();
  state.setReadback(toApplicant(deactivated));
  expect((await state.handle(deactivated)).status).toBe(200);
  expect((await state.store.active(customer, "sandbox"))?.lifecycle).toBe("deactivated");
  const restricted = setup(); await restricted.prime();
  restricted.setReadback(toApplicant(final));
  expect((await restricted.handle(final)).status).toBe(200);
  restricted.setReadback(null);
  expect((await restricted.handle(deleted)).status).toBe(200);
  expect(await restricted.store.restriction(customer, "sandbox")).toBe(true);
});
test("activated webhook restores the same blocked row; only deleted plus 404 allows a new attempt", async () => {
  const state = setup();
  const row = await state.prime();
  state.setReadback(toApplicant(deactivated));
  expect((await state.handle(deactivated)).status).toBe(200);
  expect(await state.service.getIdentityVerificationStatus(customer)).toMatchObject({ state: "blocked", consentRequired: false });
  await expect(state.service.startIdentityVerificationSession(customer, { consent: true })).rejects.toThrow("identity-conflict");
  expect((await state.store.active(customer, "sandbox"))?.externalUserId).toBe(externalId);
  state.setReadback(toApplicant(green));
  const activatedRaw = green.raw.replace("applicantReviewed", "applicantActivated");
  const activated = { ...green, raw: activatedRaw, digest: createHmac("sha256", key).update(activatedRaw).digest("hex") };
  expect((await state.handle(activated)).status).toBe(200);
  expect((await state.store.active(customer, "sandbox"))?.id).toBe(row.id);
  expect((await state.service.getIdentityVerificationStatus(customer)).state).toBe("verified");
  state.setReadback(null);
  expect((await state.handle(deleted)).status).toBe(200);
  expect(await state.service.getIdentityVerificationStatus(customer)).toMatchObject({ state: "removed", consentRequired: true });
  const next = await state.store.reserve({ customerId: customer, env: "sandbox", externalUserId: `home-${"b".repeat(32)}`, level: config.level, consentVersion: "1", at });
  expect(next.id).not.toBe(row.id);
});
test("deactivation without review markers revokes a marked approval and keeps its markers", async () => {
  const state = setup();
  await state.prime();
  const markers = { attemptCount: 2, reviewId: "review-2", reviewCreatedAt: "2026-04-30T08:00:00.000Z" };
  state.setReadback({ ...toApplicant(green)!, ...markers });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  state.setReadback(toApplicant(deactivated));
  expect((await state.handle(deactivated)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "deactivated", reviewState: "approved", ...markers });
  state.setReadback({ ...toApplicant(deactivated)!, attemptCount: 1, reviewCreatedAt: "2026-04-29T00:00:00.000Z", deleted: false });
  const activatedRaw = green.raw.replace("applicantReviewed", "applicantActivated");
  const activated = { ...green, raw: activatedRaw, digest: createHmac("sha256", key).update(activatedRaw).digest("hex") };
  expect((await state.handle(activated)).status).toBe(200);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "active", reviewState: "approved", ...markers });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a deletion callback retries while the readback still returns a deactivated applicant", async () => {
  const state = setup();
  const row = await state.prime();
  state.setReadback(toApplicant(deactivated));
  expect((await state.handle(deleted)).status).toBe(503);
  expect((await state.store.active(customer, "sandbox"))?.lifecycle).toBe("deactivated");
  state.setReadback(null);
  expect((await state.handle(deleted)).status).toBe(200);
  expect(await state.service.getIdentityVerificationStatus(customer)).toMatchObject({ state: "removed", consentRequired: true });
  expect((await state.store.active(customer, "sandbox"))?.id).toBe(row.id);
});
test("webhook ignores an older review when attemptCnt is missing", async () => {
  const state = setup();
  await state.prime();
  const row = (await state.store.active(customer, "sandbox"))!;
  await state.store.apply(row, { attemptCount: 2, reviewCreatedAt: "2026-05-01T00:00:00.000Z", reviewState: "pending" }, { source: "session", configuredLevel: config.level }, at);
  state.setReadback({ ...toApplicant(green)!, attemptCount: null, reviewCreatedAt: "2026-04-30T00:00:00.000Z" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.store.active(customer, "sandbox"))?.reviewState).toBe("pending");
});
test("duplicate-person never creates restriction; logs include only row id", async () => {
  const lines: string[] = [];
  setObservabilityLogWriterForTests((line) => { lines.push(line); });
  const state = setup(); const row = await state.prime();
  state.setReadback(toApplicant(duplicate));
  expect((await state.handle(duplicate)).status).toBe(200);
  expect((await state.service.getIdentityVerificationStatus(customer)).state).toBe("duplicate-person");
  expect(await state.store.restriction(customer, "sandbox")).toBe(false);
  expect(lines.join(" ")).toContain(row.id);
  for (const forbidden of [externalId, "applicant1", key, "DUPLICATE"]) expect(lines.join(" ")).not.toContain(forbidden);
});
function levelEvent(levelName: unknown, createdAtMs: string): Fixture {
  const raw = JSON.stringify({ type: "applicantLevelChanged", applicantId: "applicant1", externalUserId: externalId, levelName, createdAtMs });
  return { raw, digest: createHmac("sha256", key).update(raw).digest("hex"), alg: "HMAC_SHA256_HEX", readback: null };
}
test("a lagging level-change callback revokes approval before retry and acknowledges the target", async () => {
  const state = setup(); await state.prime();
  const approved = { ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 1, reviewId: "review-1" };
  state.setReadback(approved);
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  const changed = levelEvent("other-level", "2026-04-30 08:10:00.000");
  expect((await state.handle(changed)).status).toBe(503);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  const stored = (await state.store.active(customer, "sandbox"))!;
  expect(stored).toMatchObject({ reviewState: "not-submitted", levelMovedAt: at, levelMovedAttemptCount: 1 });
  const events = state.store.events.length;
  expect((await state.handle(changed)).status).toBe(503);
  expect((await state.store.active(customer, "sandbox"))?.version).toBe(stored.version);
  expect(state.store.events).toHaveLength(events);
  state.setReadback({ ...approved, levelName: "other-level" });
  expect((await state.handle(changed)).status).toBe(200);
});
test("a round-trip level change rejects a carried decision and accepts a later review", async () => {
  const state = setup(); await state.prime();
  const initial = { ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 1 };
  state.setReadback(initial);
  await state.handle(green);
  const carried = { ...initial, reviewCreatedAt: "2026-04-30T08:20:00.000Z", attemptCount: 2, reviewId: "review-2" };
  state.setReadback(carried);
  expect((await state.handle(levelEvent(config.level, "2026-04-30 08:25:00.000"))).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  const moved = (await state.store.active(customer, "sandbox"))!;
  expect(moved).toMatchObject({ levelMovedAt: carried.reviewCreatedAt, levelMovedAttemptCount: 2, reviewState: "not-submitted" });
  state.setReadback({ ...carried, reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 3 });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a late callback for Home's move leaves a newer review approved without an event", async () => {
  const state = setup(); await state.prime();
  const recent = { ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 2, reviewId: "review-2" };
  state.setReadback(recent);
  await state.handle(green);
  const before = (await state.store.active(customer, "sandbox"))!;
  const events = state.store.events.length;
  expect((await state.handle(levelEvent(config.level, "2026-04-30 08:20:00.000"))).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  expect((await state.store.active(customer, "sandbox"))?.version).toBe(before.version);
  expect(state.store.events).toHaveLength(events);
});
test("a callback to another level still records a boundary with a newer configured-level review", async () => {
  const state = setup(); await state.prime();
  const recent = { ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 2 };
  state.setReadback(recent);
  await state.handle(green);
  expect((await state.handle(levelEvent("other-level", "2026-04-30 08:20:00.000"))).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ levelMovedAt: recent.reviewCreatedAt, reviewState: "not-submitted" });
});
test("a level-change callback without a valid target is rejected without recording a boundary", async () => {
  const state = setup(); await state.prime();
  state.setReadback(toApplicant(green));
  await state.handle(green);
  const before = (await state.store.active(customer, "sandbox"))!;
  const events = state.store.events.length;
  expect((await state.handle(levelEvent({ invalid: "level" }, "2026-04-30 08:20:00.000"))).status).toBe(400);
  expect((await state.handle(levelEvent(undefined, "2026-04-30 08:20:00.000"))).status).toBe(400);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ version: before.version, levelMovedAt: null, levelMovedAttemptCount: null });
  expect(state.store.events).toHaveLength(events);
});
test("a delayed move to the configured level accepts a review proven newer than the callback", async () => {
  for (const [createdAt, approved] of [["2026-04-30T08:30:00.000Z", true], ["2026-04-30T08:15:00.000Z", false]] as const) {
    const state = setup(); await state.prime();
    state.setReadback({ ...toApplicant(pending)!, levelName: "other-level", reviewCreatedAt: "2026-04-30T08:05:00.000Z", attemptCount: 1 });
    expect((await state.handle(levelEvent("other-level", "2026-04-30 08:10:00.000"))).status).toBe(200);
    expect((await state.store.active(customer, "sandbox"))!.levelName).toBe("other-level");
    state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: createdAt, attemptCount: 2, reviewId: "review-2" });
    expect((await state.handle(levelEvent(config.level, "2026-04-30 08:20:00.000"))).status).toBe(200);
    expect((await state.service.getIdentityApproval(customer)).approved).toBe(approved);
    expect((await state.service.reconcile((await state.store.active(customer, "sandbox"))!)).stale).toBe(false);
    expect((await state.service.getIdentityApproval(customer)).approved).toBe(approved);
  }
});
test("a level-change boundary cannot move backwards on an older readback", async () => {
  const state = setup(); await state.prime();
  const later = { ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 3 };
  state.setReadback(later);
  const changed = levelEvent("other-level", "2026-04-30 08:40:00.000");
  expect((await state.handle(changed)).status).toBe(503);
  state.setReadback({ ...later, reviewCreatedAt: "2026-04-30T08:20:00.000Z", attemptCount: 2 });
  expect((await state.handle(changed)).status).toBe(200);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ levelMovedAt: later.reviewCreatedAt, levelMovedAttemptCount: 3, reviewCreatedAt: later.reviewCreatedAt, attemptCount: 3 });
});
test("applicant mismatch is ignored before provider read", async () => {
  const state = setup();
  const row = await state.reserve();
  await state.store.apply(row, { applicantId: "different" }, { source: "session", configuredLevel: config.level }, at);
  expect((await state.handle(created)).status).toBe(200);
  expect(state.reads).toBe(0);
});
test("a confirmed reset at a lower attempt revokes approval and a later attempt can approve again", async () => {
  const state = setup(); await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  state.setReadback({ ...toApplicant(reset)!, attemptCount: 1, reviewCreatedAt: "2026-04-30T07:00:00.000Z" });
  expect((await state.handle(reset)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "reset", reviewState: "not-submitted", attemptCount: 1 });
  expect((await state.service.reconcile((await state.store.active(customer, "sandbox"))!)).row).toMatchObject({ lifecycle: "reset" });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 2, reviewId: "review-4" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a signed reset whose readback is already pending at a lower attempt revokes approval and resets ordering", async () => {
  const state = setup(); await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  state.setReadback({ ...toApplicant(pending)!, attemptCount: 1, reviewCreatedAt: "2026-04-30T07:00:00.000Z" });
  expect((await state.handle(reset)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "active", reviewState: "pending", attemptCount: 1 });
  state.setReadback({ ...toApplicant(final)!, attemptCount: 1, reviewCreatedAt: "2026-04-30T07:00:00.000Z", reviewId: "review-5" });
  expect((await state.handle(final)).status).toBe(200);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ reviewState: "final", attemptCount: 1 });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});
test("a signed reset whose readback already completed a newer attempt records that decision", async () => {
  for (const decision of [green, final]) {
    const state = setup(); await state.prime();
    state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T08:00:00.000Z", attemptCount: 3, reviewId: "review-3" });
    expect((await state.handle(green)).status).toBe(200);
    expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
    const completed = { ...toApplicant(decision)!, reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 1, reviewId: "review-4" };
    state.setReadback(completed);
    expect((await state.handle(reset)).status).toBe(200);
    expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "active", reviewState: completed.reviewState, attemptCount: 1, reviewId: "review-4", reviewCreatedAt: completed.reviewCreatedAt });
    expect((await state.service.getIdentityApproval(customer)).approved).toBe(decision === green);
    expect(await state.store.restriction(customer, "sandbox")).toBe(decision === final);
    expect((await state.service.reconcile((await state.store.active(customer, "sandbox"))!)).stale).toBe(false);
  }
});
test("a decision that shares no ordering marker with the stored review neither approves nor restricts", async () => {
  for (const decision of [green, final]) {
    const state = setup(); await state.prime();
    state.setReadback({ ...toApplicant(pending)!, attemptCount: null, reviewCreatedAt: at });
    expect((await state.handle(pending)).status).toBe(200);
    const row = (await state.store.active(customer, "sandbox"))!;
    expect(row).toMatchObject({ reviewState: "pending", attemptCount: null, reviewCreatedAt: at });
    const result = await state.service.applyReadback(row, { ...toApplicant(decision)!, attemptCount: 2, reviewCreatedAt: null }, null, false, "reconcile");
    expect(result.stale).toBe(true);
    expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
    expect(await state.store.restriction(customer, "sandbox")).toBe(false);
    expect((await state.store.active(customer, "sandbox"))!.reviewState).toBe("pending");
  }
});
test("a reset readback without attempt markers lets a lower-count approval follow", async () => {
  const state = setup(); await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  state.setReadback(toApplicant(reset));
  expect((await state.handle(reset)).status).toBe(200);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ lifecycle: "reset", attemptCount: null, reviewCreatedAt: null });
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 1, reviewId: "review-4" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("an unconfirmed lower-attempt init readback stays stale against an approval", async () => {
  const state = setup(); await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  const row = (await state.store.active(customer, "sandbox"))!;
  expect((await state.service.applyReadback(row, { ...toApplicant(reset)!, attemptCount: 1, reviewCreatedAt: "2026-04-30T07:00:00.000Z" }, null, false, "reconcile")).stale).toBe(true);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a reset callback whose readback shows an older completed attempt retries until the reset is visible", async () => {
  const state = setup(); await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  const before = (await state.store.active(customer, "sandbox"))!;
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T07:00:00.000Z", attemptCount: 2, reviewId: "review-2" });
  expect((await state.handle(reset)).status).toBe(503);
  expect((await state.store.active(customer, "sandbox"))!.version).toBe(before.version);
  state.setReadback({ ...toApplicant(pending)!, attemptCount: 1, reviewCreatedAt: "2026-04-30T07:00:00.000Z" });
  expect((await state.handle(reset)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ reviewState: "pending", attemptCount: 1 });
});
test("a reset callback whose readback still shows the decision retries without changing the row", async () => {
  const state = setup(); await state.prime();
  const approved = { ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" };
  state.setReadback(approved);
  expect((await state.handle(green)).status).toBe(200);
  const before = (await state.store.active(customer, "sandbox"))!;
  expect((await state.handle(reset)).status).toBe(503);
  expect((await state.store.active(customer, "sandbox"))!.version).toBe(before.version);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
});

function resetEvent(createdAtMs: string | null): Fixture {
  const fields = ["\"type\":\"applicantReset\"", "\"applicantId\":\"applicant1\"", `"externalUserId":"${externalId}"`];
  if (createdAtMs !== null) fields.push(`"createdAtMs":"${createdAtMs}"`);
  const raw = `{${fields.join(",")}}`;
  return { raw, digest: createHmac("sha256", key).update(raw).digest("hex"), alg: "HMAC_SHA256_HEX", readback: null };
}

test("a markerless completed reset readback records a boundary that revokes approval", async () => {
  const state = setup();
  await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(true);
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: null, attemptCount: 1, reviewId: "review-4" });
  expect((await state.handle(reset)).status).toBe(503);
  const revoked = (await state.store.active(customer, "sandbox"))!;
  expect(revoked).toMatchObject({ resetAt: at, reviewState: "not-submitted", lifecycle: "reset", approvedAt: null, attemptCount: null, reviewId: null, reviewCreatedAt: null });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
  expect((await state.service.reconcile(revoked)).row).toMatchObject({ reviewState: "not-submitted", approvedAt: null });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});

test("a reset boundary keeps a markerless approval revoked against an undated completed readback", async () => {
  const state = setup();
  await state.prime();
  state.setReadback(toApplicant(green));
  expect((await state.handle(green)).status).toBe(200);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ reviewState: "approved", attemptCount: null, reviewCreatedAt: null });
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: null });
  expect((await state.handle(reset)).status).toBe(503);
  const revoked = (await state.store.active(customer, "sandbox"))!;
  expect(revoked).toMatchObject({ resetAt: at, reviewState: "not-submitted", lifecycle: "reset" });
  expect((await state.service.reconcile(revoked)).row).toMatchObject({ reviewState: "not-submitted" });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});

test("a reset callback without an event time still records a boundary", async () => {
  const state = setup();
  await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: "2026-04-30T07:00:00.000Z", attemptCount: 1, reviewId: "review-4" });
  expect((await state.handle(resetEvent(null))).status).toBe(503);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ resetAt: at, reviewState: "not-submitted", lifecycle: "reset" });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});

test("a reset readback with a different review at the same time records a boundary", async () => {
  const state = setup();
  await state.prime();
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 3, reviewId: "review-3" });
  expect((await state.handle(green)).status).toBe(200);
  state.setReadback({ ...toApplicant(green)!, reviewCreatedAt: at, attemptCount: 1, reviewId: "review-4" });
  expect((await state.handle(reset)).status).toBe(503);
  expect(await state.store.active(customer, "sandbox")).toMatchObject({ resetAt: at, reviewState: "not-submitted", lifecycle: "reset" });
  expect((await state.service.getIdentityApproval(customer)).approved).toBe(false);
});
