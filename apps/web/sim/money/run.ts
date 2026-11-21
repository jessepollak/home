import { setSystemTime } from "bun:test";
import type { SQL } from "bun";
import type { Address, Hex } from "viem";
import { actionOwnerKey } from "@/server/actions/store";
import { Chain, SAVE_VAULT, SimWallet, type Call, type DispatchMode } from "./chain";
import { HomeOwner, type HomeResponse } from "./home";
import type { Invariant } from "./invariants";

export type Violation = { invariant: Invariant; step: number; detail: string };
type Kind = "send" | "savings-deposit";
type Faults = { lostHandle: boolean; revert: DispatchMode; doubleConfirm: boolean; declineRetry: boolean; hashHint: boolean };
type Stage = "prepare" | "confirm" | "decline" | "dispatch" | "handle" | "hint" | "done";
type SimAction = {
  index: number; kind: Kind; amount: bigint; faults: Faults; stage: Stage;
  id?: string; calls?: Call[]; userOpHash?: Hex; handlePosted: boolean; prepareRefused?: string; dispatchUnknown?: boolean; minShares?: bigint;
};
export type RunResult = {
  seed: number; violations: Violation[]; actions: number; kinds: Record<Kind, number>;
  faults: { lostHandle: number; innerRevert: number; bundleRevert: number; doubleConfirm: number; declineRetry: number };
  landed: { succeeded: number; reverted: number }; prepareRefused: number; maxInFlight: number; lostHandleUnresolved: number;
  doubleConfirmBothAccepted: number; steps: number;
};

const FUNDING = BigInt(100_000_000);
const FINALITY_BLOCKS = 70;
const RECIPIENT: Address = "0x000000000000000000000000000000000000dEaD";

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

export async function simulateRun(input: { seed: number; chain: Chain; clock: VirtualClock; db: SQL; bundler: Address }): Promise<RunResult> {
  const { seed, chain, clock, db, bundler } = input;
  const random = rng(seed);
  const pick = (p: number) => random() < p;
  const violations: Violation[] = [];
  let step = 0;
  const mine = async (blocks: number) => { await chain.mine(blocks); await clock.syncTo(chain); };

  await clock.syncTo(chain);
  const wallet = await SimWallet.create(chain, seed, bundler);
  await chain.fundUsdc(wallet.address, FUNDING);
  await mine(1);
  const home = new HomeOwner(`sim-${seed}`, wallet.address);
  const recipientStart = await chain.usdcBalance(RECIPIENT);
  const ownerKey = actionOwnerKey({ subject: `sim-${seed}`, address: wallet.address, chainId: 8453, accountProvider: "cdp-embedded" });

  const count = 2 + Math.floor(random() * 4);
  const actions: SimAction[] = Array.from({ length: count }, (_, index) => {
    const revertRoll = random();
    return {
      index,
      kind: pick(0.5) ? "send" : "savings-deposit",
      amount: BigInt(1 + Math.floor(random() * 40)) * BigInt(1_000_000) + BigInt(Math.floor(random() * 100)) * BigInt(10_000),
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
  let maxInFlight = 0;
  let doubleConfirmBothAccepted = 0;

  const check = async (final: boolean) => {
    await wallet.observe();
    const found = await checkInvariants({ chain, wallet, home, db, ownerKey, actions, final, recipientStart });
    for (const finding of found) violations.push({ ...finding, step });
  };

  const advance = async (action: SimAction): Promise<boolean> => {
    switch (action.stage) {
      case "prepare": {
        const params = action.kind === "send"
          ? { assetId: "usdc", recipient: RECIPIENT, amountBaseUnits: action.amount.toString() }
          : { vaultAddress: SAVE_VAULT, amountBaseUnits: action.amount.toString() };
        const available = await chain.usdcBalance(wallet.address);
        const response = await home.prepare(action.kind, params);
        if (response.status !== 201 || typeof response.body.id !== "string") {
          action.prepareRefused = `${response.status} ${String(response.body.code ?? "")}`;
          // Save prepare simulates the deposit at the latest block, so it may refuse an amount the account no longer holds.
          // Any other refusal means Home turned away an action the chain would have accepted.
          if (!(action.kind === "savings-deposit" && action.amount > available)) {
            violations.push({ invariant: "actions-resolve", step, detail: `${action.kind} of ${action.amount} refused at prepare (${action.prepareRefused}) with ${available} available` });
          }
          action.stage = "done";
          return true;
        }
        action.id = response.body.id;
        const metadata = response.body.metadata as { minimumSharesBaseUnits?: string } | undefined;
        if (action.kind === "savings-deposit") action.minShares = BigInt(metadata?.minimumSharesBaseUnits ?? "0");
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
          doubleConfirmBothAccepted += 1;
          const keys = new Set(accepted.map((response) => JSON.stringify(response.body.calls)));
          if (keys.size > 1) violations.push({ invariant: "pending-not-spendable", step, detail: `double confirm returned different calls for ${id}` });
        }
        if (!accepted.length) {
          action.prepareRefused = `confirm ${responses.map((response) => response.status).join("/")}`;
          violations.push({ invariant: "actions-resolve", step, detail: `${id.slice(0, 8)} confirm refused (${action.prepareRefused})` });
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
        if (retry.status !== 200) violations.push({ invariant: "records-match-receipts", step, detail: `retry after decline returned ${retry.status}` });
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
        if (response.status !== 200) violations.push({ invariant: "records-match-receipts", step, detail: `handle post returned ${response.status}` });
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

  await check(false);
  for (let guard = 0; guard < 200; guard++) {
    const live = actions.filter((action) => action.stage !== "done");
    if (!live.length) break;
    const inFlight = actions.filter((action) => action.id && action.stage !== "prepare" && !(wallet.get(action.id)?.landing)).length;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const roll = random();
    step += 1;
    if (roll < 0.62) {
      const action = live[Math.floor(random() * live.length)]!;
      if (!await advance(action)) await mine(1);
    } else if (roll < 0.8) {
      await mine(1 + Math.floor(random() * 3));
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
  step += 1;
  await check(true);

  const landings = wallet.all().map((dispatch) => dispatch.landing).filter((landing) => landing !== null);
  const rows = await readRows(db, ownerKey);
  return {
    seed,
    violations,
    actions: actions.length,
    kinds: { send: actions.filter((a) => a.kind === "send").length, "savings-deposit": actions.filter((a) => a.kind === "savings-deposit").length },
    faults: {
      lostHandle: actions.filter((a) => a.faults.lostHandle && a.userOpHash).length,
      innerRevert: actions.filter((a) => a.faults.revert === "inner-revert" && a.userOpHash).length,
      bundleRevert: actions.filter((a) => a.faults.revert === "bundle-revert" && a.userOpHash).length,
      doubleConfirm: actions.filter((a) => a.faults.doubleConfirm && a.calls).length,
      declineRetry: actions.filter((a) => a.faults.declineRetry && a.calls).length,
    },
    landed: { succeeded: landings.filter((l) => l.success).length, reverted: landings.filter((l) => !l.success).length },
    prepareRefused: actions.filter((a) => a.prepareRefused).length,
    maxInFlight,
    lostHandleUnresolved: actions.filter((a) => a.faults.lostHandle && a.id && !rows.get(a.id)?.outcome).length,
    doubleConfirmBothAccepted,
    steps: step,
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

async function checkInvariants(input: {
  chain: Chain; wallet: SimWallet; home: HomeOwner; db: SQL; ownerKey: string; actions: SimAction[]; final: boolean; recipientStart: bigint;
}): Promise<Array<Omit<Violation, "step">>> {
  const { chain, wallet, home, db, ownerKey, actions, final, recipientStart } = input;
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

  const list = await home.list();
  const items = Array.isArray(list.body.actions) ? list.body.actions as Array<Record<string, unknown>> : [];
  if (list.status !== 200) fail("records-match-receipts", `GET /api/actions returned ${list.status}`);
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  let confirmedSpend = BigInt(0);
  for (const item of items) {
    const id = String(item.id);
    if (seenIds.has(id)) fail("pending-not-spendable", `${id.slice(0, 8)} listed twice`);
    seenIds.add(id);
    if (typeof item.transactionHash === "string") {
      if (seenHashes.has(item.transactionHash) ) fail("pending-not-spendable", `transaction ${item.transactionHash.slice(0, 10)} listed under two actions`);
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
      if (!action.handlePosted || !action.id) continue;
      const row = rows.get(action.id);
      const landing = wallet.get(action.id)?.landing;
      if (!landing) fail("actions-resolve", `${action.id.slice(0, 8)} was dispatched and its handle posted, but never landed`);
      if (landing && !row?.outcome) fail("actions-resolve", `${action.id.slice(0, 8)} landed (success=${landing.success}) but no outcome recorded`);
    }
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
    const minShares = landedOk.reduce((sum, action) => sum + (action.minShares ?? BigInt(0)), BigInt(0));
    if (chainShares < minShares) fail("balances-match-chain", `Save shares ${chainShares} below the ${minShares} landed deposits promised`);
    // Conservation: everything that left spendable USDC is a landed, succeeded action; Home's confirmed rows never exceed it.
    const landedSpend = actions.reduce((sum, action) => wallet.get(action.id ?? "")?.landing?.success ? sum + action.amount : sum, BigInt(0));
    const chainSpent = FUNDING - chainUsdc;
    if (chainSpent !== landedSpend && block === latest) fail("pending-not-spendable", `harness: chain spent ${chainSpent}, landed actions ${landedSpend}`);
    if (confirmedSpend > chainSpent) fail("pending-not-spendable", `Home shows ${confirmedSpend} confirmed spend, chain moved ${chainSpent}`);
  }
  return out;
}

function spend(item: Record<string, unknown>): bigint {
  const summary = item.summary as { amounts?: Array<{ direction?: string; amountBaseUnits?: string; symbol?: string }> } | undefined;
  return (summary?.amounts ?? []).reduce((sum, amount) => amount.direction === "spend" && amount.symbol === "USDC"
    ? sum + BigInt(amount.amountBaseUnits ?? "0") : sum, BigInt(0));
}
