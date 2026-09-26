import { MfaError } from "@coinbase/cdp-core";
import { BaseAccountConnectorError } from "./base-account-connector";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import { TransferExecutionError } from "@/shared/transfers/types";

export type ConfirmedPlan = {
  calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: string }>;
  batchGasLimit?: string;
};

type GenerationGuard = Pick<OwnerGenerationFence, "assertCurrent">;

export function isUserRejectedWalletError(error: unknown): boolean {
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
  dispatchAttempts: Map<string, number>;
  pendingDeclines: Map<string, Promise<void>>;
  confirm: () => Promise<ConfirmedPlan>;
  dispatch: (plan: ConfirmedPlan) => Promise<string>;
  recordHandle: (providerHandle: string) => Promise<void>;
  recordDecline?: (attempt: number, signal?: AbortSignal) => Promise<void>;
  beginRetry?: (attempt: number) => Promise<void>;
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
  let retryGateFailed = false;
  if (!dispatch) {
    input.fence.assertCurrent(input.generation);
    const previousAttempt = input.dispatchAttempts.get(input.id);
    const attempt = previousAttempt === undefined ? 0 : previousAttempt + 1;
    dispatch = (async () => {
      if (previousAttempt !== undefined) {
        try {
          await input.pendingDeclines.get(input.id);
          if (!input.beginRetry || attempt > 1000) throw new Error("Action retry is unavailable.");
          await input.beginRetry(attempt);
        } catch (error) {
          retryGateFailed = true;
          throw new TransferExecutionError("unavailable", error);
        }
        input.fence.assertCurrent(input.generation);
      }
      input.dispatchAttempts.set(input.id, attempt);
      return input.dispatch(plan);
    })();
    input.providerDispatches.set(input.id, dispatch);
  }
  let providerHandle: string;
  try {
    providerHandle = await dispatch;
  } catch (error) {
    const notSubmitted = error instanceof TransferExecutionError && error.reason === "not-submitted";
    if (isUserRejectedWalletError(error) || notSubmitted) {
      if (input.providerDispatches.get(input.id) === dispatch) {
        input.providerDispatches.delete(input.id);
        const attempt = input.dispatchAttempts.get(input.id) ?? 0;
        const report = reportDecline(input.recordDecline, attempt);
        input.pendingDeclines.set(input.id, report);
        void report.then(() => {
          if (input.pendingDeclines.get(input.id) === report) input.pendingDeclines.delete(input.id);
        });
      }
      throw notSubmitted ? error : new TransferExecutionError("rejected", error);
    }
    if (retryGateFailed && input.providerDispatches.get(input.id) === dispatch) {
      input.providerDispatches.delete(input.id);
    }
    if (error instanceof TransferExecutionError && error.reason === "stale-session") throw error;
    if (!retryGateFailed) throw new TransferExecutionError("dispatch-unknown", error);
    throw error;
  }
  input.fence.assertCurrent(input.generation);
  await input.recordHandle(providerHandle);
  input.fence.assertCurrent(input.generation);
  return providerHandle;
}

async function reportDecline(
  report: ((attempt: number, signal?: AbortSignal) => Promise<void>) | undefined,
  attempt: number,
): Promise<void> {
  if (!report) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  let onAbort: () => void = () => {};
  try {
    await Promise.race([
      Promise.resolve().then(() => report(attempt, controller.signal)),
      new Promise<void>((resolve) => {
        onAbort = resolve;
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
