import type { RecoverableBalancesState } from "@/client/balances/use-balances";

type Observation = RecoverableBalancesState["observation"];
type Phase = "healthy" | "transient" | "offline-pending" | "offline" | "interrupted" | "recovery-hold";

export type InterruptionState = {
  identity: string | null;
  phase: Phase;
  prior: Exclude<Phase, "offline-pending" | "offline">;
  deadline: number | null;
  suspendedDeadline: number | null;
  openedAt: number;
  lastError: number;
  lastData: number;
  rechecks: number;
  requests: number;
  firstShown: "offline" | "interrupted" | null;
  announcement: number;
  online: boolean;
  confirmationRequested: boolean;
  deferredSuccess: boolean;
  fetching: boolean;
  awaitingSettle: boolean;
};

export function initialInterruptionState(): InterruptionState {
  return {
    identity: null, phase: "healthy", prior: "healthy", deadline: null, suspendedDeadline: null, openedAt: 0,
    lastError: 0, lastData: 0, rechecks: 0, requests: 0, firstShown: null,
    announcement: 0, online: true, confirmationRequested: false,
    deferredSuccess: false, fetching: false, awaitingSettle: false,
  };
}

export type InterruptionEvent =
  | { type: "observe"; observation: Observation; enabled: boolean; now: number; wallNow: number; online: boolean }
  | { type: "connectivity"; online: boolean; now: number; wallNow: number }
  | { type: "tick"; now: number }
  | { type: "retry" };

function show(state: InterruptionState, phase: "offline" | "interrupted", now: number): InterruptionState {
  return {
    ...state, phase, deadline: phase === "interrupted" && state.online && state.rechecks < 10 ? now + 30_000 : null,
    firstShown: state.firstShown ?? phase,
    announcement: state.firstShown ? state.announcement : state.announcement + 1,
  };
}

function advance(state: InterruptionState, now: number): InterruptionState {
  if (state.deadline === null || now < state.deadline) return state;
  if (state.phase === "offline-pending") return show(state, "offline", now);
  if (state.phase === "transient" && !state.confirmationRequested) {
    return { ...state, confirmationRequested: true, deadline: null,
      requests: state.requests + (state.fetching ? 0 : 1) };
  }
  if (state.phase === "recovery-hold") {
    return { ...initialInterruptionState(), identity: state.identity, online: state.online,
      lastError: state.lastError, lastData: state.lastData, announcement: state.announcement,
      fetching: state.fetching };
  }
  if (state.phase === "interrupted" && state.online && state.rechecks < 10) {
    if (state.fetching) return { ...state, deadline: null, awaitingSettle: true };
    const rechecks = state.rechecks + 1;
    return { ...state, rechecks, requests: state.requests + 1,
      deadline: rechecks < 10 ? now + 30_000 : null };
  }
  return state;
}

export function reduceInterruption(state: InterruptionState, event: InterruptionEvent): InterruptionState {
  if (event.type === "retry") {
    return state.identity && state.online ? { ...state, requests: state.requests + 1 } : state;
  }
  if (event.type === "tick") return advance(state, event.now);
  if (event.type === "observe" && (!event.enabled || !event.observation.identity ||
    event.observation.identity !== state.identity)) {
    return {
      ...initialInterruptionState(),
      identity: event.enabled ? event.observation.identity : null,
      lastError: event.observation.errorUpdatedAt,
      lastData: event.observation.dataUpdatedAt,
      fetching: event.observation.fetchStatus === "fetching",
      online: event.online,
      phase: event.enabled && !event.online ? "offline-pending" : "healthy",
      deadline: event.enabled && !event.online ? event.now + 2_000 : null,
      announcement: state.announcement,
    };
  }
  const online = event.online;
  let next = { ...state, online };
  if (!online && state.online) {
    if (state.phase !== "offline") {
      next = { ...next, phase: "offline-pending", prior: state.phase === "offline-pending" ? state.prior : state.phase,
        deadline: event.now + 2_000,
        suspendedDeadline: state.deadline === null ? null : Math.max(0, state.deadline - event.now) }; 
    }
  } else if (online && !state.online) {
    if (state.phase === "offline") {
      next = state.deferredSuccess
        ? { ...next, phase: "recovery-hold", deadline: event.now + 3_000, deferredSuccess: false }
        : { ...show(next, "interrupted", event.now), requests: state.requests + 1 };
    } else if (state.phase === "offline-pending") {
      if (state.deferredSuccess && state.prior === "transient") {
        next = { ...initialInterruptionState(), identity: state.identity, online,
          lastError: state.lastError, lastData: state.lastData, announcement: state.announcement,
          fetching: state.fetching };
      } else if (state.deferredSuccess &&
        (state.prior === "interrupted" || state.prior === "recovery-hold")) {
        next = { ...next, phase: "recovery-hold", deadline: event.now + 3_000,
          suspendedDeadline: null, deferredSuccess: false };
      } else {
        next = { ...next, phase: state.prior,
          deadline: state.suspendedDeadline === null ? null : event.now + state.suspendedDeadline,
          suspendedDeadline: null, deferredSuccess: false };
      }
    }
  }
  if (event.type === "connectivity") return advance(next, event.now);
  const observation = event.observation;
  const newError = observation.errorUpdatedAt > state.lastError;
  const newData = observation.dataUpdatedAt > state.lastData;
  next.lastError = Math.max(state.lastError, observation.errorUpdatedAt);
  next.lastData = Math.max(state.lastData, observation.dataUpdatedAt);
  next.fetching = observation.fetchStatus === "fetching";
  if (newData && observation.hasData && observation.fetchStatus !== "paused" &&
    observation.dataUpdatedAt > state.openedAt) {
    if (!online && (next.phase === "offline" || next.phase === "offline-pending")) {
      next = { ...next, deferredSuccess: true };
    } else if (online && (next.phase === "transient" || next.phase === "interrupted" || next.phase === "recovery-hold")) {
      if (next.phase === "transient") {
        return { ...initialInterruptionState(), identity: state.identity, online, lastError: next.lastError,
          lastData: next.lastData, announcement: state.announcement, fetching: next.fetching };
      }
      next = { ...next, phase: "recovery-hold", deadline: event.now + 3_000, awaitingSettle: false };
    }
  }
  if (newError && observation.failureEligible && observation.fetchStatus !== "paused" && online) {
    next.deferredSuccess = false;
    if (next.phase === "healthy") {
      return { ...next, phase: "transient", deadline: event.now + 5_000, openedAt: event.wallNow,
        confirmationRequested: false };
    }
    if (next.phase === "recovery-hold" || (next.phase === "transient" && next.confirmationRequested)) {
      next = show(next, "interrupted", event.now);
    }
  }
  if (next.phase === "interrupted" && online && next.awaitingSettle && !next.fetching && next.rechecks < 10) {
    next = { ...next, awaitingSettle: false, deadline: event.now + 30_000 };
  }
  return advance(next, event.now);
}

export function visibleInterruption(state: InterruptionState): "offline" | "interrupted" | null {
  if (state.phase === "offline-pending" &&
    (state.prior === "interrupted" || state.prior === "recovery-hold")) return "interrupted";
  if (state.phase === "offline") return "offline";
  if (state.phase === "interrupted" || state.phase === "recovery-hold") {
    return state.online ? "interrupted" : "offline";
  }
  return null;
}
