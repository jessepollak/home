import { describe, expect, test } from "bun:test";
import { parseAuthBoundaryErrorResponse } from "./auth-boundary";
import { parseConfirmActionErrorResponse } from "@/shared/actions/contracts/confirm";
import { parsePrepareActionErrorResponse } from "@/shared/actions/contracts/prepare";
import { parseHandleActionErrorResponse } from "@/shared/actions/contracts/handle";
import { parseDeclineActionErrorResponse } from "@/shared/actions/contracts/decline";
import { parseRetryActionErrorResponse } from "@/shared/actions/contracts/retry";
import { parseGetActionErrorResponse } from "@/shared/actions/contracts/get";
import { parseListActionsErrorResponse } from "@/shared/actions/contracts/list";
import { parseNetworkFeePolicyErrorResponse } from "@/shared/actions/contracts/network-fee";
import { parsePendingTradeErrorResponse } from "@/shared/actions/contracts/trade-pending";
import { parseBalancesErrorResponse } from "@/shared/balances/contract";
import { parseActivityErrorResponse } from "@/shared/activity/contract";
import { parseActivityOrdersErrorResponse } from "@/shared/activity/contract-orders";
import { parseBorrowErrorResponse } from "@/shared/borrowing/contract";
import { parseTransferRecipientsErrorResponse } from "@/shared/transfers/contracts/recipients";
import { parseTradeErrorResponse } from "@/shared/trading/contract";
import { parseStockTradeEligibilityErrorResponse } from "@/shared/trading/contract-stock-eligibility";
import { parseInviteLinkErrorResponse } from "@/shared/invites/contract";
import { parseCountryPreferenceErrorResponse } from "./country-preference";
import { parseEmailRequestErrorResponse } from "./email-request";
import { parseAccountExportErrorResponse } from "./data-export";
import { readFundingErrorResponse } from "@/shared/funding/contracts/errors";
import { parseCardWriteError } from "@/shared/cards/contract";
import { parseCardSpendingError } from "@/shared/cards/allowance-contract";
import { parseSupportErrorResponse } from "@/shared/support/contract";
import { parseOperatorSettingsErrorResponse } from "@/shared/operator-settings/contract";
import { parseOperatorErrorResponse } from "@/shared/operator/contract";

const boundaryCodes = [
  "UNAUTHENTICATED", "AUTH_UNAVAILABLE", "ACCOUNT_DELETED",
  "INVALID_ACCOUNT_PROVIDER", "BASE_ACCOUNT_DISABLED", "AMBIGUOUS_AUTHENTICATION",
] as const;

describe("auth boundary error contract", () => {
  test.each([...boundaryCodes])("accepts %s", (code) => {
    const body = { error: { code, message: "Authentication failed." } };
    expect(parseAuthBoundaryErrorResponse(body)).toEqual(body);
  });

  test.each([
    { error: { code: "UNKNOWN", message: "Authentication failed." } },
    { error: { code: "UNAUTHENTICATED" } },
    { error: { code: "UNAUTHENTICATED", message: 1 } },
    { error: { code: "UNAUTHENTICATED", message: "Authentication failed." }, version: 1 },
    { error: { code: "UNAUTHENTICATED", message: "Authentication failed.", extra: true } },
    {},
    { error: null },
    { error: [] },
    null,
    undefined,
    [],
    "UNAUTHENTICATED",
    1,
    true,
  ].map((body) => ({ body })))("rejects a non-contract body: %j", ({ body }) => {
    expect(parseAuthBoundaryErrorResponse(body)).toBeNull();
  });
});

const boundaryOnlyErrorParsers = {
  parseGetActionErrorResponse,
  parseListActionsErrorResponse,
  parseNetworkFeePolicyErrorResponse,
  parsePendingTradeErrorResponse,
  parseBalancesErrorResponse,
  parseActivityErrorResponse,
  parseActivityOrdersErrorResponse,
  parseBorrowErrorResponse,
  parseTransferRecipientsErrorResponse,
  parseStockTradeEligibilityErrorResponse,
  parseInviteLinkErrorResponse,
};

const routeErrorParsers = {
  ...boundaryOnlyErrorParsers,
  parseTradeErrorResponse,
  parseConfirmActionErrorResponse,
  parsePrepareActionErrorResponse,
  parseHandleActionErrorResponse,
  parseDeclineActionErrorResponse,
  parseRetryActionErrorResponse,
  parseCountryPreferenceErrorResponse,
  parseEmailRequestErrorResponse,
  parseAccountExportErrorResponse,
  readFundingErrorResponse,
  parseCardWriteError,
  parseCardSpendingError,
  parseSupportErrorResponse,
};

const operatorErrorParsers = { parseOperatorSettingsErrorResponse, parseOperatorErrorResponse };

for (const [name, parse] of Object.entries(operatorErrorParsers)) {
  describe(name, () => {
    test.each(["UNAUTHENTICATED", "AUTH_UNAVAILABLE"])("accepts reachable auth boundary %s", (code) => {
      expect(parse({ error: { code } })).toEqual({ error: { code } });
    });

    test.each(["ACCOUNT_DELETED", "INVALID_ACCOUNT_PROVIDER", "BASE_ACCOUNT_DISABLED", "AMBIGUOUS_AUTHENTICATION"])(
      "rejects unreachable auth boundary %s mapped away by operator authorization", (code) => {
        expect(parse({ error: { code, message: "Authentication failed." } })).toBeNull();
      },
    );

    test("rejects an unknown error code", () => {
      expect(parse({ error: { code: "UNKNOWN" } })).toBeNull();
    });
  });
}

for (const [name, parse] of Object.entries(boundaryOnlyErrorParsers)) {
  describe(name, () => {
    test.each([
      { error: { code: "ACTION_NOT_FOUND", message: "The action was not found." } },
      { error: { code: "UNAUTHENTICATED" } },
      { error: { code: "UNAUTHENTICATED", message: 1 } },
      { version: 1, error: { code: "UNAUTHENTICATED", message: "Authentication failed." } },
      { error: { code: "UNAUTHENTICATED", message: "Authentication failed.", extra: true } },
      null,
      [],
    ].map((body) => ({ body })))("rejects a non-boundary body: %j", ({ body }) => {
      expect(parse(body)).toBeNull();
    });
  });
}

test.each([
  "TRADE_INVALID", "TRADE_UNAVAILABLE", "TRADE_SIGNER_UNSUPPORTED", "TRADE_INSUFFICIENT_BALANCE",
  "TRADE_ROUTE_UNAVAILABLE", "TRADE_BELOW_MINIMUM", "TRADE_TOKEN_UNREADABLE", "PRODUCT_NOT_OFFERED",
  "TRADE_BUY_UNAVAILABLE", "TRADE_PAIR_UNAVAILABLE", "TRADE_QUOTE_STALE", "TRADE_QUOTE_REJECTED",
  "TRADE_STOCK_RESTRICTED", "TRADE_NOT_ROUTED",
])("trade errors retain domain code %s", (code) => {
  const body = { error: { code, message: "The trade failed." } };
  expect(parseTradeErrorResponse(body)).toEqual(body);
});

test.each([
  { error: { code: "TRADE_INVALID" } },
  { error: { code: "TRADE_INVALID", message: "" } },
  { error: { code: "TRADE_INVALID", message: 1 } },
  { version: 1, error: { code: "UNAUTHENTICATED", message: "Authentication failed." } },
].map((body) => ({ body })))("trade errors reject malformed body: %j", ({ body }) => {
  expect(parseTradeErrorResponse(body)).toBeNull();
});

const messageErrorParsers = { parseDeclineActionErrorResponse, parseRetryActionErrorResponse, parseCountryPreferenceErrorResponse };

for (const [name, parse] of Object.entries(messageErrorParsers)) {
  describe(name, () => {
    test.each([
      { error: { code: "ACCOUNT_DELETED" } },
      { error: { code: "ACCOUNT_DELETED", message: "" } },
      { error: { code: "ACCOUNT_DELETED", message: 1 } },
      { error: null },
      { error: [] },
      null,
      [],
    ].map((body) => ({ body })))("rejects a malformed error body: %j", ({ body }) => {
      expect(parse(body)).toBeNull();
    });
  });
}

for (const [parse, codes] of [
  [parseDeclineActionErrorResponse, ["INVALID_ACTION", "INVALID_ACTION_DECLINE", "ACTION_NOT_FOUND", "ACTIONS_UNAVAILABLE"]],
  [parseRetryActionErrorResponse, ["INVALID_ACTION", "INVALID_ACTION_RETRY", "ACTION_NOT_FOUND", "ACTIONS_UNAVAILABLE",
    "ACTION_EXPIRED", "ACTION_ALREADY_DISPATCHED", "ACTION_RETRY_CONFLICT", "CARD_ALLOWANCE_UNAVAILABLE", "CARD_ALLOWANCE_NOT_READY"]],
  [parseCountryPreferenceErrorResponse, ["COUNTRY_PREFERENCE_INVALID", "COUNTRY_PREFERENCE_UNAVAILABLE"]],
] as const) {
  test.each([...codes])(`accepts ${parse.name} domain error %s`, (code) => {
    const body = { error: { code, message: "The request failed." } };
    expect<unknown>(parse(body)).toEqual(body);
  });
}

test.each([...boundaryCodes])("card write accepts versionless %s but rejects versioned boundary errors", (code) => {
  const body = { error: { code, message: "Authentication failed." } };
  expect(parseCardWriteError(body)).toEqual(body);
  expect(parseCardWriteError({ version: 2, error: { code } })).toBeNull();
  expect(parseCardWriteError({ version: 2, ...body })).toBeNull();
});

for (const [name, parse] of Object.entries(routeErrorParsers)) {
  describe(name, () => {
    test.each([...boundaryCodes])("accepts auth boundary %s", (code) => {
      expect(parse({ error: { code, message: "Authentication failed." } })).toMatchObject({ error: { code } });
    });

    test("rejects an unknown error code", () => {
      expect(parse({ error: { code: "UNKNOWN", message: "Authentication failed." } })).toBeNull();
    });
  });
}
