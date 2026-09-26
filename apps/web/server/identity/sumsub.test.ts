import { expect, test } from "bun:test";
import { mapIdentityRetryReason, normalizeReviewState, signSumsubRequest, SumsubClient, type IdentityConfig } from "./sumsub";

const config: IdentityConfig = { token: "synthetic-token-value", requestKey: "synthetic-request-key-000", digestKey: "synthetic-digest-key-000", providerEnv: "sandbox", level: "home-level", supportUrl: "https://support.example.com" };
const id = `home-${"a".repeat(32)}`;
const client = (value: unknown, status = 200) => new SumsubClient(config, (async () => Response.json(value, { status })) as unknown as typeof fetch);

test("malformed provider readback fails closed instead of deleting an applicant", async () => {
  await expect(client({ unexpected: true }).get("applicant1")).rejects.toThrow("sumsub-invalid-applicant");
  expect(await client({ error: "not found" }, 404).get("applicant1")).toBeNull();
  await expect(client({ id: "../escape", externalUserId: id }).get("applicant1")).rejects.toThrow("sumsub-invalid-applicant");
  await expect(client({ id: "applicant1", externalUserId: "another-account" }).get("applicant1")).rejects.toThrow("sumsub-invalid-applicant");
  await expect(client({}).get("../escape")).rejects.toThrow("invalid-applicant-id");
});

test("review dates normalize supported Sumsub timestamps and ignore invalid values", async () => {
  for (const [input, expected] of [
    ["2020-06-24 05:12:58+0000", "2020-06-24T05:12:58.000Z"],
    ["2020-06-24T05:12:58.123+02:30", "2020-06-24T02:42:58.123Z"],
    ["2020-06-24 05:12:58.5-0130", "2020-06-24T06:42:58.500Z"],
    ["2020-06-24T05:12:58Z", "2020-06-24T05:12:58.000Z"],
    ["2020-02-30 05:12:58+0000", null],
    ["2020-06-24 25:12:58+0000", null],
    ["2020-06-24 05:12:58+2460", null],
    ["not-a-date", null],
    [null, null],
  ] as const) {
    const applicant = await client({ id: "applicant1", externalUserId: id, review: { reviewDate: input } }).get("applicant1");
    expect(applicant?.reviewDate).toBe(expected);
  }
});

test("moveToLevel signs the exact POST query without a body and fails on missing applicant", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! });
    return new Response(null, { status: 204 });
  };
  const levelConfig = { ...config, level: "Home Plus 2" };
  const sumsub = new SumsubClient(levelConfig, fetcher as typeof fetch, () => 1700000000000);
  await sumsub.moveToLevel("applicant1");
  const path = "/resources/applicants/applicant1/moveToLevel?name=Home%20Plus%202";
  expect(calls[0]?.url).toBe(`https://api.sumsub.com${path}`);
  expect(calls[0]?.init.method).toBe("POST");
  expect(calls[0]?.init.body).toBeUndefined();
  expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBeNull();
  expect(new Headers(calls[0]?.init.headers).get("X-App-Access-Sig")).toBe(signSumsubRequest(config.requestKey, 1700000000, "POST", path, ""));
  await expect(sumsub.moveToLevel("../escape")).rejects.toThrow("invalid-applicant-id");
  expect(calls).toHaveLength(1);
  await expect(client({ error: "not found" }, 404).moveToLevel("applicant1")).rejects.toThrow("sumsub-applicant-missing");
  await expect(client({ error: "failure" }, 503).moveToLevel("applicant1")).rejects.toThrow("sumsub-unavailable");
});

test("hosted links accept only HTTPS Sumsub hosts", async () => {
  expect(await client({ url: "https://in.sumsub.com/verification" }).link(id)).toBe("https://in.sumsub.com/verification");
  for (const url of ["http://sumsub.com/link", "https://sumsub.com.evil.test/link", "https://other.test/link", "https://user@sumsub.com/link"]) await expect(client({ url }).link(id)).rejects.toThrow("sumsub-invalid-link");
});

test("hosted links and SDK tokens post the external id as the documented userId body field", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! });
    return Response.json({ url: "https://in.sumsub.com/verification", token: "synthetic-token" });
  };
  const sumsub = new SumsubClient(config, fetcher as typeof fetch, () => 1700000000000);
  expect(await sumsub.link(id)).toBe("https://in.sumsub.com/verification");
  const linkPath = "/resources/sdkIntegrations/levels/-/websdkLink";
  const linkBody = JSON.stringify({ levelName: "home-level", userId: id, ttlInSecs: 1800 });
  expect(calls[0]?.url).toBe(`https://api.sumsub.com${linkPath}`);
  expect(calls[0]?.init.method).toBe("POST");
  expect(calls[0]?.init.body).toBe(linkBody);
  expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
  expect(new Headers(calls[0]?.init.headers).get("X-App-Access-Sig")).toBe(signSumsubRequest(config.requestKey, 1700000000, "POST", linkPath, linkBody));
  expect(await sumsub.token(id)).toBe("synthetic-token");
  const tokenPath = "/resources/accessTokens/sdk";
  expect(calls[1]?.url).toBe(`https://api.sumsub.com${tokenPath}`);
  expect(calls[1]?.init.body).toBe(JSON.stringify({ userId: id, levelName: "home-level", ttlInSecs: 600 }));
});

test("401 retries once with previous signing key", async () => {
  const signatures: string[] = [];
  const rotated = { ...config, previousRequestKey: "previous-synthetic-request-key" };
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    signatures.push(new Headers(init?.headers).get("X-App-Access-Sig")!);
    return signatures.length === 1 ? Response.json({}, { status: 401 }) : Response.json({ id: "applicant1", externalUserId: id });
  };
  await new SumsubClient(rotated, fetcher as typeof fetch, () => 1700000000000).get("applicant1");
  const path = "/resources/applicants/applicant1/one";
  expect(signatures).toEqual([signSumsubRequest(config.requestKey, 1700000000, "GET", path, ""), signSumsubRequest(rotated.previousRequestKey, 1700000000, "GET", path, "")]);
});

test("retry reason allowlist respects category priority and never exposes risk labels", () => {
  expect(mapIdentityRetryReason(["BAD_SELFIE", "UNSATISFACTORY_PHOTOS"])).toBe("photo-quality");
  expect(mapIdentityRetryReason(["DOCUMENT_PAGE_MISSING"])).toBe("document-incomplete");
  expect(mapIdentityRetryReason(["EXPIRATION_DATE"])).toBe("document-expired");
  expect(mapIdentityRetryReason(["WRONG_DOCUMENT_TYPE"])).toBe("document-unsupported");
  expect(mapIdentityRetryReason(["BAD_VIDEO_SELFIE"])).toBe("selfie");
  expect(mapIdentityRetryReason(["WRONG_ADDRESS"])).toBe("proof-of-address");
  expect(mapIdentityRetryReason(["BAD_PROOF_OF_IDENTITY"])).toBe("proof-of-identity");
  for (const label of ["FORGERY", "DUPLICATE", "SANCTIONS", "FRAUDULENT_PATTERNS"]) expect(mapIdentityRetryReason([label])).toBeNull();
});

test("attempt markers, duplicate and deactivation normalize without storing labels", async () => {
  const sumsub = client({ id: "applicant1", externalUserId: id, deleted: true, review: { reviewStatus: "completed", createDate: "2026-04-30 08:00:00+0000", attemptCnt: 2, reviewId: "Review1", levelName: "home-level", reviewResult: { reviewAnswer: "RED", reviewRejectType: "FINAL", rejectLabels: ["DUPLICATE"] } } });
  expect(await sumsub.get("applicant1")).toMatchObject({ deleted: true, reviewState: "duplicate", reviewCreatedAt: "2026-04-30T08:00:00.000Z", attemptCount: 2, reviewId: "Review1", retryReason: null });
});

test("duplicate classification requires only DUPLICATE labels", () => {
  expect(normalizeReviewState("completed", "RED", "FINAL", ["DUPLICATE", "DUPLICATE"])).toBe("duplicate");
  expect(normalizeReviewState("completed", "RED", "FINAL", ["DUPLICATE", "FORGERY"])).toBe("final");
  expect(normalizeReviewState("completed", "RED", "RETRY", ["DUPLICATE", "FORGERY"])).toBe("retry");
  expect(normalizeReviewState("completed", "RED", "FINAL", [])).toBe("final");
});
