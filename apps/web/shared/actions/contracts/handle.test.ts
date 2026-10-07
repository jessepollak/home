import { expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { ACTION_KINDS } from "@/shared/money-actions/types";
import { HANDLE_ACTION_CONTRACT_VERSION, HANDLE_ACTION_ERROR_CODES, isHandleActionErrorCode, parseHandleActionErrorResponse, parseHandleActionResponse } from "./handle";

const owner = { subject: "user-1", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" };
const summary = { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-09-13T12:03:00.000Z" };
const action = {
  id: "action-a", provider: "cdp-embedded", kind: "send", summary, status: "pending",
  createdAt: "2026-09-13T12:00:00.000Z", confirmedAt: "2026-09-13T12:00:01.000Z", owner,
};
const response = { version: HANDLE_ACTION_CONTRACT_VERSION, action };

const validCases: Array<[string, unknown]> = [
  ["without submittedAt", response],
  ["with submittedAt", { ...response, action: { ...action, submittedAt: "2026-09-13T12:00:05.000Z" } }],
  ["with every optional field", { ...response, action: {
    ...action, submittedAt: "2026-09-13T12:00:05.000Z", settledAt: "2026-09-13T12:00:10.000Z",
    settledBlockNumber: "35123457", providerHandle: "handle-1", transactionHash: "0x123",
    summary: { ...summary, quoteId: "quote-1", metadata: { futureField: true }, signing: { futureField: [] },
      networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 } },
  } }],
  ["native network fee", { ...response, action: { ...action, summary: { ...summary, networkFee: { payment: "native" } } } }],
  ["zero settled block", { ...response, action: { ...action, settledBlockNumber: "0" } }],
  ["maximum-length provider handle", { ...response, action: { ...action, providerHandle: "h".repeat(512) } }],
  ["unknown fields", { ...response, extra: true, action: { ...action, extra: true, summary: { ...summary, extra: true } } }],
  ...ACTION_KINDS.map((kind): [string, unknown] => [kind, { ...response, action: { ...action, kind } }]),
  ...["pending", "unknown", "confirmed", "failed"].map((status): [string, unknown] => [status, { ...response, action: { ...action, status } }]),
  ["maximum-length id", { ...response, action: { ...action, id: "a".repeat(64) } }],
  ["absent provider", { ...response, action: { ...action, owner: { ...owner, accountProvider: undefined } } }],
  ["null provider", { ...response, action: { ...action, owner: { ...owner, accountProvider: null } } }],
];

test.each(validCases)("accepts a valid handle response %s", (_label, value) => {
  expect(value).toEqual(parseHandleActionResponse(value));
});

const invalidCases: Array<[string, unknown]> = [
  ["non-record response", null],
  ["array response", []],
  ["missing version", { action }],
  ["wrong version", { ...response, version: 2 }],
  ["string version", { ...response, version: "1" }],
  ["absent action", { version: 1 }],
  ["non-record action", { ...response, action: null }],
  ["array action", { ...response, action: [] }],
  ["missing id", { ...response, action: { ...action, id: undefined } }],
  ["empty id", { ...response, action: { ...action, id: "" } }],
  ["non-string id", { ...response, action: { ...action, id: 1 } }],
  ["overlong id", { ...response, action: { ...action, id: "a".repeat(65) } }],
  ["missing owner", { ...response, action: { ...action, owner: undefined } }],
  ["non-record owner", { ...response, action: { ...action, owner: null } }],
  ["array owner", { ...response, action: { ...action, owner: [] } }],
  ...["subject", "address", "chainId"].map((field): [string, unknown] => [
    `missing ${field}`, { ...response, action: { ...action, owner: { ...owner, [field]: undefined } } },
  ]),
  ...["subject", "address"].flatMap((field) => ["", 1].map((value): [string, unknown] => [
    `invalid ${field}: ${value}`, { ...response, action: { ...action, owner: { ...owner, [field]: value } } },
  ])),
  ...["8453", 8453.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity].map((chainId): [string, unknown] => [
    `invalid chainId: ${chainId}`, { ...response, action: { ...action, owner: { ...owner, chainId } } },
  ]),
  ["non-string provider", { ...response, action: { ...action, owner: { ...owner, accountProvider: 1 } } }],
  ...[1, null, "invalid", ""].map((submittedAt): [string, unknown] => [
    `invalid submittedAt: ${submittedAt}`, { ...response, action: { ...action, submittedAt } },
  ]),
  ...["provider", "kind", "summary", "status", "createdAt", "confirmedAt"].flatMap((field) => [undefined, 1].map((value): [string, unknown] => [
    `${field}: ${value}`, { ...response, action: { ...action, [field]: value } },
  ])),
  ["empty action provider", { ...response, action: { ...action, provider: "" } }],
  ["invalid kind", { ...response, action: { ...action, kind: "invalid" } }],
  ["invalid status", { ...response, action: { ...action, status: "submitted" } }],
  ["null summary", { ...response, action: { ...action, summary: null } }],
  ["array summary", { ...response, action: { ...action, summary: [] } }],
  ...["title", "amounts", "warnings", "expiresAt"].flatMap((field) => [undefined, 1].map((value): [string, unknown] => [
    `summary ${field}: ${value}`, { ...response, action: { ...action, summary: { ...summary, [field]: value } } },
  ])),
  ["non-string warning", { ...response, action: { ...action, summary: { ...summary, warnings: ["valid", 1] } } }],
  ...[null, 1].map((quoteId): [string, unknown] => [
    `invalid quoteId: ${quoteId}`, { ...response, action: { ...action, summary: { ...summary, quoteId } } },
  ]),
  ...["metadata", "signing"].flatMap((field) => [null, [], "invalid", 1].map((value): [string, unknown] => [
    `non-record ${field}: ${value}`, { ...response, action: { ...action, summary: { ...summary, [field]: value } } },
  ])),
  ...[null, [], "invalid", { payment: "usdc" }, { payment: "invalid" }].map((networkFee): [string, unknown] => [
    `invalid networkFee: ${JSON.stringify(networkFee)}`, { ...response, action: { ...action, summary: { ...summary, networkFee } } },
  ]),
  ...["createdAt", "confirmedAt", "settledAt"].flatMap((field) => [null, 1, "invalid", ""].map((value): [string, unknown] => [
    `invalid ${field}: ${value}`, { ...response, action: { ...action, [field]: value } },
  ])),
  ...["01", "-1", "1.5", 1, null, ""].map((settledBlockNumber): [string, unknown] => [
    `invalid settledBlockNumber: ${settledBlockNumber}`, { ...response, action: { ...action, settledBlockNumber } },
  ]),
  ...["", "h".repeat(513), 1, null].map((providerHandle): [string, unknown] => [
    `invalid providerHandle: ${providerHandle}`, { ...response, action: { ...action, providerHandle } },
  ]),
  ...["", 1, null].map((transactionHash): [string, unknown] => [
    `invalid transactionHash: ${transactionHash}`, { ...response, action: { ...action, transactionHash } },
  ]),
];

test.each(invalidCases)("rejects %s", (_label, value) => {
  expect(parseHandleActionResponse(value)).toBeNull();
});

test("handle action error contract accepts declared codes and rejects malformed or unknown responses", () => {
  for (const code of HANDLE_ACTION_ERROR_CODES) {
    expect(isHandleActionErrorCode(code)).toBe(true);
    expect(parseHandleActionErrorResponse({ error: { code, message: "Unavailable" } })).toEqual({ error: { code, message: "Unavailable" } });
  }
  for (const value of [null, [], {}, { error: null }, { error: { code: "UNKNOWN", message: "Unavailable" } },
    { error: { code: "ACTIONS_UNAVAILABLE", message: 42 } }]) {
    expect(parseHandleActionErrorResponse(value)).toBeNull();
  }
  expect(isHandleActionErrorCode("UNKNOWN")).toBe(false);
  expect(isHandleActionErrorCode(null)).toBe(false);
});
