import "server-only";

import { createHmac } from "node:crypto";
import { IDENTITY_HOSTED_LINK_TTL_SECONDS, isSupportUrl } from "@/shared/identity/contract";
import type { IdentityRetryReason } from "@/shared/identity/contract";

export type ProviderEnv = "sandbox" | "production";
export type IdentityConfig = { token: string; requestKey: string; previousRequestKey?: string; digestKey: string; previousDigestKey?: string; providerEnv: ProviderEnv; level: string; supportUrl: string };
export type Applicant = { id: string; externalUserId: string; reviewStatus: string | null; reviewDate: string | null; reviewCreatedAt: string | null; attemptCount: number | null; reviewId: string | null; levelName: string | null; reviewAnswer: string | null; rejectType: string | null; retryReason: IdentityRetryReason | null; reviewState: "not-submitted" | "pending" | "manual-review" | "approved" | "retry" | "final" | "duplicate"; deleted: boolean };
export const applicantIdPattern = /^[A-Za-z0-9]{1,64}$/;
const externalIdPattern = /^home-[0-9a-f]{32}$/;

export function readIdentityConfig(env: Readonly<Record<string, string | undefined>> = process.env): IdentityConfig | null {
  const token = env.SUMSUB_APP_TOKEN?.trim();
  const requestKey = env["SUMSUB_" + "SECRET_KEY"]?.trim();
  const digestKey = env["SUMSUB_" + "WEBHOOK_SECRET"]?.trim();
  const level = env.SUMSUB_LEVEL_NAME?.trim();
  const providerEnv = token?.startsWith("sbx:") ? "sandbox" : token?.startsWith("prd:") ? "production" : null;
  const previousRequestKey = env["SUMSUB_" + "SECRET_KEY_PREVIOUS"]?.trim();
  const previousDigestKey = env["SUMSUB_" + "WEBHOOK_SECRET_PREVIOUS"]?.trim();
  if (!token || !/^[\x21-\x7e]{8,256}$/.test(token) || !providerEnv || (providerEnv === "sandbox" && env.VERCEL_ENV === "production") || !requestKey || !/^[\x21-\x7e]{16,512}$/.test(requestKey) || !digestKey || !/^[\x21-\x7e]{16,512}$/.test(digestKey) || !level || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(level)) return null;
  if ((env["SUMSUB_" + "SECRET_KEY_PREVIOUS"] !== undefined && (!previousRequestKey || !/^[\x21-\x7e]{16,512}$/.test(previousRequestKey))) || (env["SUMSUB_" + "WEBHOOK_SECRET_PREVIOUS"] !== undefined && (!previousDigestKey || !/^[\x21-\x7e]{16,512}$/.test(previousDigestKey)))) return null;
  const supportUrl = readIdentitySupportUrl(env);
  if (!supportUrl) return null;
  return { token, requestKey, digestKey, ...(previousRequestKey ? { previousRequestKey } : {}), ...(previousDigestKey ? { previousDigestKey } : {}), providerEnv, level, supportUrl };
}

export function readIdentitySupportUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = env.HOME_SUPPORT_URL?.trim();
  return isSupportUrl(raw) ? raw : null;
}

export function signSumsubRequest(key: string, ts: number, method: string, path: string, body: string): string {
  return createHmac("sha256", key).update(`${ts}${method}${path}${body}`).digest("hex");
}

export class SumsubClient {
  constructor(private readonly config: IdentityConfig, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  private async request(method: "GET" | "POST", path: string, body?: Record<string, unknown>, emptyResponse = false): Promise<unknown | null> {
    const raw = body ? JSON.stringify(body) : "";
    const ts = Math.floor(this.now() / 1000);
    const send = (key: string) => this.fetcher(`https://api.sumsub.com${path}`, {
      method,
      headers: { "X-App-Token": this.config.token, "X-App-Access-Ts": String(ts), "X-App-Access-Sig": signSumsubRequest(key, ts, method, path, raw), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: raw } : {}), signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    let response = await send(this.config.requestKey);
    if (response.status === 401 && this.config.previousRequestKey) {
      await response.body?.cancel().catch(() => undefined);
      response = await send(this.config.previousRequestKey);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("sumsub-unavailable");
    if (Number(response.headers.get("content-length")) > 65_536) throw new Error("sumsub-response-too-large");
    if (emptyResponse) { await response.body?.cancel().catch(() => undefined); return {}; }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("sumsub-empty-response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) throw new Error("sumsub-response-too-large");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  }
  async create(externalId: string): Promise<Applicant> {
    if (!externalIdPattern.test(externalId)) throw new Error("invalid-external-id");
    const value = await this.request("POST", `/resources/applicants?levelName=${encodeURIComponent(this.config.level)}`, { externalUserId: externalId });
    const applicant = parseApplicant(value);
    if (!applicant || applicant.externalUserId !== externalId) throw new Error("sumsub-invalid-applicant");
    return applicant;
  }
  async moveToLevel(id: string): Promise<void> {
    if (!applicantIdPattern.test(id)) throw new Error("invalid-applicant-id");
    const value = await this.request("POST", `/resources/applicants/${id}/moveToLevel?name=${encodeURIComponent(this.config.level)}`, undefined, true);
    if (value === null) throw new Error("sumsub-applicant-missing");
  }
  async get(id: string): Promise<Applicant | null> {
    if (!applicantIdPattern.test(id)) throw new Error("invalid-applicant-id");
    const value = await this.request("GET", `/resources/applicants/${id}/one`);
    if (value === null) return null;
    const applicant = parseApplicant(value);
    if (!applicant) throw new Error("sumsub-invalid-applicant");
    return applicant;
  }
  async byExternalId(id: string): Promise<Applicant | null> {
    if (!externalIdPattern.test(id)) throw new Error("invalid-external-id");
    const value = await this.request("GET", `/resources/applicants/-;externalUserId=${id}/one`);
    if (value === null) return null;
    const applicant = parseApplicant(value);
    if (!applicant) throw new Error("sumsub-invalid-applicant");
    return applicant;
  }
  async token(id: string): Promise<string> {
    if (!externalIdPattern.test(id)) throw new Error("invalid-external-id");
    const value = await this.request("POST", "/resources/accessTokens/sdk", { userId: id, levelName: this.config.level, ttlInSecs: 600 });
    if (!object(value) || typeof value.token !== "string" || !value.token || value.token.length > 4096) throw new Error("sumsub-invalid-token");
    return value.token;
  }
  async link(id: string): Promise<string> {
    if (!externalIdPattern.test(id)) throw new Error("invalid-external-id");
    const value = await this.request("POST", "/resources/sdkIntegrations/levels/-/websdkLink", { levelName: this.config.level, userId: id, ttlInSecs: IDENTITY_HOSTED_LINK_TTL_SECONDS });
    if (!object(value) || typeof value.url !== "string" || value.url.length > 4096) throw new Error("sumsub-invalid-link");
    const url = new URL(value.url);
    if (url.protocol !== "https:" || (url.hostname !== "sumsub.com" && !url.hostname.endsWith(".sumsub.com")) || url.username || url.password) throw new Error("sumsub-invalid-link");
    return value.url;
  }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parseReviewDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, date, time, fraction, zone, sign, hours, minutes] = match;
  if (zone !== "Z" && (Number(hours) > 23 || Number(minutes) > 59)) return null;
  const local = new Date(`${date}T${time}${fraction ?? ""}Z`);
  if (Number.isNaN(local.valueOf()) || local.toISOString().slice(0, 19) !== `${date}T${time}`) return null;
  const offset = zone === "Z" ? "Z" : `${sign}${hours}:${minutes}`;
  const parsed = new Date(`${date}T${time}${fraction ?? ""}${offset}`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}
function parseApplicant(value: unknown): Applicant | null {
  if (!object(value) || typeof value.id !== "string" || !applicantIdPattern.test(value.id) || typeof value.externalUserId !== "string" || !externalIdPattern.test(value.externalUserId)) return null;
  const review = object(value.review) ? value.review : {};
  const result = object(review.reviewResult) ? review.reviewResult : {};
  const reviewStatus = typeof review.reviewStatus === "string" ? review.reviewStatus : null;
  const reviewAnswer = typeof result.reviewAnswer === "string" ? result.reviewAnswer : null;
  const rejectType = typeof result.reviewRejectType === "string" ? result.reviewRejectType : null;
  return { id: value.id, externalUserId: value.externalUserId, reviewStatus, reviewDate: parseReviewDate(review.reviewDate), reviewCreatedAt: parseReviewDate(review.createDate), attemptCount: Number.isInteger(review.attemptCnt) && Number(review.attemptCnt) >= 0 ? Number(review.attemptCnt) : null, reviewId: typeof review.reviewId === "string" && /^[A-Za-z0-9]{1,64}$/.test(review.reviewId) ? review.reviewId : null, levelName: typeof review.levelName === "string" ? review.levelName : null, reviewAnswer, rejectType, retryReason: rejectType === "RETRY" ? mapIdentityRetryReason(result.rejectLabels) : null, reviewState: normalizeReviewState(reviewStatus, reviewAnswer, rejectType, result.rejectLabels), deleted: value.deleted === true || value.deleted === "true" };
}
const labels: ReadonlyArray<readonly [IdentityRetryReason, ReadonlyArray<string>]> = [
  ["photo-quality", ["UNSATISFACTORY_PHOTOS", "SCREENSHOTS", "BLACK_AND_WHITE", "DOCUMENT_DAMAGED"]],
  ["document-incomplete", ["DOCUMENT_PAGE_MISSING", "INCOMPLETE_DOCUMENT", "FRONT_SIDE_MISSING", "BACK_SIDE_MISSING", "SAME_SIDES", "UNFILLED_ID", "DOCUMENT_MISSING"]],
  ["document-expired", ["EXPIRATION_DATE"]],
  ["document-unsupported", ["ID_INVALID", "WRONG_DOCUMENT_TYPE"]],
  ["selfie", ["BAD_SELFIE", "BAD_VIDEO_SELFIE"]],
  ["proof-of-address", ["BAD_PROOF_OF_ADDRESS", "WRONG_ADDRESS"]],
  ["proof-of-identity", ["BAD_PROOF_OF_IDENTITY"]],
];
export function mapIdentityRetryReason(value: unknown): IdentityRetryReason | null {
  if (!Array.isArray(value)) return null;
  for (const [reason, accepted] of labels) {
    if (value.some((label) => typeof label === "string" && accepted.includes(label))) return reason;
  }
  return null;
}
export function normalizeReviewState(status: string | null, answer: string | null, rejectType: string | null, labels: unknown): Applicant["reviewState"] {
  if ((status === null || status === "init" || status === "awaitingUser") && answer === null && rejectType === null) return "not-submitted";
  if (["pending", "queued", "prechecked", "awaitingService"].includes(status ?? "") && answer === null && rejectType === null) return "pending";
  if (status === "onHold" && answer === null && rejectType === null) return "manual-review";
  if (status === "completed" && answer === "GREEN" && rejectType === null) return "approved";
  if (status === "completed" && answer === "RED" && Array.isArray(labels) && labels.length > 0 && labels.every((label) => label === "DUPLICATE")) return "duplicate";
  if (status === "completed" && answer === "RED" && rejectType === "RETRY") return "retry";
  if (status === "completed" && answer === "RED" && rejectType === "FINAL") return "final";
  return "pending";
}
