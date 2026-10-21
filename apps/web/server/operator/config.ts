import "server-only";

import { serverEnvironment } from "@/server/config/env";
import type { OperatorAccountConfig } from "@/shared/operator-settings/operator-account";

export type OperatorConfig = OperatorAccountConfig;

export function parseOperatorAddressList(raw: string | undefined): OperatorAccountConfig {
  if (raw === undefined || /^[ \t\n\r\f\v]*$/.test(raw)) return { kind: "absent" };

  const addresses = new Set<`0x${string}`>();
  for (const item of raw.split(",")) {
    const address = item.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { kind: "misconfigured" };
    const normalized = address.toLowerCase() as `0x${string}`;
    if (addresses.has(normalized)) return { kind: "misconfigured" };
    addresses.add(normalized);
  }
  return { kind: "configured", addresses };
}

export function readOperatorConfig(
  env: Record<string, string | undefined> = serverEnvironment(),
): OperatorConfig {
  return parseOperatorAddressList(env.HOME_OPERATOR_ADDRESSES);
}
