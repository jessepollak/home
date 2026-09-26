import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { readBoundedWebhookBody } from "@/server/funding/core/webhook-body";
import { emitServerEvent } from "@/server/observability/log";
import { createRuntimeIdentityStore, isOlderReview, type IdentityStore } from "./store";
import { applicantIdPattern, readIdentityConfig, SumsubClient, type Applicant, type IdentityConfig } from "./sumsub";
import { getIdentityService, type IdentityService } from "./service";

export function verifySumsubDigest(body: Uint8Array, digest: string | null, alg: string | null, key: string): boolean {
  const hash = alg === null || alg === "HMAC_SHA256_HEX" ? "sha256" : alg === "HMAC_SHA512_HEX" ? "sha512" : null;
  if (!hash || !digest || !new RegExp(`^[0-9a-fA-F]{${hash === "sha256" ? 64 : 128}}$`).test(digest)) return false;
  const received = Buffer.from(digest, "hex");
  const expected = createHmac(hash, key).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parseEvent(raw: Uint8Array): { type: string; applicantId: string; externalUserId: string; eventAt: string | null; levelName: string | null } | null {
  try {
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const event = data as Record<string, unknown>;
    if (typeof event.type !== "string" || !/^[A-Za-z]{1,64}$/.test(event.type) || typeof event.applicantId !== "string" || !applicantIdPattern.test(event.applicantId) || typeof event.externalUserId !== "string" || !/^home-[0-9a-f]{32}$/.test(event.externalUserId)) return null;
    const match = typeof event.createdAtMs === "string" ? /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})$/.exec(event.createdAtMs) : null;
    const candidate = match ? new Date(`${match[1]}T${match[2]}Z`) : null;
    const eventAt = candidate && !Number.isNaN(candidate.valueOf()) && candidate.toISOString() === `${match![1]}T${match![2]}Z` ? candidate.toISOString() : null;
    return { type: event.type, applicantId: event.applicantId, externalUserId: event.externalUserId, eventAt, levelName: typeof event.levelName === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(event.levelName) ? event.levelName : null };
  } catch { return null; }
}

const submitted = ["pending", "prechecked", "queued", "onHold", "awaitingService", "awaitingUser", "completed"];
const transitionReadback: Readonly<Record<string, readonly string[]>> = {
  applicantPending: submitted,
  applicantPrechecked: submitted,
  applicantAwaitingService: submitted,
  applicantAwaitingUser: submitted,
  applicantOnHold: ["onHold", "completed"],
  applicantReviewed: ["completed"],
};

function readbackLags(type: string, applicant: Applicant | null, levelName: string | null): boolean {
  if (type === "applicantDeleted") return applicant !== null;
  if (type === "applicantDeactivated") return applicant !== null && !applicant.deleted;
  if (type === "applicantActivated") return applicant === null || applicant.deleted;
  if (!applicant || applicant.deleted) return false;
  if (type === "applicantLevelChanged") return levelName !== null && applicant.levelName !== levelName;
  if (type === "applicantReset") return applicant.reviewStatus === "completed";
  const expected = transitionReadback[type];
  return expected !== undefined && !expected.includes(applicant.reviewStatus ?? "");
}

export async function handleSumsubWebhook(request: Request, deps?: { config: IdentityConfig | null; store: IdentityStore; provider: Pick<SumsubClient, "get">; service: IdentityService }): Promise<Response> {
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return Response.json({ ok: false }, { status: 413 });
  const config = deps ? deps.config : readIdentityConfig();
  if (!config) return Response.json({ ok: false }, { status: 503 });
  const digest = request.headers.get("x-payload-digest");
  const alg = request.headers.get("x-payload-digest-alg");
  const validCurrent = verifySumsubDigest(raw, digest, alg, config.digestKey);
  const validPrevious = config.previousDigestKey ? verifySumsubDigest(raw, digest, alg, config.previousDigestKey) : false;
  if (!validCurrent && !validPrevious) return Response.json({ ok: false }, { status: 401 });
  const event = parseEvent(raw);
  if (!event) return Response.json({ ok: false }, { status: 400 });
  const code = `IDENTITY_${event.type.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
  let rowId: string | undefined;
  const log = (outcome: "accepted" | "ignored" | "unavailable") => emitServerEvent("identity-webhook", { route: "/api/identity/webhooks/sumsub", code, outcome, rowId });
  if (event.type === "applicantLevelChanged" && event.levelName === null) { log("ignored"); return Response.json({ ok: false }, { status: 400 }); }
  try {
    const store = deps?.store ?? createRuntimeIdentityStore();
    if (!store) { log("unavailable"); return Response.json({ ok: false }, { status: 503 }); }
    const row = await store.byExternalId(event.externalUserId);
    if (!row || row.providerEnv !== config.providerEnv || row.supersededAt || (row.applicantId && row.applicantId !== event.applicantId)) { log("ignored"); return Response.json({ ok: true }); }
    rowId = row.id;
    const provider = deps?.provider ?? new SumsubClient(config);
    const applicant = await provider.get(event.applicantId);
    if (applicant && (applicant.id !== event.applicantId || applicant.externalUserId !== row.externalUserId)) { log("ignored"); return Response.json({ ok: true }); }
    if (!applicant && event.type !== "applicantDeleted") { log("unavailable"); return Response.json({ ok: false }, { status: 503 }); }
    const service = deps?.service ?? getIdentityService();
    const newerAttempt = !!applicant?.reviewCreatedAt && !!event.eventAt && applicant.reviewCreatedAt > event.eventAt;
    const staleReadback = !!applicant && isOlderReview(applicant, row);
    const lags = readbackLags(event.type, applicant, event.levelName) && !newerAttempt && !staleReadback;
    if (lags && event.type !== "applicantLevelChanged" && !(event.type === "applicantDeleted" && applicant?.deleted)) { log("unavailable"); return Response.json({ ok: false }, { status: 503 }); }
    const levelChanged = event.type === "applicantLevelChanged" && applicant?.levelName === config.level && !(event.levelName === config.level && newerAttempt);
    const applied = await service.applyReadback(row, applicant, event.type === "applicantReviewed" ? event.eventAt : null, event.type === "applicantReset", "webhook", levelChanged);
    if (lags) { log("unavailable"); return Response.json({ ok: false }, { status: 503 }); }
    log(applied.stale ? "ignored" : "accepted");
    return Response.json({ ok: true });
  } catch { log("unavailable"); return Response.json({ ok: false }, { status: 503 }); }
}
