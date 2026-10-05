import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { getAddress, isAddress } from "viem";
import { readBridgeConfig, type BridgeConfig } from "../bridge/config";

export type CardAllowanceRegistry = Readonly<{
  bridge: BridgeConfig;
  current: `0x${string}`;
  retired: readonly `0x${string}`[];
  maximumBaseUnits: string | null;
}>;

function lowercaseAddress(value: string): `0x${string}` | null {
  const lowercase = value.toLowerCase();
  return isAddress(lowercase) ? lowercase : null;
}

export function readCardSpenderBlocklist(env: Readonly<Record<string, string | undefined>> = serverEnvironment()): ReadonlySet<`0x${string}`> {
  const values = [env.BRIDGE_PROGRAM_SPENDER, ...((env.BRIDGE_PROGRAM_RETIRED_SPENDERS ?? "").split(","))];
  return new Set(values.flatMap((value) => {
    const address = value ? lowercaseAddress(value.trim()) : null;
    return address ? [address] : [];
  }));
}

export function readCardAllowanceRegistry(env: Readonly<Record<string, string | undefined>> = serverEnvironment()): CardAllowanceRegistry | null {
  const bridge = readBridgeConfig(env);
  if (!bridge) return null;
  const raw = env.BRIDGE_PROGRAM_RETIRED_SPENDERS;
  const retired = raw?.trim() ? raw.split(",").map((entry) => entry.trim()) : [];
  const current = lowercaseAddress(bridge.programSpender);
  if (!current) throw new Error("Invalid Bridge program spender");
  if (retired.length > 8 || retired.some((entry) => !isAddress(entry) || getAddress(entry) !== entry ||
      /^0x(?:0{40}|f{40})$/i.test(entry)) ||
      new Set(retired.map((entry) => entry.toLowerCase())).size !== retired.length ||
      retired.some((entry) => entry.toLowerCase() === current)) throw new Error("Invalid retired Bridge spender registry");
  const rawMaximum = env.BRIDGE_CARD_ALLOWANCE_MAX_USDC;
  let maximumBaseUnits: string | null = null;
  if (rawMaximum !== undefined && rawMaximum !== "") {
    if (!/^[1-9][0-9]*$/.test(rawMaximum) || BigInt(rawMaximum) > BigInt(1_000_000)) throw new Error("Invalid Bridge card allowance maximum");
    maximumBaseUnits = (BigInt(rawMaximum) * BigInt(1_000_000)).toString();
  }
  const normalizedRetired = retired.map(lowercaseAddress);
  if (normalizedRetired.some((entry) => entry === null)) throw new Error("Invalid retired Bridge spender registry");
  return Object.freeze({ bridge, current, retired: Object.freeze(normalizedRetired.filter((entry) => entry !== null)), maximumBaseUnits });
}

export function cardAllowanceSetEnabled(registry: CardAllowanceRegistry | null,
  readJourney: () => { mode: "production" | "sandbox"; funding: { kind: string } } | null): boolean {
  if (!registry || registry.bridge.mode !== "production" || !registry.maximumBaseUnits) return false;
  const journey = readJourney();
  return journey?.mode === registry.bridge.mode && journey.funding.kind === "crypto_wallet";
}
