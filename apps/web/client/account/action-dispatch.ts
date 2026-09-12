import { MfaError } from "@coinbase/cdp-core";
import { BaseAccountConnectorError } from "./base-account-connector";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import { TransferExecutionError } from "@/shared/transfers/types";

export type ConfirmedPlan = {
  calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: string }>;
};

type GenerationGuard = Pick<OwnerGenerationFence, "assertCurrent">;

function isUserRejectedDispatch(error: unknown): boolean {
  return (
    error instanceof BaseAccountConnectorError && error.reason === "cancelled"
  ) || (
    error instanceof MfaError && error.code === "CANCELLED"
  );
}

export async function executeActionOnce(input: {
  id: string;
  generation: number;
  fence: GenerationGuard;
  confirmedPlans: Map<string, ConfirmedPlan>;
  providerDispatches: Map<string, Promise<string>>;
  confirm: () => Promise<ConfirmedPlan>;
  dispatch: (plan: ConfirmedPlan) => Promise<string>;
  recordHandle: (providerHandle: string) => Promise<void>;
}): Promise<string> {
  input.fence.assertCurrent(input.generation);
  let plan = input.confirmedPlans.get(input.id);
  if (!plan) {
    input.fence.assertCurrent(input.generation);
    plan = await input.confirm();
    input.fence.assertCurrent(input.generation);
    input.confirmedPlans.set(input.id, plan);
  }

  let dispatch = input.providerDispatches.get(input.id);
  if (!dispatch) {
    input.fence.assertCurrent(input.generation);
    dispatch = input.dispatch(plan);
    input.providerDispatches.set(input.id, dispatch);
  }
  let providerHandle: string;
  try {
    providerHandle = await dispatch;
  } catch (error) {
    if (isUserRejectedDispatch(error)) {
      if (input.providerDispatches.get(input.id) === dispatch) {
        input.providerDispatches.delete(input.id);
      }
      throw new TransferExecutionError("rejected", error);
    }
    throw error;
  }
  input.fence.assertCurrent(input.generation);
  await input.recordHandle(providerHandle);
  input.fence.assertCurrent(input.generation);
  return providerHandle;
}
