import { expect, test } from "bun:test";
import { authorizedOperatorAddress } from "./section-content";
import UnknownAdminPage from "./[...path]/page";

function redirectTarget(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { digest?: string }).digest?.split(";")[2];
  }
  return undefined;
}

test("operator address redirects signed-out and non-operator decisions", () => {
  expect(redirectTarget(() => authorizedOperatorAddress({ kind: "unauthenticated" }))).toBe("/?account=signin");
  expect(redirectTarget(() => authorizedOperatorAddress({ kind: "forbidden" }))).toBe("/home");
  expect(authorizedOperatorAddress({ kind: "operator", address: "0x1111111111111111111111111111111111111111" })).toBe("0x1111111111111111111111111111111111111111");
});

test("unknown admin paths trigger a 404", () => {
  expect(() => UnknownAdminPage()).toThrow(/NEXT_HTTP_ERROR.*404/);
});
