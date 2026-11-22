import { setSystemTime } from "bun:test";
import type { SQL } from "bun";
import type { Address, Hex } from "viem";
import { actionOwnerKey } from "@/server/actions/store";
import { Chain, SAVE_VAULT, SimWallet, type Call, type DispatchMode } from "./chain";
import { HomeOwner, type HomeResponse } from "./home";
import type { Invariant } from "./invariants";
import type { PeerStandIn, SimOrder } from "./peer";

export type Violation = { invariant: Invariant; step: number; detail: string };
export const KINDS = ["send", "savings-deposit", "savings-withdraw", "cash-out", "cash-out-withdraw"] as const;
type Kind = typeof KINDS[number];
type Phase = "entry" | "exit";
type Faults = { lostHandle: boolean; revert: DispatchMode; doubleConfirm: boolean; declineRetry: boolean; hashHint: boolean };
type Stage = "prepare" | "confirm" | "decline" | "dispatch" | "handle" | "hint" | "done";
type SimAction = {
  index: number; phase: Phase; kind: Kind; amount: bigint; faults: Faults; stage: Stage;
  id?: string; calls?: Call[]; userOpHash?: Hex; handlePosted: boolean; prepareRefused?: string; dispatchUnknown?: boolean;
  minShares?: bigint; previewShares?: bigint; expectedReceive?: bigint;
  payee?: string; twinOf?: number; cancelOf?: number; skipped?: boolean; preparedOrder?: number;
  guard?: "refused" | "accepted"; progressSeen?: boolean;
};
type PhaseStats = {
  actions: number; kinds: Record<Kind, number>;
  faults: { lostHandle: number; innerRevert: number; bundleRevert: number; doubleConfirm: number; declineRetry: number };
  landed: { succeeded: number; reverted: number }; prepareRefused: number; maxInFlight: number; lostHandleUnresolved: number; lostHandleRecovered: number;
  doubleConfirmBothAccepted: number;
};
export type RunResult = {
  seed: number; violations: Violation[]; steps: number; entry: PhaseStats; exit: PhaseStats;
  guard: { pairs: number; refused: number; accepted: number; cancels: number; cancelsSkipped: number };
};

const FUNDING = BigInt(100_000_000);
const FINALITY_BLOCKS = 70;
const RECIPIENT: Address = "0x000000000000000000000000000000000000dEaD";
const PAYEES = ["$homesimalpha", "$homesimbeta"] as const;
const GUARD_CODES = new Set(["CASHOUT_ORDER_IN_FLIGHT", "CASHOUT_DUPLICATE_UNKNOWN"]);
// The exit phase draws from its own stream, so every entry-phase schedule replays exactly as it did before exits existed.
const EXIT_STREAM = 0x5bd1e995;

/** mulberry32: a small seeded PRNG so a seed replays the same scenario and fault schedule. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VirtualClock {
  constructor(private readonly db: SQL) {}
  async syncTo(chain: Chain): Promise<void> {
    const block = await chain.client.getBlock({ blockTag: "latest" });
    const at = new Date(Number(block.timestamp) * 1000 + 1000);
    setSystemTime(at);
    await this.db`UPDATE sim_clock.clock SET at = ${at.toISOString()}::timestamptz`;
  }
}

function faultsFrom(random: () => number): Faults {
  const pick = (p: number) => random() < p;
  const lostHandle = pick(0.15);
  const revertRoll = random();
  return {
    lostHandle,
    revert: revertRoll < 0.08 ? "inner-revert" : revertRoll < 0.16 ? "bundle-revert" : "normal",
    doubleConfirm: pick(0.2),
    declineRetry: pick(0.15),
    hashHint: pick(0.5),
  };
}

function usdcAmount(random: () => number, maxWhole: number): bigint {
  return BigInt(1 + Math.floor(random() * maxWhole)) * BigInt(1_000_000) + BigInt(Math.floor(random() * 100)) * BigInt(10_000);
}

export async function simulateRun(input: { seed: number; chain: Chain; clock: VirtualClock; db: SQL; bundler: Address; peer: PeerStandIn }): Promise<RunResult> {
  const { seed, chain, clock, db, bundler, peer } = input;
  const violations: Violation[] = [];
  let step = 0;
  let prepared = 0;
  const mine = async (blocks: number) => { await chain.mine(blocks); await clock.syncTo(chain); };

  await clock.syncTo(chain);
  const wallet = await SimWallet.create(chain, seed, bundler);
  await chain.fundUsdc(wallet.address, FUNDING);
  await mine(1);
  const home = new HomeOwner(`sim-${seed}`, wallet.address);
  const recipientStart = await chain.usdcBalance(RECIPIENT);
  const ownerKey = actionOwnerKey({ subject: `sim-${seed}`, address: wallet.address, chainId: 8453, accountProvider: "cdp-embedded" });

  // Entry phase: generated exactly as in the send + Save deposit simulation, so its seeds replay unchanged.
  const random = rng(seed);
  const pick = (p: number) => random() < p;
  const count = 2 + Math.floor(random() * 4);
  const actions: SimAction[] = Array.from({ length: count }, (_, index) => {
    const revertRoll = random();
    return {
      index, phase: "entry" as const,
      kind: pick(0.5) ? "send" : "savings-deposit",
      amount: usdcAmount(random, 40),
      faults: {
        lostHandle: pick(0.15),
        revert: revertRoll < 0.08 ? "inner-revert" : revertRoll < 0.16 ? "bundle-revert" : "normal",
        doubleConfirm: pick(0.2),
        declineRetry: pick(0.15),
        hashHint: pick(0.5),
      },
      stage: "prepare",
      handlePosted: false,
    };
  });
  const stats = { entry: { maxInFlight: 0, doubleConfirmBothAccepted: 0 }, exit: { maxInFlight: 0, doubleConfirmBothAccepted: 0 } };

  const check = async (final: boolean) => {
    await wallet.observe();
    const found = await checkInvariants({ chain, wallet, home, db, ownerKey, actions, final, recipientStart, peer });
    for (const finding of found) violations.push({ ...finding, step });
  };
  const flag = (invariant: Invariant, detail: string) => violations.push({ invariant, step, detail });
  const orderFor = async (action: SimAction | undefined): Promise<SimOrder | null> => {
    const landing = action?.id ? wallet.get(action.id)?.landing : null;
    if (!landing?.success) return null;
    return (await peer.orders(wallet.address)).find((order) => order.transactionHash === landing.transactionHash.toLowerCase()) ?? null;
  };

  /** Home's guard is right to refuse a cash-out only while a same-amount cash-out is unresolved on the chain or in Home. */
  const guardJustified = async (action: SimAction): Promise<{ mustRefuse: boolean; mayRefuse: boolean }> => {
    const live = (await peer.orders(wallet.address)).some((order) =>
      order.totalAmount === action.amount && order.totalAmount - order.returnedAmount - order.filledAmount > BigInt(0));
    const list = await home.list();
    const items = Array.isArray(list.body.actions) ? list.body.actions as Array<Record<string, unknown>> : [];
    // An earlier cash-out is resolved for the guard only once Home stores its final outcome, not when a receipt reads failed.
    const stored = await readRows(db, ownerKey);
    const unresolvedInHome = actions.some((other) => other !== action && other.kind === "cash-out" && other.amount === action.amount &&
      other.payee === action.payee && other.calls &&
      items.some((item) => item.id === other.id && !["reverted", "not_submitted"].includes(stored.get(other.id!)?.outcome ?? "") &&
        (item.cashout as { state?: string; settledAt?: string | null } | undefined)?.settledAt == null));
    // docs/actions.md: a new cash-out matching an unresolved local one (same amount, platform, currency, payee) is refused.
    const orders = await peer.orders(wallet.address);
    const unresolvedLocal = actions.some((other) => {
      if (other === action || other.kind !== "cash-out" || other.amount !== action.amount || other.payee !== action.payee || !other.calls) return false;
      const landing = other.id ? wallet.get(other.id)?.landing : null;
      if (landing && !landing.success) return false;
      const order = landing ? orders.find((entry) => entry.transactionHash === landing.transactionHash.toLowerCase()) : null;
      return !order || order.state !== "returned";
    });
    return { mustRefuse: live || unresolvedLocal, mayRefuse: live || unresolvedInHome || unresolvedLocal };
  };

  const advance = async (action: SimAction): Promise<boolean> => {
    switch (action.stage) {
      case "prepare": {
        let params: Record<string, unknown>;
        if (action.kind === "send") params = { assetId: "usdc", recipient: RECIPIENT, amountBaseUnits: action.amount.toString() };
        else if (action.kind === "savings-deposit" || action.kind === "savings-withdraw") params = { vaultAddress: SAVE_VAULT, amountBaseUnits: action.amount.toString() };
        else if (action.kind === "cash-out") {
          params = { providerId: "peer", region: "US", assetId: "base:usdc", amountBaseUnits: action.amount.toString(), platform: "cashapp", currency: "USD", payoutHandle: action.payee! };
        } else {
          const target = actions[action.cancelOf!]!;
          const order = await orderFor(target);
          if (!order) {
            // Wait while the deposit can still land; skip the cancel only once it never will.
            const targetLanding = target.id ? wallet.get(target.id)?.landing : null;
            if (!targetLanding && (target.stage !== "done" || target.userOpHash)) return false;
            action.skipped = true;
            action.stage = "done";
            return true;
          }
          params = { providerId: "peer", region: "US", depositId: order.depositId };
        }
        const available = await chain.usdcBalance(wallet.address);
        const position = await chain.vaultAssets(await chain.vaultShares(wallet.address));
        const guard = action.kind === "cash-out" ? await guardJustified(action) : null;
        const cancelTarget = action.kind === "cash-out-withdraw" ? await orderFor(actions[action.cancelOf!]) : null;
        const response = await home.prepare(action.kind, params);
        action.preparedOrder = prepared++;
        if (response.status !== 201 || typeof response.body.id !== "string") {
          const code = String((response.body.error as { code?: unknown } | undefined)?.code ?? "");
          action.prepareRefused = `${response.status} ${code}`;
          if (guard) {
            action.guard = "refused";
            if (!GUARD_CODES.has(code) || !guard.mayRefuse) flag("cash-out-guard", `cash-out of ${action.amount} refused (${action.prepareRefused}) with no matching unresolved cash-out`);
          } else if (GUARD_CODES.has(code)) {
            flag("cash-out-guard", `${action.kind} of ${action.amount} refused by the cash-out guard (${code})`);
          } else {
            // Save prepare reads the latest block, so it may refuse an amount the account or position no longer holds;
            // a cancel may find the deposit already returned. Any other refusal turned away an action the chain would take.
            const justified = action.kind === "savings-deposit" ? code === "SAVINGS_ACTION_LIMIT_EXCEEDED" && action.amount > available
              : action.kind === "savings-withdraw" ? code === "SAVINGS_ACTION_LIMIT_EXCEEDED" && action.amount + BigInt(1) >= position
              : action.kind === "cash-out-withdraw" ? code === "CASHOUT_NOT_WITHDRAWABLE" && cancelTarget !== null && cancelTarget.nextActions.length === 0
              : false;
            if (!justified) flag("actions-resolve", `${action.kind} of ${action.amount} refused at prepare (${action.prepareRefused}); USDC ${available}, Save ${position}`);
          }
          action.stage = "done";
          return true;
        }
        if (guard) {
          action.guard = "accepted";
          if (guard.mustRefuse) flag("cash-out-guard", `cash-out of ${action.amount} to ${action.payee} accepted while a matching cash-out is unresolved`);
        }
        action.id = response.body.id;
        const metadata = response.body.metadata as { minimumSharesBaseUnits?: string } | undefined;
        if (action.kind === "savings-deposit") action.minShares = BigInt(metadata?.minimumSharesBaseUnits ?? "0");
        const amounts = (response.body.amounts ?? []) as Array<{ direction?: string; symbol?: string; amountBaseUnits?: string }>;
        if (action.kind === "savings-withdraw") action.previewShares = BigInt(amounts.find((a) => a.direction === "spend")?.amountBaseUnits ?? "0");
        if (action.kind === "cash-out-withdraw") action.expectedReceive = BigInt(amounts.find((a) => a.direction === "receive" && a.symbol === "USDC")?.amountBaseUnits ?? "0");
        action.stage = "confirm";
        return true;
      }
      case "confirm": {
        const id = action.id!;
        const responses: HomeResponse[] = action.faults.doubleConfirm
          ? await Promise.all([home.confirm(id), home.confirm(id)])
          : [await home.confirm(id)];
        const accepted = responses.filter((response) => response.status === 200);
        if (accepted.length > 1) {
          stats[action.phase].doubleConfirmBothAccepted += 1;
          const keys = new Set(accepted.map((response) => JSON.stringify(response.body.calls)));
          if (keys.size > 1) flag("pending-not-spendable", `double confirm returned different calls for ${id}`);
        }
        if (!accepted.length) {
          action.prepareRefused = `confirm ${responses.map((response) => response.status).join("/")}`;
          flag("actions-resolve", `${id.slice(0, 8)} confirm refused (${action.prepareRefused})`);
          action.stage = "done";
          return true;
        }
        action.calls = accepted[0]!.body.calls as Call[];
        action.stage = action.faults.declineRetry ? "decline" : "dispatch";
        return true;
      }
      case "decline": {
        // The wallet rejects attempt 0; the client reports it and opens attempt 1 before dispatching again.
        await home.decline(action.id!, 0);
        const retry = await home.retry(action.id!, 1);
        if (retry.status !== 200) flag("records-match-receipts", `retry after decline returned ${retry.status}`);
        action.stage = "dispatch";
        return true;
      }
      case "dispatch": {
        // A double-confirmed action can be dispatched from both responses; the idempotency key keeps it one operation.
        const dispatches = action.faults.doubleConfirm ? 2 : 1;
        for (let attempt = 0; attempt < dispatches; attempt++) {
          const result = await wallet.dispatch(action.id!, action.calls!, action.faults.revert);
          if (result.kind === "idempotency-error") { action.dispatchUnknown = true; continue; }
          action.userOpHash = result.userOpHash;
        }
        action.stage = action.faults.lostHandle ? "done" : "handle";
        return true;
      }
      case "handle": {
        const response = await home.handle(action.id!, { providerHandle: action.userOpHash! });
        if (response.status !== 200) flag("records-match-receipts", `handle post returned ${response.status}`);
        action.handlePosted = true;
        action.stage = action.faults.hashHint ? "hint" : "done";
        return true;
      }
      case "hint": {
        const landing = wallet.get(action.id!)?.landing;
        if (!landing) return false;
        await home.handle(action.id!, { transactionHash: landing.transactionHash });
        action.stage = "done";
        return true;
      }
      default:
        return false;
    }
  };

  const runPhase = async (phase: Phase, phaseRandom: () => number) => {
    const own = actions.filter((action) => action.phase === phase);
    await check(false);
    for (let guard = 0; guard < 200; guard++) {
      const live = own.filter((action) => action.stage !== "done");
      if (!live.length) break;
      const inFlight = actions.filter((action) => action.calls && !(action.id && wallet.get(action.id)?.landing)).length;
      stats[phase].maxInFlight = Math.max(stats[phase].maxInFlight, inFlight);
      const roll = phaseRandom();
      step += 1;
      if (roll < 0.62) {
        const action = live[Math.floor(phaseRandom() * live.length)]!;
        if (!await advance(action)) await mine(1);
      } else if (roll < 0.8) {
        await mine(1 + Math.floor(phaseRandom() * 3));
      } else if (roll < 0.86) {
        await wallet.observe();
        await wallet.resubmitUnlanded();
      } else if (roll < 0.93) {
        await home.drainScheduled();
      } else {
        await home.webhook();
      }
      await check(false);
    }
    for (let round = 0; round < 6; round++) {
      step += 1;
      await mine(FINALITY_BLOCKS);
      await wallet.observe();
      if (await wallet.resubmitUnlanded()) continue;
      await home.drainScheduled();
      await home.webhook();
      await check(false);
      if (await settled(db, ownerKey, actions)) break;
    }
    // Give the cash-out refresh rotation enough owner reads to reach every finalized cash-out before the final check.
    for (let read = 0; read < 6 && actions.some((action) => action.kind === "cash-out" && action.id && !action.progressSeen &&
      wallet.get(action.id)?.landing?.success); read++) {
      step += 1;
      await mine(1);
      await check(false);
    }
    step += 1;
    await check(true);
  };

  await runPhase("entry", random);

  // Exit phase: Save withdrawals and Peer cash-outs (with same-amount twins and cancels), mixed with a few entries.
  const exitRandom = rng((seed ^ EXIT_STREAM) >>> 0);
  const primaries = 2 + Math.floor(exitRandom() * 3);
  for (let n = 0; n < primaries; n++) {
    const roll = exitRandom();
    const kind: Kind = roll < 0.35 ? "savings-withdraw" : roll < 0.75 ? "cash-out" : roll < 0.9 ? "send" : "savings-deposit";
    const action: SimAction = {
      index: actions.length, phase: "exit", kind, amount: usdcAmount(exitRandom, 30), faults: faultsFrom(exitRandom),
      stage: "prepare", handlePosted: false, payee: PAYEES[Math.floor(exitRandom() * PAYEES.length)],
    };
    actions.push(action);
    if (kind !== "cash-out") continue;
    if (exitRandom() < 0.35) {
      actions.push({ ...action, index: actions.length, faults: faultsFrom(exitRandom), twinOf: action.index,
        payee: exitRandom() < 0.7 ? action.payee : PAYEES.find((payee) => payee !== action.payee) });
    }
    if (exitRandom() < 0.5) {
      actions.push({ index: actions.length, phase: "exit", kind: "cash-out-withdraw", amount: action.amount, faults: faultsFrom(exitRandom),
        stage: "prepare", handlePosted: false, cancelOf: action.index });
    }
  }
  await runPhase("exit", exitRandom);

  const rows = await readRows(db, ownerKey);
  const phaseStats = (phase: Phase): PhaseStats => {
    const own = actions.filter((a) => a.phase === phase && !a.skipped);
    const landings = own.map((a) => (a.id ? wallet.get(a.id)?.landing : null)).filter((landing) => landing);
    return {
      actions: own.length,
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, own.filter((a) => a.kind === kind).length])) as Record<Kind, number>,
      faults: {
        lostHandle: own.filter((a) => a.faults.lostHandle && a.userOpHash).length,
        innerRevert: own.filter((a) => a.faults.revert === "inner-revert" && a.userOpHash).length,
        bundleRevert: own.filter((a) => a.faults.revert === "bundle-revert" && a.userOpHash).length,
        doubleConfirm: own.filter((a) => a.faults.doubleConfirm && a.calls).length,
        declineRetry: own.filter((a) => a.faults.declineRetry && a.calls).length,
      },
      landed: { succeeded: landings.filter((l) => l!.success).length, reverted: landings.filter((l) => !l!.success).length },
      prepareRefused: own.filter((a) => a.prepareRefused).length,
      maxInFlight: stats[phase].maxInFlight,
      lostHandleUnresolved: own.filter((a) => a.faults.lostHandle && a.id && !rows.get(a.id)?.outcome).length,
      lostHandleRecovered: own.filter((a) => a.faults.lostHandle && a.userOpHash && a.id && rows.get(a.id)?.outcome).length,
      doubleConfirmBothAccepted: stats[phase].doubleConfirmBothAccepted,
    };
  };
  return {
    seed, violations, steps: step, entry: phaseStats("entry"), exit: phaseStats("exit"),
    guard: {
      // A twin and its original are one same-amount pair; either may reach prepare first and be the one refused.
      pairs: actions.filter((a) => a.twinOf !== undefined && a.guard && actions[a.twinOf]?.guard).length,
      refused: actions.filter((a) => a.kind === "cash-out" && a.guard === "refused" && GUARD_CODES.has(a.prepareRefused?.split(" ")[1] ?? "")).length,
      accepted: actions.filter((a) => a.kind === "cash-out" && a.guard === "accepted").length,
      cancels: actions.filter((a) => a.kind === "cash-out-withdraw" && !a.skipped).length,
      cancelsSkipped: actions.filter((a) => a.kind === "cash-out-withdraw" && a.skipped).length,
    },
  };
}

type Row = {
  id: string; confirmed_at: Date | null; outcome: string | null; transaction_hash: string | null; provider_handle: string | null;
  observed_receipt_transaction_hash: string | null; observed_receipt_block_hash: string | null; observed_receipt_outcome: string | null;
  settled_at: Date | null;
};

async function readRows(db: SQL, ownerKey: string): Promise<Map<string, Row>> {
  const rows = await db<Row[]>`SELECT id, confirmed_at, outcome, transaction_hash, provider_handle, observed_receipt_transaction_hash,
    observed_receipt_block_hash, observed_receipt_outcome, settled_at FROM actions WHERE owner_key = ${ownerKey}`;
  return new Map(rows.map((row) => [String(row.id), row]));
}

async function settled(db: SQL, ownerKey: string, actions: SimAction[]): Promise<boolean> {
  const rows = await readRows(db, ownerKey);
  return actions.every((action) => !action.handlePosted || Boolean(action.id && rows.get(action.id)?.outcome));
}

/** A lost-handle action Home is documented to leave open: another action with the same committed calls is unresolved. */
function ambiguousLostHandle(action: SimAction, actions: SimAction[], rows: Map<string, Row>): boolean {
  const calls = JSON.stringify(action.calls);
  return actions.some((other) => other !== action && other.id && JSON.stringify(other.calls) === calls && !rows.get(other.id)?.outcome);
}

/** The USDC an action moves when it succeeds, signed from the wallet's side; reverted operations move nothing. */
function expectedUsdc(action: SimAction): bigint {
  if (action.kind === "savings-withdraw") return action.amount;
  if (action.kind === "cash-out-withdraw") return action.expectedReceive ?? BigInt(0);
  return -action.amount;
}

async function checkInvariants(input: {
  chain: Chain; wallet: SimWallet; home: HomeOwner; db: SQL; ownerKey: string; actions: SimAction[]; final: boolean; recipientStart: bigint;
  peer: PeerStandIn;
}): Promise<Array<Omit<Violation, "step">>> {
  const { chain, wallet, home, db, ownerKey, actions, final, recipientStart, peer } = input;
  const out: Array<Omit<Violation, "step">> = [];
  const fail = (invariant: Invariant, detail: string) => out.push({ invariant, detail });
  const latest = BigInt(await chain.rpc<string>("eth_blockNumber", []));
  const finalized = latest - BigInt(64);
  const rows = await readRows(db, ownerKey);

  for (const row of rows.values()) {
    const landing = wallet.get(row.id)?.landing ?? null;
    if (row.outcome === "succeeded" || row.outcome === "reverted") {
      if (!landing) { fail("records-match-receipts", `${row.id.slice(0, 8)} recorded ${row.outcome} but never landed`); continue; }
      if ((row.outcome === "succeeded") !== landing.success) fail("records-match-receipts", `${row.id.slice(0, 8)} recorded ${row.outcome}, receipt says success=${landing.success}`);
      if (row.transaction_hash?.toLowerCase() !== landing.transactionHash.toLowerCase()) fail("records-match-receipts", `${row.id.slice(0, 8)} outcome on tx ${row.transaction_hash?.slice(0, 10)} not the landing tx`);
      if (landing.blockNumber > finalized) fail("records-match-receipts", `${row.id.slice(0, 8)} outcome written before finality`);
    } else if (row.outcome === "not_submitted") {
      if (landing) fail("records-match-receipts", `${row.id.slice(0, 8)} recorded not_submitted but landed`);
    }
    if (row.observed_receipt_outcome) {
      if (!landing) fail("records-match-receipts", `${row.id.slice(0, 8)} observed ${row.observed_receipt_outcome} receipt that never landed`);
      else if ((row.observed_receipt_outcome === "succeeded") !== landing.success ||
        row.observed_receipt_block_hash?.toLowerCase() !== landing.blockHash.toLowerCase()) {
        fail("records-match-receipts", `${row.id.slice(0, 8)} observation disagrees with receipt`);
      }
    }
  }

  // Per receipt: the USDC Home said each action moves is what its own receipt moved, once; Save shares match the receipt.
  for (const action of actions) {
    const landing = action.id ? wallet.get(action.id)?.landing : null;
    if (!landing) continue;
    const tag = `${action.id!.slice(0, 8)} ${action.kind}`;
    const expected = landing.success ? expectedUsdc(action) : BigInt(0);
    if (landing.usdcDelta !== expected) fail("records-match-receipts", `${tag} receipt moved ${landing.usdcDelta} USDC, Home's summary says ${expected}`);
    if (!landing.success) {
      if (landing.sharesDelta !== BigInt(0)) fail("records-match-receipts", `${tag} reverted but moved ${landing.sharesDelta} Save shares`);
    } else if (action.kind === "savings-deposit") {
      if (landing.sharesDelta < (action.minShares ?? BigInt(1)) || landing.sharesDelta <= BigInt(0)) {
        fail("records-match-receipts", `${tag} receipt minted ${landing.sharesDelta} shares, below the ${action.minShares} minimum`);
      }
    } else if (action.kind === "savings-withdraw") {
      const burned = -landing.sharesDelta;
      const preview = action.previewShares ?? BigInt(0);
      if (burned <= BigInt(0) || burned * BigInt(1000) > preview * BigInt(1001)) {
        fail("records-match-receipts", `${tag} receipt burned ${burned} shares; Home previewed ${preview}`);
      }
    } else if (landing.sharesDelta !== BigInt(0)) {
      fail("records-match-receipts", `${tag} moved ${landing.sharesDelta} Save shares`);
    }
  }

  const list = await home.list();
  const items = Array.isArray(list.body.actions) ? list.body.actions as Array<Record<string, unknown>> : [];
  if (list.status !== 200) fail("records-match-receipts", `GET /api/actions returned ${list.status}`);
  // Every confirmed action belongs in the owner's list within its 24-hour window; a run is far shorter than that.
  if (list.status === 200) {
    const listed = new Set(items.map((item) => String(item.id)));
    for (const action of actions) {
      if (action.calls && action.id && !listed.has(action.id)) fail("records-match-receipts", `${action.id.slice(0, 8)} ${action.kind} is confirmed but missing from GET /api/actions`);
    }
  }
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  let confirmedSpend = BigInt(0);
  for (const item of items) {
    const id = String(item.id);
    if (seenIds.has(id)) fail("pending-not-spendable", `${id.slice(0, 8)} listed twice`);
    seenIds.add(id);
    if (typeof item.transactionHash === "string") {
      if (seenHashes.has(item.transactionHash)) fail("pending-not-spendable", `transaction ${item.transactionHash.slice(0, 10)} listed under two actions`);
      seenHashes.add(item.transactionHash);
    }
    const landing = wallet.get(id)?.landing ?? null;
    if (item.status === "confirmed") {
      if (!landing?.success) fail("records-match-receipts", `${id.slice(0, 8)} shown confirmed but ${landing ? "reverted" : "never landed"}`);
      confirmedSpend += spend(item);
    }
    if (item.status === "failed" && landing?.success) fail("records-match-receipts", `${id.slice(0, 8)} shown failed but succeeded onchain`);
    if (final && wallet.get(id) && actions.find((a) => a.id === id)?.handlePosted && landing && item.status !== (landing.success ? "confirmed" : "failed")) {
      fail("actions-resolve", `${id.slice(0, 8)} still ${String(item.status)} after finality; receipt success=${landing.success}`);
    }
  }
  if (final) {
    for (const action of actions) {
      if (action.userOpHash && !action.handlePosted && !wallet.get(action.id!)?.landing) {
        fail("actions-resolve", `${action.id!.slice(0, 8)} was dispatched but never landed`);
      }
      // docs/actions.md: a lost handle post is recovered from the operation's committed call data, unless an
      // identical-calldata twin is still open, in which case both stay unresolved rather than risk a double claim.
      if (action.id && action.userOpHash && !action.handlePosted && wallet.get(action.id)?.landing && !rows.get(action.id)?.outcome &&
        !ambiguousLostHandle(action, actions, rows)) {
        fail("actions-resolve", `${action.id.slice(0, 8)} lost its handle post, landed and has no identical-calldata twin, but Home never recovered it`);
      }
      if (!action.handlePosted || !action.id) continue;
      const row = rows.get(action.id);
      const landing = wallet.get(action.id)?.landing;
      if (!landing) fail("actions-resolve", `${action.id.slice(0, 8)} was dispatched and its handle posted, but never landed`);
      if (landing && !row?.outcome) fail("actions-resolve", `${action.id.slice(0, 8)} landed (success=${landing.success}) but no outcome recorded`);
    }
  }

  // Cash-out escrow: each action's progress describes the deposit it is linked to, no deposit is linked twice, and once
  // Home has finalized an action's own receipt its link is that receipt's deposit. A hashless twin may be linked by
  // matching amount, platform, currency and payee (docs/actions.md), so it is checked against its linked deposit.
  const orders = actions.some((action) => action.kind === "cash-out") ? await peer.orders(wallet.address) : [];
  const linkedBy = new Map<string, string>();
  for (const action of actions) {
    if (action.kind !== "cash-out" || !action.id) continue;
    const landing = wallet.get(action.id)?.landing;
    const own = landing?.success ? orders.find((entry) => entry.transactionHash === landing.transactionHash.toLowerCase()) : undefined;
    if (landing?.success && (!own || own.totalAmount !== action.amount)) {
      fail("balances-match-chain", `${action.id.slice(0, 8)} cash-out landed but escrow holds ${own?.totalAmount ?? "no deposit"} for ${action.amount}`);
    }
    const progress = items.find((item) => item.id === action.id)?.cashout as
      { progressConfirmed?: boolean; depositId?: string; returnedAtomic?: string; remainingAtomic?: string } | undefined;
    if (progress?.depositId && progress.progressConfirmed) action.progressSeen = true;
    // After finality a cash-out whose own receipt succeeded must be linked to an escrow deposit, and some owner read must
    // have refreshed its progress. Each read refreshes at most two cash-outs (docs/actions.md), so one read is not enough.
    const settledOk = final && landing?.success && rows.get(action.id)?.outcome === "succeeded";
    if (settledOk && (!progress?.depositId || !action.progressSeen)) {
      fail("actions-resolve", `${action.id.slice(0, 8)} cash-out succeeded and finalized, but Home shows ${progress?.depositId ? "no refreshed progress" : "no linked deposit"}`);
    }
    if (!progress?.depositId) continue;
    const depositId = progress.depositId.toLowerCase();
    const other = linkedBy.get(depositId);
    if (other) fail("pending-not-spendable", `deposit ${depositId.slice(-6)} is linked to two cash-outs (${other.slice(0, 8)}, ${action.id.slice(0, 8)})`);
    linkedBy.set(depositId, action.id);
    if (rows.get(action.id)?.outcome === "succeeded" && own && own.depositId.toLowerCase() !== depositId) {
      fail("records-match-receipts", `${action.id.slice(0, 8)} linked to deposit ${depositId.slice(-6)}, but its own receipt created ${own.depositId.slice(-6)}`);
    }
    const order = orders.find((entry) => entry.depositId.toLowerCase() === depositId);
    if (!order) { fail("balances-match-chain", `${action.id.slice(0, 8)} linked to deposit ${depositId.slice(-6)}, which is not in escrow`); continue; }
    if (order.totalAmount !== action.amount) fail("balances-match-chain", `${action.id.slice(0, 8)} of ${action.amount} linked to a ${order.totalAmount} deposit`);
    if (!progress.progressConfirmed) continue;
    const returned = BigInt(progress.returnedAtomic ?? "0");
    const remaining = BigInt(progress.remainingAtomic ?? "0");
    if (returned > order.returnedAmount) fail("balances-match-chain", `${action.id.slice(0, 8)} Home shows ${returned} returned, escrow returned ${order.returnedAmount}`);
    if (returned + remaining !== order.totalAmount) fail("balances-match-chain", `${action.id.slice(0, 8)} Home's returned + remaining ${returned + remaining} != deposit ${order.totalAmount}`);
    if (final && returned !== order.returnedAmount) fail("actions-resolve", `${action.id.slice(0, 8)} Home still shows ${returned} returned after finality; escrow returned ${order.returnedAmount}`);
  }

  let read: Awaited<ReturnType<HomeOwner["balances"]>> | null = null;
  // A read that times out while the local fork is fetching cold state is retried once; a second failure counts.
  try { read = await home.balances(); } catch {
    try { read = await home.balances(); } catch (error) { fail("balances-match-chain", `balances read failed twice: ${String(error).slice(0, 120)}`); }
  }
  if (read) {
    const block = BigInt(read.block.number);
    if (block !== latest) fail("pending-not-spendable", `balances pinned to block ${block}, latest mined is ${latest}`);
    const usdc = read.holdings.find((holding) => holding.id === "usdc");
    const shares = read.holdings.find((holding) => holding.contractAddress?.toLowerCase() === SAVE_VAULT.toLowerCase());
    const chainUsdc = await chain.usdcBalance(wallet.address, block);
    const chainShares = await chain.vaultShares(wallet.address, block);
    if (usdc?.balance.status !== "ready" || BigInt(usdc.balance.baseUnits) !== chainUsdc) {
      fail("balances-match-chain", `USDC home=${usdc?.balance.baseUnits ?? "unavailable"} chain=${chainUsdc}`);
    }
    if (shares?.balance.status !== "ready" || BigInt(shares.balance.baseUnits) !== chainShares) {
      fail("balances-match-chain", `Save shares home=${shares?.balance.baseUnits ?? "unavailable"} chain=${chainShares}`);
    }
    const landedOk = actions.filter((action) => wallet.get(action.id ?? "")?.landing?.success);
    const sent = landedOk.reduce((sum, action) => action.kind === "send" ? sum + action.amount : sum, BigInt(0));
    const credited = await chain.usdcBalance(RECIPIENT, block) - recipientStart;
    if (credited !== sent) fail("balances-match-chain", `recipient credited ${credited}, landed sends total ${sent}`);
    // Conservation: spendable USDC moved only through landed actions' own receipts; Home's confirmed rows never exceed it.
    const moved = wallet.all().reduce((sum, dispatch) => sum + (dispatch.landing?.usdcDelta ?? BigInt(0)), BigInt(0));
    if (chainUsdc !== FUNDING + moved) fail("pending-not-spendable", `harness: chain USDC ${chainUsdc}, funding plus landed receipts ${FUNDING + moved}`);
    const spent = landedOk.reduce((sum, action) => expectedUsdc(action) < BigInt(0) ? sum - expectedUsdc(action) : sum, BigInt(0));
    if (confirmedSpend > spent) fail("pending-not-spendable", `Home shows ${confirmedSpend} confirmed spend, landed spends total ${spent}`);
  }
  return out;
}

function spend(item: Record<string, unknown>): bigint {
  const summary = item.summary as { amounts?: Array<{ direction?: string; amountBaseUnits?: string; symbol?: string }> } | undefined;
  return (summary?.amounts ?? []).reduce((sum, amount) => amount.direction === "spend" && amount.symbol === "USDC"
    ? sum + BigInt(amount.amountBaseUnits ?? "0") : sum, BigInt(0));
}
