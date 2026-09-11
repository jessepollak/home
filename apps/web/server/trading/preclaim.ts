import type { ValidateBeforeMoneyActionClaim } from "@/server/money-actions/handlers";
import { createTradePreclaimValidator } from "./finalize";
import { getTradeIntentStore } from "./runtime-intent-store";

export type LoadTradePreclaimValidator = () => Promise<ValidateBeforeMoneyActionClaim>;

export function createTradePreclaimGate(
  loadValidator: LoadTradePreclaimValidator = loadRuntimeTradePreclaimValidator,
): ValidateBeforeMoneyActionClaim {
  let validatorPromise: Promise<ValidateBeforeMoneyActionClaim> | null = null;

  return async (input) => {
    if (input.action.kind !== "swap") return;
    validatorPromise ??= loadValidator();
    return (await validatorPromise)(input);
  };
}

export const validateTradeBeforeClaim = createTradePreclaimGate();

async function loadRuntimeTradePreclaimValidator(): Promise<ValidateBeforeMoneyActionClaim> {
  const intentStore = await getTradeIntentStore();
  const [{ getCdpAccessTokenValidator }, { getTradeBalance }, signer] = await Promise.all([
    import("@/server/cdp/provider"),
    import("./balance"),
    import("./signer"),
  ]);
  return createTradePreclaimValidator({
    intentStore,
    resolveSigner: signer.createTradeSignerResolver({
      getValidator: getCdpAccessTokenValidator,
    }),
    readBalance: getTradeBalance,
    readPermit2State: signer.createPermit2StateReader(),
  });
}
