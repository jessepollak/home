import { expect, test } from "bun:test";
import { parseOperatorErrorResponse, parseOperatorSessionResponse } from "./contract";

const operator = "0x1111111111111111111111111111111111111111";

test("operator session responses require a version and a valid address", () => {
  expect<unknown>(parseOperatorSessionResponse({ version: 1, operator: { address: operator } })).toEqual({ version: 1, operator: { address: operator } });
  for (const value of [
    { version: 2, operator: { address: operator } },
    { version: 1, operator: { address: "0x1234" } },
    { version: 1 },
  ]) {
    expect(parseOperatorSessionResponse(value)).toBeNull();
  }
});

test("operator error responses reject unknown codes", () => {
  expect(parseOperatorErrorResponse({ error: { code: "OPERATOR_FORBIDDEN" } })).toEqual({ error: { code: "OPERATOR_FORBIDDEN" } });
  expect(parseOperatorErrorResponse({ error: { code: "UNKNOWN" } })).toBeNull();
});
