import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { acceptOperatorAccount, type OperatorAccountConfig } from "./operator-account";

const signer = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const administrator = "0x1111111111111111111111111111111111111111";
const configured: OperatorAccountConfig = { kind: "configured", addresses: new Set([signer]) };

test("operator account validator requires a configured signer, not merely an administrator", () => {
  expect<string | null>(acceptOperatorAccount(signer, configured)).toBe(signer);
  expect<string | null>(acceptOperatorAccount(getAddress(signer), configured)).toBe(signer);
  for (const config of [{ kind: "absent" }, { kind: "misconfigured" }, configured] as const) {
    expect(acceptOperatorAccount(administrator, config)).toBeNull();
  }
  for (const config of [{ kind: "absent" }, { kind: "misconfigured" }] as const) {
    expect(acceptOperatorAccount(signer, config)).toBeNull();
  }
  for (const value of [null, undefined, 1, "0x1234", ` ${signer}`, "0xabCdefabcdefabcdefabcdefabcdefabcdefabcd"]) {
    expect(acceptOperatorAccount(value, configured)).toBeNull();
  }
});
