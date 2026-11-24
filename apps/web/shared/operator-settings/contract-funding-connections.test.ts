import { expect, test } from "bun:test";
import { parseFundingConnectionRequest, parseFundingConnectionResponse, type FundingConnectionResponse } from "./contract-funding-connections";

const response: FundingConnectionResponse = { version: 1, providerId: "ripio", checkedAt: "2026-10-21T12:00:00.000Z", status: "rejected", scopes: [{ regions: ["AR"], status: "connected" }, { regions: ["BR"], status: "rejected" }] };

test("connection responses reject unknown statuses, malformed dates, scopes and private extra fields", () => {
  expect(parseFundingConnectionResponse(response)).toEqual(response);
  for (const value of [
    null, {}, { ...response, version: 2 }, { ...response, providerId: "../coinbase" },
    { ...response, status: "ok" }, { ...response, checkedAt: "not a date" },
    { ...response, scopes: [] }, { ...response, scopes: [{ regions: ["AR"], status: "ok" }] },
    { ...response, scopes: [{ regions: ["Argentina"], status: "connected" }] },
    { ...response, scopes: [{ regions: ["AR", "AR"], status: "connected" }] },
    { ...response, scopes: [{ regions: ["AR"], status: "connected", body: "private" }] },
    { ...response, body: "private" },
  ]) expect(parseFundingConnectionResponse(value)).toBeNull();
});

test("connection requests are versioned and contain only a bounded provider id", () => {
  expect(parseFundingConnectionRequest({ version: 1, providerId: "coinbase" })).toEqual({ version: 1, providerId: "coinbase" });
  for (const value of [{ version: 2, providerId: "coinbase" }, { version: 1, providerId: "" }, { version: 1, providerId: "a".repeat(33) }, { version: 1, providerId: "coinbase", token: "private" }]) expect(parseFundingConnectionRequest(value)).toBeNull();
});
