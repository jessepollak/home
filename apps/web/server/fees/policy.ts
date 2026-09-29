import "server-only";

import { OPERATOR_FEE_SETTINGS_DEFAULTS, parseOperatorFeeSettings, type OperatorFeeActionType, type OperatorFeePolicy } from "@/shared/fees/contract";
import { getSqlExecutor } from "@/server/db/sql";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { TradePreparationError } from "@/server/actions/kinds/trade/permit2";

export async function resolveOperatorFeePolicy(
  action: OperatorFeeActionType,
  store?: Pick<OperatorSettingsStore, "read">,
): Promise<OperatorFeePolicy> {
  let value: unknown;
  try { value = (await (store ?? new OperatorSettingsStore(getSqlExecutor())).read("fees")).settings.value; }
  catch (error) { throw new TradePreparationError("provider-unavailable", error); }
  const settings = parseOperatorFeeSettings(value);
  if (!settings) throw new TradePreparationError("provider-unavailable");
  const policy = settings[action];
  return policy.bps > 0 && policy.recipient ? policy : OPERATOR_FEE_SETTINGS_DEFAULTS[action];
}

export function feePolicyForTaker(policy: OperatorFeePolicy, taker: `0x${string}`): OperatorFeePolicy {
  return policy.recipient !== null && policy.recipient.toLowerCase() === taker.toLowerCase()
    ? { bps: 0, recipient: null }
    : policy;
}
