"use client";

import { useCallback, useMemo, useState } from "react";
import { parseUsdcAmount } from "@/client/savings/format";
import {
  appendMovement,
  availableCashBaseUnits,
  presentExplorationActivity,
  presentExplorationPosition,
  settleMovement,
  usdcLabel,
  type ExplorationMoneyState,
  type ExplorationMovement,
  type ExplorationPositionView,
  type ExplorationVaultView,
  type MoveMoneyOutcome,
} from "./money-state";

/**
 * Move-money state machine for the Home reimagined exploration of
 * [issue #662](https://github.com/jessepollak/home/issues/662).
 *
 * The flow is deliberately unhelpful about choosing a destination: a person selects the
 * vault, types the amount, reads the exact facts, and confirms. Nothing picks a vault by
 * rate, nothing submits on its own, and a pending, unknown, or failed outcome never
 * becomes a confirmed one.
 *
 * Amounts are parsed with the production USDC parser (`parseUsdcAmount`) and compared in
 * `BigInt`, so the flow cannot accept a value it cannot represent or exceed what is
 * available.
 */

export type MoveMoneyStep = "destination" | "amount" | "review" | "pending" | "result";

export type MoveMoneyStart =
  | { step: "destination"; destinationId?: string | null }
  /** A null destination is only valid where the destination step is inline. */
  | { step: "amount"; destinationId?: string | null; amountText?: string }
  | { step: "review"; destinationId: string; amountText: string }
  | { step: "pending"; movementId: string }
  | { step: "result"; movementId: string };

export type MoveMoneyRequest = {
  amountBaseUnits: string;
  destinationId: string;
  destinationName: string;
};

export type MoveMoneyExecutor = (request: MoveMoneyRequest) => Promise<MoveMoneyOutcome>;

export type AmountInputResult =
  | { status: "empty"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "exceeds"; message: string }
  | { status: "ok"; baseUnits: string };

function parseAmountInput(
  value: string,
  availableBaseUnits: string | null,
  regionId: ExplorationMoneyState["regionId"],
): AmountInputResult {
  const trimmed = value.trim();
  if (!trimmed) return { status: "empty", message: "Enter an amount to continue." };
  if (!/^[0-9]+(?:\.[0-9]*)?$/.test(trimmed)) {
    return { status: "invalid", message: "Use digits only, with up to 6 decimal places." };
  }
  let baseUnits: string;
  try {
    baseUnits = parseUsdcAmount(trimmed);
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "Enter an amount to continue.",
    };
  }
  if (availableBaseUnits === null) {
    return { status: "unavailable", message: "Available to use is unavailable right now." };
  }
  if (BigInt(baseUnits) > BigInt(availableBaseUnits)) {
    return {
      status: "exceeds",
      message: `You can move up to ${usdcLabel(availableBaseUnits, regionId)}.`,
    };
  }
  return { status: "ok", baseUnits };
}

/** Base units back to an editable decimal string, without rounding or locale formatting. */
export function amountTextFromBaseUnits(baseUnits: string, decimals = 6): string {
  const padded = BigInt(baseUnits).toString(10).padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export type ExplorationMoneyController = {
  state: ExplorationMoneyState;
  position: ExplorationPositionView;
  activity: ReturnType<typeof presentExplorationActivity>;
  record: (movement: ExplorationMovement) => void;
  settle: (movementId: string, outcome: MoveMoneyOutcome, resolvedAt: string) => void;
  reset: () => void;
};

export function useExplorationMoney(
  initialState: ExplorationMoneyState,
): ExplorationMoneyController {
  const [state, setState] = useState(initialState);
  const position = useMemo(() => presentExplorationPosition(state), [state]);
  const activity = useMemo(() => presentExplorationActivity(state), [state]);

  const record = useCallback((movement: ExplorationMovement) => {
    setState((current) => appendMovement(current, movement));
  }, []);
  const settle = useCallback(
    (movementId: string, outcome: MoveMoneyOutcome, resolvedAt: string) => {
      setState((current) => settleMovement(current, movementId, outcome, resolvedAt));
    },
    [],
  );
  const reset = useCallback(() => setState(initialState), [initialState]);

  return { state, position, activity, record, settle, reset };
}

export type MoveMoneyController = {
  step: MoveMoneyStep;
  regionId: ExplorationMoneyState["regionId"];
  destinations: readonly ExplorationVaultView[];
  destinationId: string | null;
  destination: ExplorationVaultView | null;
  selectDestination: (vaultAddress: string) => void;
  amountText: string;
  setAmountText: (value: string) => void;
  markAmountTouched: () => void;
  amountError: string | null;
  destinationError: string | null;
  amountBaseUnits: string | null;
  amountLabel: string | null;
  availableBaseUnits: string | null;
  availableLabel: string | null;
  quickAmounts: readonly { label: string; baseUnits: string }[];
  canContinue: boolean;
  continueFromAmount: () => void;
  continueFromDestination: () => void;
  submit: () => void;
  back: () => boolean;
  restart: () => void;
  reset: () => void;
  movement: ExplorationMovement | null;
};

export function useMoveMoneyFlow(input: {
  state: ExplorationMoneyState;
  position: ExplorationPositionView;
  start: MoveMoneyStart;
  /** False keeps the destination choice inside the amount step. */
  destinationScreen?: boolean;
  execute: MoveMoneyExecutor;
  record: (movement: ExplorationMovement) => void;
  settle: (movementId: string, outcome: MoveMoneyOutcome, resolvedAt: string) => void;
}): MoveMoneyController {
  const { start, state, position } = input;
  const destinationScreen = input.destinationScreen ?? true;
  // A review cannot start without a chosen destination; fall back to the amount step.
  const declaredStep: MoveMoneyStep = start.step === "review" && !start.destinationId
    ? "amount"
    : start.step;
  const firstStep: MoveMoneyStep = declaredStep === "destination" && !destinationScreen
    ? "amount"
    : declaredStep;
  const [step, setStep] = useState<MoveMoneyStep>(firstStep);
  const [destinationId, setDestinationId] = useState<string | null>(
    start.step === "amount" || start.step === "review" ? start.destinationId ?? null : null,
  );
  const [amountText, setAmountTextValue] = useState(
    start.step === "amount" || start.step === "review" ? start.amountText ?? "" : "",
  );
  const [amountTouched, setAmountTouched] = useState(start.step === "review");
  const [destinationTouched, setDestinationTouched] = useState(start.step === "review");
  const [movementId, setMovementId] = useState<string | null>(
    start.step === "pending" || start.step === "result" ? start.movementId : null,
  );

  const destinations = position.vaults;
  const destination = destinationId === null
    ? null
    : destinations.find(
        (vault) => vault.vaultAddress.toLowerCase() === destinationId.toLowerCase(),
      ) ?? null;
  const availableBaseUnits = availableCashBaseUnits(state);
  const parsed = useMemo(
    () => parseAmountInput(amountText, availableBaseUnits, state.regionId),
    [amountText, availableBaseUnits, state.regionId],
  );
  const movement = movementId === null
    ? null
    : state.movements.find((entry) => entry.id === movementId) ?? null;
  const exactAmount = parsed.status === "ok" ? parsed.baseUnits : null;

  const selectDestination = useCallback((vaultAddress: string) => {
    setDestinationId(vaultAddress);
  }, []);

  const setAmountText = useCallback((value: string) => {
    setAmountTextValue(value);
  }, []);

  const markAmountTouched = useCallback(() => {
    setAmountTouched(true);
  }, []);

  const quickAmounts = useMemo(() => {
    if (availableBaseUnits === null) return [];
    const available = BigInt(availableBaseUnits);
    return ["25000000", "50000000", "100000000"]
      .filter((baseUnits) => BigInt(baseUnits) <= available)
      .map((baseUnits) => ({
        label: usdcLabel(baseUnits, state.regionId),
        baseUnits,
      }));
  }, [availableBaseUnits, state.regionId]);

  const continueFromDestination = useCallback(() => {
    if (destinationId === null) return;
    setStep("amount");
  }, [destinationId]);

  const continueFromAmount = useCallback(() => {
    setAmountTouched(true);
    setDestinationTouched(true);
    if (exactAmount === null || destinationId === null) return;
    setStep("review");
  }, [destinationId, exactAmount]);

  const submit = useCallback(() => {
    if (exactAmount === null || destinationId === null) {
      setAmountTouched(true);
      return;
    }
    const vault = destinations.find(
      (entry) => entry.vaultAddress.toLowerCase() === destinationId.toLowerCase(),
    );
    if (!vault) return;
    // Each deliberate attempt is its own record: the id and timestamp follow the attempt
    // number, so a retry is never deduped against the failure it supersedes. The fixture
    // clock does not advance on its own, so attempt N is N-1 seconds after the scenario
    // clock — a convention, not a real timestamp source.
    const priorAttempts = input.state.movements.filter(
      (entry) =>
        entry.vaultAddress.toLowerCase() === vault.vaultAddress.toLowerCase()
        && entry.amountBaseUnits === exactAmount,
    ).length;
    const attempt = priorAttempts + 1;
    const recordedAt = new Date(state.nowMs + (attempt - 1) * 1_000).toISOString();
    const settledMovement: ExplorationMovement = {
      id: `movement-${vault.vaultAddress.slice(2, 8)}-${exactAmount}-${state.nowMs}-${String(attempt).padStart(2, "0")}`,
      kind: "save",
      vaultAddress: vault.vaultAddress,
      vaultName: vault.name,
      amountBaseUnits: exactAmount,
      status: "pending",
      recordedAt,
      resolvedAt: null,
      transactionHash: null,
    };
    input.record(settledMovement);
    setMovementId(settledMovement.id);
    setStep("pending");
    void input
      .execute({
        amountBaseUnits: exactAmount,
        destinationId: vault.vaultAddress,
        destinationName: vault.name,
      })
      .then((outcome) => {
        input.settle(settledMovement.id, outcome, resolvedAtFor(recordedAt));
        setStep("result");
      })
      .catch(() => {
        input.settle(settledMovement.id, { status: "failed" }, resolvedAtFor(recordedAt));
        setStep("result");
      });
  }, [destinationId, destinations, exactAmount, input, state.nowMs]);

  const back = useCallback((): boolean => {
    if (step === "review") {
      setStep("amount");
      return true;
    }
    if (step === "amount" && firstStep === "destination") {
      setStep("destination");
      return true;
    }
    return false;
  }, [firstStep, step]);

  /** Returns to the amount step with the previous values intact; never resubmits. */
  const restart = useCallback(() => {
    setMovementId(null);
    setAmountTouched(false);
    setStep("amount");
  }, []);

  const reset = useCallback(() => {
    setMovementId(null);
    setAmountTouched(false);
    setDestinationTouched(false);
    setAmountTextValue("");
    setDestinationId(null);
    setStep(firstStep === "destination" ? "destination" : "amount");
  }, [firstStep]);

  return {
    step,
    regionId: state.regionId,
    destinations,
    destinationId,
    destination,
    selectDestination,
    amountText,
    setAmountText,
    markAmountTouched,
    amountError: amountTouched && parsed.status !== "ok" ? parsed.message : null,
    destinationError: destinationTouched && destinationId === null
      ? "Choose where this goes."
      : null,
    amountBaseUnits: exactAmount,
    // A seeded or settled movement carries the exact amount even when the amount field
    // was never typed in this session.
    amountLabel: movement
      ? usdcLabel(movement.amountBaseUnits, state.regionId)
      : exactAmount !== null
        ? usdcLabel(exactAmount, state.regionId)
        : null,
    availableBaseUnits,
    availableLabel: position.availableLabel,
    quickAmounts,
    canContinue: exactAmount !== null && destinationId !== null,
    continueFromAmount,
    continueFromDestination,
    submit,
    back,
    restart,
    reset,
    movement,
  };
}

/** Fixture resolution times stay deterministic: 30 seconds after the recorded intent. */
function resolvedAtFor(recordedAt: string): string {
  return new Date(Date.parse(recordedAt) + 30_000).toISOString();
}
