import { afterEach, expect, spyOn, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { normalizeReviewState } from "./sumsub";
import { IdentityConflict, IdentityRateLimited, IdentityService } from "./service";
import { MemoryIdentityStore } from "./store";
import { readIdentityConfig, type Applicant, type IdentityConfig } from "./sumsub";

const customer = "11111111-1111-4111-8111-111111111111";
const externalUserId = `home-${"a".repeat(32)}`;
const at = "2026-04-30T08:04:23.379Z";
const config: IdentityConfig = { token: "sbx:synthetic-token", requestKey: "synthetic-request-key-000", digestKey: "synthetic-digest-key-000", level: "home-level", providerEnv: "sandbox", supportUrl: "https://support.example.com" };
const applicant = (patch: Partial<Applicant> = {}): Applicant => ({ id: "applicant1", externalUserId, reviewStatus: "init", reviewDate: null, reviewCreatedAt: null, attemptCount: null, reviewId: null, levelName: "home-level", reviewAnswer: null, rejectType: null, retryReason: null, reviewState: "not-submitted", deleted: false, ...patch });
function setup() {
  const store = new MemoryIdentityStore();
  let readback: Applicant | null = applicant();
  let time = at;
  let moves = 0;
  const provider = { create: async () => readback!, byExternalId: async (_id: string) => null as Applicant | null, get: async (_id: string): Promise<Applicant | null> => readback, moveToLevel: async () => { moves++; }, token: async () => "sdk-token", link: async () => "https://sumsub.com/link" };
  const service = new IdentityService({ store, config, provider, now: () => time, randomId: () => externalUserId });
  const reserve = () => store.reserve({ customerId: customer, env: "sandbox", externalUserId, level: config.level, consentVersion: "1", at: "2026-04-30T07:00:00.000Z" });
  return { service, store, provider, reserve, anotherService: () => new IdentityService({ store, config, provider, now: () => time, randomId: () => externalUserId }), setReadback: (value: Applicant | null) => { readback = value; }, setTime: (value: string) => { time = value; }, get moves() { return moves; } };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function reserveAdoptedRows(store: MemoryIdentityStore, count: number) {
  const ids = Array.from({ length: count }, (_, index) => `home-${String(index).padStart(32, "a")}`);
  for (const [index, externalId] of ids.entries()) {
    const row = await store.reserve({ customerId: `customer-${index}`, env: "sandbox", externalUserId: externalId, level: config.level, consentVersion: "1", at });
    await store.apply(row, { applicantId: `applicant-${index}` }, { source: "session", configuredLevel: config.level }, at);
  }
  return ids;
}
afterEach(() => setObservabilityLogWriterForTests());
test("session requires consent, adopts ambiguous create and respects linked customer scope", async () => {
  const fixture = setup();
  await expect(fixture.service.startIdentityVerificationSession(customer, {})).rejects.toBeInstanceOf(IdentityConflict);
  let creates = 0;
  fixture.provider.create = async () => { creates++; throw new Error("ambiguous"); };
  let lookups = 0;
  fixture.provider.byExternalId = async () => ++lookups === 1 ? null : applicant();
  expect((await fixture.service.startIdentityVerificationSession(customer, { consent: true })).status.state).toBe("in-progress");
  expect(creates).toBe(1);
  expect(await fixture.service.getIdentityVerificationStatus("other")).toMatchObject({ state: "not-started" });
  expect(await fixture.service.createIdentityVerificationLink(customer)).toBe("https://sumsub.com/link");
});
test("adopting a created applicant saves its level so the customer's first GREEN can approve", async () => {
  const fixture = setup();
  expect((await fixture.service.startIdentityVerificationSession(customer, { consent: true })).status.state).toBe("in-progress");
  expect(await fixture.store.active(customer, "sandbox")).toMatchObject({ applicantId: "applicant1", levelName: config.level, levelMovedAt: null });
  const row = (await fixture.store.active(customer, "sandbox"))!;
  await fixture.service.applyReadback(row, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewCreatedAt: at, attemptCount: 1, reviewDate: at }), at, false);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("an unknown-level pending review records a boundary before itself and can later approve", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const pending = applicant({ reviewState: "pending", reviewStatus: "pending", reviewCreatedAt: at, attemptCount: 2, reviewId: "review-2" });
  const moved = (await fixture.service.applyReadback(row, pending, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: "2026-04-30T08:04:23.378Z", levelMovedAttemptCount: 1 });
  const approved = (await fixture.service.applyReadback(moved, { ...pending, reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at }, null, false)).row;
  expect(approved.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("approval at new level records after operator move; missing level never moves or approves", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const learned = (await fixture.service.applyReadback(known, applicant(), null, false)).row;
  const approved = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at });
  await fixture.service.applyReadback(learned, approved, at, false);
  expect(await fixture.service.getIdentityApproval(customer)).toEqual({ approved: true, level: "home-level", approvedAt: at });
  expect(fixture.store.approvalEvents).toHaveLength(1);
  const stored = (await fixture.store.active(customer, "sandbox"))!;
  fixture.setReadback(applicant({ ...approved, levelName: null }));
  await fixture.service.applyReadback(stored, applicant({ ...approved, levelName: null }), at, false);
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("pending");
  expect(fixture.moves).toBe(0);
});
test.each([
  ["review date", { reviewCreatedAt: "2026-04-30T08:04:24.000Z" }],
  ["attempt count", { attemptCount: 2 }],
] as const)("a first decided GREEN at the configured level needs a later %s to approve", async (_marker, newReview) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const carried = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 1 });
  const moved = (await fixture.service.applyReadback(row, carried, at, false)).row;
  expect(moved).toMatchObject({ levelName: "home-level", levelMovedAt: at, levelMovedAttemptCount: 1, reviewState: "not-submitted", approvedAt: null });
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(fixture.store.approvalEvents).toEqual([]);
  expect((await fixture.service.applyReadback(moved, carried, at, false)).row.reviewState).toBe("not-submitted");
  const later = (await fixture.service.applyReadback(moved, { ...carried, ...newReview }, null, false)).row;
  expect(later.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
  expect(fixture.store.approvalEvents).toEqual([{ rowId: row.id, approved: true }]);
});
test("a level-less GREEN row reconciles on the short interval, inline and in scheduled batches", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1", reviewState: "approved", levelName: null, approvedAt: at, reconciledAt: at }, { source: "webhook", configuredLevel: config.level }, at);
  let reads = 0;
  const approved = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 1 });
  fixture.provider.get = async () => { reads++; return approved; };
  fixture.setTime("2026-04-30T08:09:23.379Z");
  expect(await fixture.store.staleActive("sandbox", 50, "2026-04-30T08:04:23.379Z", config.level)).toHaveLength(0);
  expect((await fixture.store.staleActive("sandbox", 50, "2026-04-30T08:04:23.380Z", config.level)).map((item) => item.id)).toEqual([row.id]);
  await fixture.service.getIdentityVerificationStatus(customer);
  expect(reads).toBe(1);
  expect((await fixture.store.active(customer, "sandbox"))!.levelName).toBe(config.level);
});
test("a first decided FINAL RED at the configured level does not restrict", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const moved = (await fixture.service.applyReadback(row, applicant({ reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL", reviewCreatedAt: at, attemptCount: 1 }), null, false)).row;
  expect(moved).toMatchObject({ levelName: "home-level", levelMovedAt: at, levelMovedAttemptCount: 1, reviewState: "not-submitted" });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).not.toBe("rejected");
});
test.each([
  ["init", "not-submitted"],
  ["pending", "pending"],
] as const)("a known-level %s readback accepts a following GREEN", async (reviewStatus, reviewState) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const learned = (await fixture.service.applyReadback(known, applicant({ reviewStatus, reviewState }), null, false)).row;
  expect(learned).toMatchObject({ levelMovedAt: null, levelMovedAttemptCount: null, reviewState });
  const approved = (await fixture.service.applyReadback(learned, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at }), null, false)).row;
  expect(approved.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("session readback without reported level never calls moveToLevel", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1", levelName: null }, { source: "session", configuredLevel: config.level }, at);
  fixture.setReadback(applicant({ levelName: null }));
  expect((await fixture.service.startIdentityVerificationSession(customer, {})).status.state).toBe("in-progress");
  expect(fixture.moves).toBe(0);
});
test("a dashboard level move rejects the previous GREEN review and accepts a later approval", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewCreatedAt: at, attemptCount: 2 }, { source: "session", configuredLevel: config.level }, at))!;
  const oldReview = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewCreatedAt: at, attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(old, oldReview, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: at, levelMovedAttemptCount: 2, reviewState: "not-submitted", approvedAt: null });
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect((await fixture.service.applyReadback(moved, { ...oldReview, reviewCreatedAt: "2026-04-30T08:04:24.000Z" }, null, false)).row.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a second level move rejects an approved review carried over from the first level", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: "2026-04-30T07:30:00.000Z", attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const pendingA = applicant({ reviewState: "pending", reviewStatus: "pending", reviewCreatedAt: "2026-04-30T08:05:00.000Z", attemptCount: 2, reviewId: "review-a" });
  const movedA = (await fixture.service.applyReadback(old, pendingA, null, false)).row;
  expect(movedA).toMatchObject({ levelMovedAttemptCount: 1, reviewState: "pending" });
  const approvedA = { ...pendingA, reviewState: "approved" as const, reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: "2026-04-30T08:20:00.000Z" };
  const atA = (await fixture.service.applyReadback(movedA, approvedA, null, false)).row;
  expect(atA.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);

  const levelB = "next-level";
  const serviceB = new IdentityService({ store: fixture.store, config: { ...config, level: levelB }, provider: fixture.provider, now: () => at, randomId: () => externalUserId });
  expect((await serviceB.getIdentityApproval(customer)).approved).toBe(false);
  const movedB = (await serviceB.applyReadback(atA, { ...approvedA, levelName: levelB }, null, false)).row;
  expect(movedB).toMatchObject({ levelName: levelB, levelMovedAt: pendingA.reviewCreatedAt, levelMovedAttemptCount: 2, reviewState: "not-submitted", approvedAt: null });
  expect((await serviceB.getIdentityApproval(customer)).approved).toBe(false);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  const approvedB = (await serviceB.applyReadback(movedB, { ...approvedA, levelName: levelB, reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 3, reviewId: "review-b", reviewDate: "2026-04-30T09:15:00.000Z" }, null, false)).row;
  expect(approvedB.reviewState).toBe("approved");
  expect((await serviceB.getIdentityApproval(customer)).approved).toBe(true);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
});
test.each([
  ["approved", { reviewState: "approved", reviewAnswer: "GREEN", reviewDate: "2026-04-30T08:10:00.000Z" }],
  ["final", { reviewState: "final", reviewAnswer: "RED", rejectType: "FINAL" }],
] as const)("a second level move keeps an unseen intermediate-level %s decision stale", async (_name, decision) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const atA = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level, reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const levelB = "next-level";
  const serviceB = new IdentityService({ store: fixture.store, config: { ...config, level: levelB }, provider: fixture.provider, now: () => at, randomId: () => externalUserId });
  const oldA = applicant({ levelName: levelB, reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 1 });
  const movedB = (await serviceB.applyReadback(atA, oldA, null, false)).row;
  expect(movedB).toMatchObject({ levelName: levelB, levelMovedAt: at, levelMovedAttemptCount: 1, reviewCreatedAt: at, attemptCount: 1, reviewState: "not-submitted", approvedAt: null });

  const levelC = "third-level";
  const serviceC = new IdentityService({ store: fixture.store, config: { ...config, level: levelC }, provider: fixture.provider, now: () => at, randomId: () => externalUserId });
  const carried = applicant({ ...decision, levelName: levelC, reviewStatus: "completed", reviewCreatedAt: "2026-04-30T08:05:00.000Z", attemptCount: 2, reviewId: "review-b" });
  const movedC = (await serviceC.applyReadback(movedB, carried, null, false)).row;
  expect(movedC).toMatchObject({ levelName: levelC, levelMovedAt: carried.reviewCreatedAt, levelMovedAttemptCount: carried.attemptCount, reviewState: "not-submitted", approvedAt: null });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect((await serviceC.getIdentityApproval(customer)).approved).toBe(false);

  const approvedC = (await serviceC.applyReadback(movedC, applicant({ levelName: levelC, reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: "2026-04-30T09:00:00.000Z", reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 3, reviewId: "review-c" }), null, false)).row;
  expect(approvedC.reviewState).toBe("approved");
  expect((await serviceC.getIdentityApproval(customer)).approved).toBe(true);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
});
test("a Home level move records its boundary from a completed post-move readback and ignores old GREEN", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const previous = "2026-04-30T07:00:00.000Z";
  await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewCreatedAt: previous, attemptCount: 2, reviewState: "approved", approvedAt: previous }, { source: "session", configuredLevel: config.level }, previous);
  const oldGreen = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: previous, reviewCreatedAt: previous, attemptCount: 2 });
  fixture.provider.moveToLevel = async () => {
    const stored = (await fixture.store.active(customer, "sandbox"))!;
    expect(stored).toMatchObject({ levelMovedAt: null, levelMovedAttemptCount: null, levelName: "old-level" });
    fixture.setReadback(oldGreen);
  };
  fixture.setReadback({ ...oldGreen, levelName: "old-level" });
  expect((await fixture.service.startIdentityVerificationSession(customer, {})).status.state).toBe("in-progress");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  const stored = (await fixture.store.active(customer, "sandbox"))!;
  expect(stored).toMatchObject({ levelMovedAt: previous, levelMovedAttemptCount: 2, reviewState: "not-submitted", approvedAt: null });
  const next = await fixture.service.applyReadback(stored, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: previous, attemptCount: 3 }), null, false);
  expect(next.row.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test.each([
  ["approved", { reviewState: "approved", reviewAnswer: "GREEN", reviewDate: "2026-04-30T08:10:00.000Z" }],
  ["final", { reviewState: "final", reviewAnswer: "RED", rejectType: "FINAL" }],
] as const)("an unseen old-level %s attempt carried over by a dashboard move stays stale", async (_name, decision) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const unseen = applicant({ ...decision, reviewStatus: "completed", reviewCreatedAt: "2026-04-30T08:05:00.000Z", attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(old, unseen, null, false)).row;
  expect(moved).toMatchObject({ levelName: "home-level", levelMovedAt: "2026-04-30T08:05:00.000Z", levelMovedAttemptCount: 2, reviewState: "not-submitted", approvedAt: null });
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect(fixture.store.approvalEvents).toEqual([]);
  expect((await fixture.service.applyReadback(moved, unseen, null, false)).row.reviewState).toBe("not-submitted");
  const approved = (await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: "2026-04-30T09:00:00.000Z", reviewCreatedAt: "2026-04-30T08:30:00.000Z", attemptCount: 3 }), null, false)).row;
  expect(approved.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a dashboard move observed before the new-level decision counts that decision", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const reopened = applicant({ reviewCreatedAt: "2026-04-30T08:05:00.000Z", attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(old, reopened, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: "2026-04-30T08:04:59.999Z", levelMovedAttemptCount: 1 });
  const approved = (await fixture.service.applyReadback(moved, { ...reopened, reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: "2026-04-30T08:20:00.000Z" }, null, false)).row;
  expect(approved.reviewState).toBe("approved");
});
test("a markerless completed review carried over by a move remains stale on replay", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending" }, { source: "session", configuredLevel: config.level }, at))!;
  const carried = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at });
  const moved = (await fixture.service.applyReadback(old, carried, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: "1970-01-01T00:00:00.000Z", levelMovedAttemptCount: null, reviewState: "not-submitted" });
  expect((await fixture.service.applyReadback(moved, carried, null, false)).row.reviewState).toBe("not-submitted");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(fixture.store.approvalEvents).toEqual([]);
});
test("a carried completed review without a date remains stale by its attempt boundary", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const carried = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(old, carried, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: null, levelMovedAttemptCount: 2, reviewState: "not-submitted" });
  expect((await fixture.service.applyReadback(moved, carried, null, false)).row.reviewState).toBe("not-submitted");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
});
test.each([
  [null, null, null, null, "1970-01-01T00:00:00.000Z", null, {}],
  [at, 1, null, null, at, 1, { attemptCount: 2, reviewCreatedAt: "2026-04-30T09:00:00.000Z" }],
  [at, 1, "2026-04-30T07:30:00.000Z", 2, "2026-04-30T07:29:59.999Z", 1, {}],
] as const)("a dashboard move with stored markers %s/%s accepts the pending new-level review", async (storedDate, storedAttempt, reviewDate, reviewAttempt, boundaryDate, boundaryAttempt, decisionMarkers) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: storedDate, attemptCount: storedAttempt }, { source: "session", configuredLevel: config.level }, at))!;
  const pending = applicant({ reviewState: "manual-review", reviewStatus: "onHold", reviewCreatedAt: reviewDate, attemptCount: reviewAttempt });
  const moved = (await fixture.service.applyReadback(old, pending, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: boundaryDate, levelMovedAttemptCount: boundaryAttempt, reviewState: "manual-review" });
  const decision = { ...pending, ...decisionMarkers, reviewState: "approved" as const, reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at };
  const approved = (await fixture.service.applyReadback(moved, decision, null, false)).row;
  expect(approved.reviewState).toBe("approved");
  expect((await fixture.service.applyReadback(approved, decision, null, false)).row.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("a markerless decision after a dashboard move over a recorded review fails closed", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const pending = applicant({ reviewState: "manual-review", reviewStatus: "onHold" });
  const moved = (await fixture.service.applyReadback(old, pending, null, false)).row;
  expect(moved.reviewState).toBe("manual-review");
  expect((await fixture.service.applyReadback(moved, { ...pending, reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at }, null, false)).stale).toBe(true);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
});
test("a provider reset to a lower attempt is accepted only as the first level-move readback", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", attemptCount: 3, reviewCreatedAt: at }, { source: "session", configuredLevel: config.level }, at))!;
  const oldLevelReset = applicant({ levelName: "old-level", reviewState: "pending", attemptCount: 0, reviewCreatedAt: "2026-04-30T07:00:00.000Z" });
  expect((await fixture.service.applyReadback(old, oldLevelReset, null, false)).stale).toBe(true);
  const moved = (await fixture.service.applyReadback(old, { ...oldLevelReset, levelName: "home-level" }, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAttemptCount: -1, levelMovedAt: "2026-04-30T06:59:59.999Z", attemptCount: 0, reviewState: "pending" });
  expect((await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", attemptCount: 0, reviewCreatedAt: "2026-04-30T07:00:00.000Z", reviewDate: at }), null, false)).row.reviewState).toBe("approved");
  expect((await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", attemptCount: 0, reviewCreatedAt: "2026-04-30T06:00:00.000Z", reviewDate: at }), null, false)).stale).toBe(true);
});
test("a Home move accepts a pending new-level review after provider reset", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at);
  fixture.setReadback(applicant({ levelName: "old-level", reviewCreatedAt: at, attemptCount: 1 }));
  fixture.provider.moveToLevel = async () => fixture.setReadback(applicant({ reviewState: "pending", reviewStatus: "pending", reviewCreatedAt: at, attemptCount: 2 }));
  await expect(fixture.service.startIdentityVerificationSession(customer, {})).rejects.toMatchObject({ status: { state: "pending" } });
  const moved = (await fixture.store.active(customer, "sandbox"))!;
  expect(moved).toMatchObject({ levelMovedAt: "2026-04-30T08:04:23.378Z", levelMovedAttemptCount: 1 });
  await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 2 }), null, false);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("hosted link rechecks a restriction created during the level move", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "retry", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at);
  fixture.setReadback(applicant({ levelName: "old-level", reviewState: "retry", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "RETRY", reviewCreatedAt: at, attemptCount: 1 }));
  fixture.provider.moveToLevel = async () => {
    const current = (await fixture.store.active(customer, "sandbox"))!;
    await fixture.store.apply(current, { reviewState: "final", levelName: config.level }, { source: "webhook", configuredLevel: config.level }, at);
    fixture.setReadback(applicant({ reviewState: "pending", reviewStatus: "pending", reviewCreatedAt: at, attemptCount: 2 }));
  };
  await expect(fixture.service.createIdentityVerificationLink(customer)).rejects.toMatchObject({ status: { state: "rejected" } });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
});
test("a readback after a Home move crash detects the provider move", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const moved = (await fixture.service.applyReadback(old, applicant({ reviewState: "pending", reviewStatus: "pending", reviewCreatedAt: at, attemptCount: 2 }), null, false)).row;
  expect(moved).toMatchObject({ levelMovedAttemptCount: 1, levelMovedAt: "2026-04-30T08:04:23.378Z" });
  expect((await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 2 }), null, false)).row.reviewState).toBe("approved");
});
test("a Home level move reads the applicant first so an unseen old-level attempt stays before the move", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const previous = "2026-04-30T07:00:00.000Z";
  await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: previous, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, previous);
  const unseen = applicant({ levelName: "old-level", reviewState: "retry", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "RETRY", reviewCreatedAt: "2026-04-30T07:30:00.000Z", attemptCount: 2 });
  fixture.setReadback(unseen);
  fixture.provider.moveToLevel = async () => {
    expect((await fixture.store.active(customer, "sandbox"))!).toMatchObject({ levelMovedAt: null, levelMovedAttemptCount: null, attemptCount: 2 });
    fixture.setReadback({ ...unseen, levelName: "home-level", reviewState: "approved", reviewAnswer: "GREEN", rejectType: null, reviewDate: "2026-04-30T07:40:00.000Z" });
  };
  await fixture.service.startIdentityVerificationSession(customer, {}).catch(() => undefined);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect(fixture.store.approvalEvents).toEqual([]);
});
test("an old-level final neither restricts nor sticks when a carried GREEN reaches the moved level", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const final = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "final", reviewCreatedAt: at, attemptCount: 2 }, { source: "webhook", configuredLevel: config.level }, at))!;
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  const readback = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewCreatedAt: at, attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(final, readback, null, false)).row;
  expect(moved).toMatchObject({ reviewState: "not-submitted", approvedAt: null });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
});
test("a new FINAL observed at the old level before the move creates no restriction", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 1 }, { source: "session", configuredLevel: config.level }, at))!;
  const oldFinal = applicant({ levelName: "old-level", reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL", reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 2 });
  const observed = (await fixture.service.applyReadback(old, oldFinal, null, false, "reconcile")).row;
  expect(observed).toMatchObject({ reviewState: "final", levelName: "old-level" });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("level-changed");
});
test("an old GREEN carried by a level-changed event cannot downgrade a configured-level final rejection", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const final = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level, reviewState: "final", reviewCreatedAt: at, attemptCount: 2 }, { source: "webhook", configuredLevel: config.level }, at))!;
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
  const readback = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewCreatedAt: at, attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(final, readback, null, false, "webhook", true)).row;
  expect(moved).toMatchObject({ reviewState: "final", approvedAt: null });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
});
test.each([
  ["final", { reviewState: "final", reviewAnswer: "RED", rejectType: "FINAL" }],
  ["retry", { reviewState: "retry", reviewAnswer: "RED", rejectType: "RETRY" }],
  ["duplicate", { reviewState: "duplicate", reviewAnswer: "RED", rejectType: "FINAL" }],
] as const)("a previous-level %s decision after a level move neither restricts nor sticks", async (_name, decision) => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewState: "pending", reviewCreatedAt: at, attemptCount: 2 }, { source: "session", configuredLevel: config.level }, at))!;
  const oldReview = applicant({ ...decision, reviewStatus: "completed", reviewCreatedAt: at, attemptCount: 2 });
  const moved = (await fixture.service.applyReadback(old, oldReview, null, false)).row;
  expect(moved).toMatchObject({ levelMovedAt: at, reviewState: "not-submitted", retryReason: null });
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  const approved = (await fixture.service.applyReadback(moved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 3 }), null, false)).row;
  expect(approved.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
});
test("a new-level FINAL review after a level move still restricts", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const old = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: "old-level", reviewCreatedAt: at, attemptCount: 2 }, { source: "session", configuredLevel: config.level }, at))!;
  const moved = (await fixture.service.applyReadback(old, applicant({ reviewCreatedAt: at, attemptCount: 2 }), null, false)).row;
  const final = (await fixture.service.applyReadback(moved, applicant({ reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL", reviewCreatedAt: "2026-04-30T08:04:24.000Z", attemptCount: 2 }), null, false)).row;
  expect(final.reviewState).toBe("final");
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
});
test("mixed DUPLICATE and fraud labels keep FINAL restriction", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const reviewState = normalizeReviewState("completed", "RED", "FINAL", ["DUPLICATE", "FORGERY"]);
  expect(reviewState).toBe("final");
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const learned = (await fixture.service.applyReadback(known, applicant(), null, false)).row;
  const next = (await fixture.service.applyReadback(learned, applicant({ reviewState, reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL" }), null, false)).row;
  expect(next.reviewState).toBe("final");
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
});
test("unchanged pending reconciles advance the timestamp without a version or event", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const pending = applicant({ reviewState: "pending", reviewStatus: "pending" });
  fixture.setReadback(pending);
  const initial = (await fixture.service.applyReadback(row, pending, null, false)).row;
  const eventCount = fixture.store.events.length;
  fixture.setTime("2026-04-30T08:10:00.000Z");
  const first = await fixture.service.reconcile(initial);
  expect(first.stale).toBe(false);
  expect(first.row).toMatchObject({ reconciledAt: "2026-04-30T08:10:00.000Z", version: initial.version });
  fixture.setTime("2026-04-30T08:15:00.000Z");
  const second = await fixture.service.reconcile(first.row);
  expect(second.row).toMatchObject({ reconciledAt: "2026-04-30T08:15:00.000Z", version: initial.version });
  expect(fixture.store.events).toHaveLength(eventCount);
});
test("a timestamp-only reconcile CAS miss returns the original row without an event and records an attempt", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const pending = applicant({ reviewState: "pending", reviewStatus: "pending" });
  fixture.setReadback(pending);
  const initial = (await fixture.service.applyReadback(row, pending, null, false)).row;
  await fixture.store.recordConsent(initial, { version: "1", level: config.level, at });
  const eventCount = fixture.store.events.length;
  fixture.setTime("2026-04-30T08:10:00.000Z");
  expect(await fixture.service.reconcile(initial)).toEqual({ row: initial, stale: false });
  expect(fixture.store.events).toHaveLength(eventCount);
  expect((await fixture.store.active(customer, "sandbox"))?.reconciledAt).toBe(at);
  expect((await fixture.store.active(customer, "sandbox"))?.reconcileAttemptedAt).toBe("2026-04-30T08:10:00.000Z");
});
test("scheduled reconcile processes stale rows and reports failures without provider IDs", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  await fixture.service.applyReadback(known, applicant(), null, false, "session");
  fixture.setTime("2026-05-01T08:04:23.379Z");
  fixture.setReadback(applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN" }));
  expect(await fixture.service.reconcileStale()).toEqual({ processed: 1, failed: 0 });
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("scheduled reconcile skips removed rows but still checks unadopted active rows", async () => {
  const fixture = setup();
  const original = await fixture.reserve();
  const final = (await fixture.store.apply(original, { reviewState: "final", levelName: config.level }, { source: "webhook", configuredLevel: config.level }, at))!;
  const removed = (await fixture.store.apply(final, { lifecycle: "removed", reviewState: "not-submitted", applicantId: null }, { source: "webhook", configuredLevel: config.level }, at))!;
  const unadopted = await fixture.store.reserve({ customerId: "other-customer", env: "sandbox", externalUserId: `home-${"b".repeat(32)}`, level: config.level, consentVersion: "1", at });
  const lookups: string[] = [];
  fixture.provider.byExternalId = async (id) => { lookups.push(id); return null; };
  fixture.provider.get = async () => { throw new Error("removed row reached provider"); };
  fixture.setTime("2026-05-01T08:04:23.379Z");
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
  expect(await fixture.service.reconcileStale()).toEqual({ processed: 1, failed: 0 });
  expect(lookups).toEqual([unadopted.externalUserId]);
  expect(await fixture.store.active(customer, "sandbox")).toMatchObject({ id: removed.id, lifecycle: "removed", reconcileAttemptedAt: null });
  expect(await fixture.store.active("other-customer", "sandbox")).toMatchObject({ id: unadopted.id, reconcileAttemptedAt: "2026-05-01T08:04:23.379Z" });
});
test("scheduled reconcile never has more than five provider reads in flight", async () => {
  const fixture = setup();
  const ids = await reserveAdoptedRows(fixture.store, 7);
  const gate = deferred();
  const ready = deferred();
  let active = 0;
  let peak = 0;
  const reads: string[] = [];
  fixture.provider.get = async (id) => {
    reads.push(id);
    active++;
    peak = Math.max(peak, active);
    if (reads.length === 5) ready.release();
    await gate.promise;
    active--;
    return applicant({ id, externalUserId: ids[Number(id.split("-")[1])]! });
  };
  fixture.setTime("2026-05-01T08:04:23.379Z");
  const batch = fixture.service.reconcileStale(7);
  await ready.promise;
  expect(reads).toHaveLength(5);
  expect(peak).toBe(5);
  gate.release();
  expect(await batch).toEqual({ processed: 7, failed: 0 });
  expect(reads).toHaveLength(7);
  expect(peak).toBe(5);
});
test("scheduled reconcile leaves unstarted rows eligible after its dispatch deadline", async () => {
  const fixture = setup();
  const ids = await reserveAdoptedRows(fixture.store, 6);
  const gate = deferred();
  const ready = deferred();
  const reads: string[] = [];
  fixture.provider.get = async (id) => {
    reads.push(id);
    if (reads.length === 5) ready.release();
    await gate.promise;
    return applicant({ id, externalUserId: ids[Number(id.split("-")[1])]! });
  };
  fixture.setTime("2026-05-01T08:04:23.379Z");
  let nowMs = 1_000;
  const clock = spyOn(Date, "now").mockImplementation(() => nowMs);
  try {
    const batch = fixture.service.reconcileStale(6);
    await ready.promise;
    nowMs += 20_000;
    gate.release();
    expect(await batch).toEqual({ processed: 5, failed: 0 });
    expect(reads).toHaveLength(5);
    expect(await fixture.store.active("customer-5", "sandbox")).toMatchObject({ reconciledAt: null, reconcileAttemptedAt: null });
    expect(await fixture.service.reconcileStale(6)).toEqual({ processed: 1, failed: 0 });
    expect(reads).toEqual(["applicant-0", "applicant-1", "applicant-2", "applicant-3", "applicant-4", "applicant-5"]);
  } finally {
    clock.mockRestore();
  }
});
test("older attempt markers never roll back approval", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const learned = (await fixture.service.applyReadback(row, applicant(), null, false)).row;
  const recent = applicant({ reviewStatus: "completed", reviewState: "approved", reviewAnswer: "GREEN", attemptCount: 2, reviewCreatedAt: at });
  const approved = (await fixture.service.applyReadback(learned, recent, at, false)).row;
  expect((await fixture.service.applyReadback(approved, applicant({ attemptCount: 1, reviewCreatedAt: "2026-04-30T08:00:00.000Z" }), null, false)).stale).toBe(true);
  expect((await fixture.store.active(customer, "sandbox"))?.reviewState).toBe("approved");
  expect((await fixture.service.applyReadback(approved, applicant({ attemptCount: null, reviewCreatedAt: "2026-04-30T08:00:00.000Z" }), null, false)).stale).toBe(true);
  const missingCounts = (await fixture.service.applyReadback(approved, applicant({ ...recent, attemptCount: null, reviewCreatedAt: "2026-04-30T09:00:00.000Z" }), null, false)).row;
  expect((await fixture.service.applyReadback(missingCounts, applicant({ attemptCount: null, reviewCreatedAt: at }), null, false)).stale).toBe(true);
  expect((await fixture.service.applyReadback(missingCounts, null, null, false)).row.lifecycle).toBe("removed");
});
test("a markerless decision after a recorded review fails closed", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const retry = (await fixture.service.applyReadback(known, applicant({ reviewState: "retry", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "RETRY", attemptCount: 3, reviewId: "review-3", reviewCreatedAt: at }), null, false)).row;
  const staleGreen = await fixture.service.applyReadback(retry, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at }), at, false);
  expect(staleGreen.stale).toBe(true);
  expect((await fixture.store.active(customer, "sandbox"))?.reviewState).toBe("retry");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  const staleFinal = await fixture.service.applyReadback(retry, applicant({ reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL" }), null, false, "reconcile");
  expect(staleFinal.stale).toBe(true);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  expect(fixture.store.approvalEvents).toEqual([]);
});
test("a markerless approved readback retains review markers so an older pending replay is stale", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const earlierPending = applicant({ reviewState: "pending", reviewStatus: "pending", attemptCount: 2, reviewId: "review-2", reviewCreatedAt: "2026-04-30T08:00:00.000Z" });
  const pending = (await fixture.service.applyReadback(row, earlierPending, null, false)).row;
  const recent = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, attemptCount: 3, reviewId: "review-3", reviewCreatedAt: at });
  const approved = (await fixture.service.applyReadback(pending, recent, null, false)).row;
  const markerless = (await fixture.service.applyReadback(approved, { ...recent, attemptCount: null, reviewId: null, reviewCreatedAt: null }, null, false)).row;
  expect(markerless).toMatchObject({ reviewState: "approved", attemptCount: 3, reviewId: "review-3", reviewCreatedAt: at });
  const replay = await fixture.service.applyReadback(markerless, earlierPending, null, false);
  expect(replay.stale).toBe(true);
  expect(replay.row.reviewState).toBe("approved");
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
});
test("final rejection restricts even after deletion; duplicate does not", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const learned = (await fixture.service.applyReadback(known, applicant(), null, false)).row;
  const final = (await fixture.service.applyReadback(learned, applicant({ reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL" }), null, false)).row;
  await fixture.service.applyReadback(final, null, null, false);
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("rejected");
  await expect(fixture.service.startIdentityVerificationSession(customer, { consent: true })).rejects.toBeInstanceOf(IdentityConflict);
  const other = setup();
  const otherRow = await other.reserve();
  const otherKnown = (await other.store.apply(otherRow, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const otherLearned = (await other.service.applyReadback(otherKnown, applicant(), null, false)).row;
  await other.service.applyReadback(otherLearned, applicant({ reviewState: "duplicate", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL" }), null, false);
  expect((await other.service.getIdentityVerificationStatus(customer)).state).toBe("duplicate-person");
  expect(await other.store.restriction(customer, "sandbox")).toBe(false);
});
test("deactivation revokes approval and activation restores it", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const learned = (await fixture.service.applyReadback(known, applicant(), null, false)).row;
  const approved = (await fixture.service.applyReadback(learned, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN" }), null, false)).row;
  const deactivated = (await fixture.service.applyReadback(approved, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", deleted: true }), null, false)).row;
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(false);
  expect(await fixture.service.getIdentityVerificationStatus(customer)).toMatchObject({ state: "blocked", category: "verification-rejected", action: "contact-support", consentRequired: false, retryReason: null });
  let creates = 0;
  fixture.provider.create = async () => { creates++; return applicant(); };
  await expect(fixture.service.startIdentityVerificationSession(customer, { consent: true })).rejects.toBeInstanceOf(IdentityConflict);
  await expect(fixture.service.createIdentityVerificationLink(customer)).rejects.toBeInstanceOf(IdentityConflict);
  expect(creates).toBe(0);
  expect((await fixture.store.active(customer, "sandbox"))?.id).toBe(row.id);
  expect((await fixture.store.active(customer, "sandbox"))?.externalUserId).toBe(externalUserId);
  await fixture.service.applyReadback(deactivated, applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN" }), null, false);
  expect((await fixture.service.getIdentityApproval(customer)).approved).toBe(true);
  expect((await fixture.store.active(customer, "sandbox"))?.id).toBe(row.id);
});
test("on-read reconcile repairs missed approval; provider outage preserves stored status", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  await fixture.service.applyReadback(known, applicant(), null, false, "session");
  fixture.setTime("2026-04-30T08:09:23.379Z");
  fixture.setReadback(applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN" }));
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("verified");
  fixture.provider.get = async () => { throw new Error("outage"); };
  fixture.setTime("2026-05-02T08:04:23.379Z");
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("verified");
});
test("404 during reconcile preserves adopted and unadopted rows and logs only their row ids", async () => {
  const fixture = setup();
  const lines: string[] = [];
  setObservabilityLogWriterForTests((line) => { lines.push(line); });
  const unadopted = await fixture.reserve();
  fixture.setReadback(null);
  fixture.provider.byExternalId = async () => null;
  expect((await fixture.service.reconcile(unadopted)).row).toEqual(unadopted);
  expect((await fixture.store.active(customer, "sandbox"))?.lifecycle).toBe("active");
  const adopted = (await fixture.store.apply(unadopted, { applicantId: "applicant1" }, { source: "session", configuredLevel: config.level }, at))!;
  fixture.setTime("2026-05-01T08:04:23.379Z");
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("in-progress");
  expect((await fixture.store.active(customer, "sandbox"))?.applicantId).toBe("applicant1");
  expect((await fixture.store.active(customer, "sandbox"))?.reconcileAttemptedAt).toBe("2026-05-01T08:04:23.379Z");
  expect(lines.filter((line) => line.includes("IDENTITY_RECONCILE_MISSING"))).toHaveLength(2);
  expect(lines.join(" ")).toContain(adopted.id);
  for (const forbidden of [externalUserId, "applicant1"]) expect(lines.join(" ")).not.toContain(forbidden);
});
test("released final rows reconcile inline and in scheduled batches without reinstating restrictions", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const finalReadback = applicant({ reviewState: "final", reviewStatus: "completed", reviewAnswer: "RED", rejectType: "FINAL" });
  const final = (await fixture.service.applyReadback(known, finalReadback, null, false)).row;
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(true);
  const restrictions = fixture.store as unknown as { restrictions: Map<string, { id: string }> };
  const restrictionId = restrictions.restrictions.get(`${customer}:sandbox`)!.id;
  fixture.setTime("2026-04-30T08:10:00.000Z");
  expect(await fixture.service.reconcileStale()).toEqual({ processed: 0, failed: 0 });
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("rejected");
  expect(await fixture.store.releaseRestriction(restrictionId, "operator", at, config.level)).toBe(true);
  fixture.setReadback(finalReadback);
  const before = fixture.store.events.length;
  expect(await fixture.service.reconcileStale()).toEqual({ processed: 1, failed: 0 });
  expect((await fixture.store.active(customer, "sandbox"))?.version).toBe(final.version);
  expect(fixture.store.events).toHaveLength(before);
  expect(await fixture.store.restriction(customer, "sandbox")).toBe(false);
  fixture.setTime("2026-04-30T08:15:00.000Z");
  fixture.setReadback(applicant());
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("in-progress");
  expect((await fixture.service.startIdentityVerificationSession(customer, {})).status.state).toBe("in-progress");
});
test("failed reconciliation backs off so the next immediate batch reaches untouched rows", async () => {
  const fixture = setup();
  const ids = Array.from({ length: 4 }, (_, index) => `home-${String(index).padStart(32, "a")}`);
  for (const [index, externalId] of ids.entries()) {
    const row = await fixture.store.reserve({ customerId: `customer-${index}`, env: "sandbox", externalUserId: externalId, level: config.level, consentVersion: "1", at });
    await fixture.store.apply(row, { applicantId: `applicant-${index}` }, { source: "session", configuredLevel: config.level }, at);
  }
  const reads: string[] = [];
  fixture.provider.get = async (id) => {
    reads.push(id);
    const index = Number(id.split("-")[1]);
    if (index < 2) throw new Error("provider unavailable");
    return applicant({ id, externalUserId: ids[index]! });
  };
  fixture.setTime("2026-05-01T08:04:23.379Z");
  expect(await fixture.service.reconcileStale(2)).toEqual({ processed: 2, failed: 2 });
  expect(await fixture.service.reconcileStale(2)).toEqual({ processed: 2, failed: 0 });
  expect(reads).toEqual(["applicant-0", "applicant-1", "applicant-2", "applicant-3"]);
});
test("concurrent stale status reads claim one provider readback", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1" }, { source: "session", configuredLevel: config.level }, at);
  const gate = deferred();
  let reads = 0;
  fixture.provider.get = async () => { reads++; await gate.promise; return applicant(); };
  const results = Array.from({ length: 5 }, () => fixture.service.getIdentityVerificationStatus(customer));
  const scheduled = fixture.service.reconcileStale();
  gate.release();
  expect((await Promise.all(results)).map((status) => status.state)).toEqual(Array(5).fill("in-progress"));
  expect((await scheduled).failed).toBe(0);
  expect(reads).toBe(1);
});
test("failed inline reconciliation is not retried on the next immediate status read", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  await fixture.store.apply(row, { applicantId: "applicant1" }, { source: "session", configuredLevel: config.level }, at);
  let reads = 0;
  fixture.provider.get = async () => { reads++; throw new Error("provider unavailable"); };
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("in-progress");
  expect((await fixture.service.getIdentityVerificationStatus(customer)).state).toBe("in-progress");
  expect(reads).toBe(1);
  expect((await fixture.store.active(customer, "sandbox"))?.reconcileAttemptedAt).toBe(at);
});
test("sandbox row cannot approve production and consent is re-asked after version/level changes", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  expect((await fixture.service.getIdentityVerificationStatus(customer)).consentRequired).toBe(false);
  const changed = await fixture.store.recordConsent(row, { version: "old", level: "other", at });
  expect(changed).not.toBeNull();
  expect((await fixture.service.getIdentityVerificationStatus(customer)).consentRequired).toBe(true);
  await expect(fixture.service.startIdentityVerificationSession(customer, {})).rejects.toBeInstanceOf(IdentityConflict);
  const production = new IdentityService({ store: fixture.store, config: { ...config, providerEnv: "production" }, provider: fixture.provider, now: () => at, randomId: () => externalUserId });
  expect((await production.getIdentityApproval(customer)).approved).toBe(false);
});
test("session and link requests share a customer limit across service instances and expire after ten minutes", async () => {
  const fixture = setup();
  const second = fixture.anotherService();
  for (let i = 0; i < 10; i++) await expect((i % 2 ? second : fixture.service).startIdentityVerificationSession(customer, {})).rejects.toBeInstanceOf(IdentityConflict);
  try {
    await second.createIdentityVerificationLink(customer);
    throw new Error("expected rate limit");
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityRateLimited);
    expect((error as IdentityRateLimited).retryAfter).toBe(600);
  }
  fixture.setTime("2026-04-30T08:14:23.379Z");
  await expect(second.startIdentityVerificationSession(customer, {})).rejects.toBeInstanceOf(IdentityConflict);
});
test("configuration fails closed on environment and invalid rotation keys", () => {
  const env = { SUMSUB_APP_TOKEN: config.token, SUMSUB_SECRET_KEY: config.requestKey, SUMSUB_WEBHOOK_SECRET: config.digestKey, SUMSUB_LEVEL_NAME: config.level, HOME_SUPPORT_URL: config.supportUrl };
  expect(readIdentityConfig(env)?.providerEnv).toBe("sandbox");
  expect(readIdentityConfig({ ...env, SUMSUB_APP_TOKEN: "prd:synthetic-token" })?.providerEnv).toBe("production");
  expect(readIdentityConfig({ ...env, VERCEL_ENV: "production" })).toBeNull();
  expect(readIdentityConfig({ ...env, SUMSUB_APP_TOKEN: "synthetic-token" })).toBeNull();
  expect(readIdentityConfig({ ...env, SUMSUB_SECRET_KEY_PREVIOUS: "short" })).toBeNull();
});
test("a configured-level change revokes an approval on the next readback and re-approves after the move", async () => {
  const fixture = setup();
  const row = await fixture.reserve();
  const green = applicant({ reviewState: "approved", reviewStatus: "completed", reviewAnswer: "GREEN", reviewDate: at, reviewCreatedAt: at, attemptCount: 1 });
  const known = (await fixture.store.apply(row, { applicantId: "applicant1", levelName: config.level }, { source: "session", configuredLevel: config.level }, at))!;
  const approved = (await fixture.service.applyReadback(known, green, at, false)).row;
  expect(fixture.store.approvalEvents).toEqual([{ rowId: row.id, approved: true }]);
  const moved = new IdentityService({ store: fixture.store, config: { ...config, level: "next-level" }, provider: fixture.provider, now: () => at, randomId: () => externalUserId });
  expect((await moved.getIdentityApproval(customer)).approved).toBe(false);
  const revoked = (await moved.applyReadback(approved, green, null, false, "reconcile")).row;
  expect(fixture.store.approvalEvents).toEqual([{ rowId: row.id, approved: true }, { rowId: row.id, approved: false }]);
  await moved.applyReadback(revoked, green, null, false, "reconcile");
  expect(fixture.store.approvalEvents).toHaveLength(2);
  const later = { ...green, levelName: "next-level", reviewCreatedAt: "2026-04-30T09:00:00.000Z", attemptCount: 2 };
  const pending = (await moved.applyReadback((await fixture.store.active(customer, "sandbox"))!, { ...later, reviewState: "pending", reviewStatus: "pending", reviewAnswer: null, reviewDate: null }, null, false, "reconcile")).row;
  await moved.applyReadback(pending, later, null, false, "reconcile");
  expect((await moved.getIdentityApproval(customer)).approved).toBe(true);
  expect(fixture.store.approvalEvents.at(-1)).toEqual({ rowId: row.id, approved: true });
});
