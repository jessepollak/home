import { expect, test } from "bun:test";
import { isStringEnum, matchesId } from "./response-guards";

test.each([null, undefined, 1, true, {}, ["void"], { toString: () => "void" }].map((value) => ({ value })))("rejects non-string enum values: %p", ({ value }) => {
  expect(isStringEnum(value, ["pending", "posted", "void"])).toBe(false);
});

test("accepts only listed string enum values", () => {
  for (const value of ["pending", "posted", "void"]) expect(isStringEnum(value, ["pending", "posted", "void"])).toBe(true);
  expect(isStringEnum("unknown", ["pending", "posted", "void"])).toBe(false);
});

test.each([null, undefined, 1, true, {}, ["ic_123"], { toString: () => "ic_123" }].map((value) => ({ value })))("rejects non-string identifiers: %p", ({ value }) => {
  expect(matchesId(value, /^ic_[A-Za-z0-9]+$/)).toBe(false);
});

test("validates global identifier patterns independently of previous matches", () => {
  const pattern = /^ic_[A-Za-z0-9]+$/g;
  pattern.lastIndex = 3;
  expect(matchesId("ic_123", pattern)).toBe(true);
  expect(matchesId("ic_123", pattern)).toBe(true);
  expect(matchesId("invalid", pattern)).toBe(false);
  expect(matchesId("ic_456", pattern)).toBe(true);
});
