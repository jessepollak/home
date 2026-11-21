import { parseAddress, type Address } from "@/shared/chain/hex";

export type OperatorAccountConfig =
  | { kind: "absent" }
  | { kind: "misconfigured" }
  | { kind: "configured"; addresses: ReadonlySet<`0x${string}`> };

export function acceptOperatorAccount(value: unknown, config: OperatorAccountConfig): Address | null {
  const address = parseAddress(value);
  return address !== null && config.kind === "configured" && config.addresses.has(address) ? address : null;
}
