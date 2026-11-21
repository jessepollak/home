import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createPrepareActionHandler } from "@/server/actions/prepare";
import {
  createConfirmActionHandler, createDeclineActionHandler, createHandleActionHandler, createListActionsHandler, createRetryActionHandler,
} from "@/server/actions/handler";
import { settleOpenActionsForAccounts } from "@/server/actions/follow-through";
import { createPrepareSavingsAction } from "@/server/savings/prepare";
import { readBalances } from "@/server/balances/read";
import { getBalancesUniverse } from "@/server/balances/universe";
import type { Address } from "viem";

const ORIGIN = "http://home-money-sim.local";
export type HomeResponse = { status: number; body: Record<string, unknown> };

/**
 * Home's real route handlers for one simulated owner. Stand-ins: the session authorizer returns the seeded owner's
 * verified session; Next `after()` is replaced by a queue the simulation drains; Save prepare skips the Morpho
 * GraphQL discovery-rate read (review metadata only).
 */
export class HomeOwner {
  private readonly scheduled: Array<() => Promise<unknown>> = [];
  private readonly authorize: () => Promise<VerifiedAccountSession>;
  private readonly handlers;
  private virtualNow = Date.now();

  constructor(readonly subject: string, readonly address: Address) {
    const session: VerifiedAccountSession = {
      user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded",
    };
    this.authorize = async () => session;
    this.handlers = {
      prepare: createPrepareActionHandler({ authorize: this.authorize, prepareSavings: createPrepareSavingsAction() }),
      confirm: createConfirmActionHandler({ authorize: this.authorize }),
      handle: createHandleActionHandler({
        authorize: this.authorize,
        schedule: (task) => { this.scheduled.push(task); },
        // A clock that jumps past the 45 s loop deadline after each read, so each drained task runs Home's
        // follow-through step exactly once instead of sleeping between attempts.
        followDeps: { now: () => (this.virtualNow += 46_000) },
      }),
      decline: createDeclineActionHandler({ authorize: this.authorize }),
      retry: createRetryActionHandler({ authorize: this.authorize }),
      list: createListActionsHandler({ authorize: this.authorize }),
    };
  }

  async prepare(kind: string, params: Record<string, unknown>): Promise<HomeResponse> {
    return await call(this.handlers.prepare(post("/api/actions/prepare", { kind, params })));
  }
  async confirm(id: string): Promise<HomeResponse> {
    return await call(this.handlers.confirm(post(`/api/actions/${id}/confirm`, {}), ctx(id)));
  }
  async handle(id: string, body: { providerHandle?: string; transactionHash?: string }): Promise<HomeResponse> {
    return await call(this.handlers.handle(post(`/api/actions/${id}/handle`, body), ctx(id)));
  }
  async decline(id: string, attempt: number): Promise<HomeResponse> {
    return await call(this.handlers.decline(post(`/api/actions/${id}/decline`, { version: 1, attempt }), ctx(id)));
  }
  async retry(id: string, attempt: number): Promise<HomeResponse> {
    return await call(this.handlers.retry(post(`/api/actions/${id}/retry`, { version: 1, attempt }), ctx(id)));
  }
  async list(): Promise<HomeResponse> {
    return await call(this.handlers.list(new Request(`${ORIGIN}/api/actions`)));
  }

  /** Runs every follow-through task the handle route scheduled (the `after()` stand-in). */
  async drainScheduled(): Promise<number> {
    const tasks = this.scheduled.splice(0);
    for (const task of tasks) await task();
    return tasks.length;
  }

  /** The chain-activity trigger: what a verified CDP wallet-activity webhook delivery schedules for this address. */
  async webhook(): Promise<void> {
    await settleOpenActionsForAccounts([this.address], { signal: new AbortController().signal, route: "/api/webhooks/sim" });
  }

  async balances() {
    return await readBalances(await getBalancesUniverse(), this.address);
  }
}

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function call(response: Promise<Response>): Promise<HomeResponse> {
  const resolved = await response;
  const text = await resolved.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = { raw: text.slice(0, 200) }; }
  return { status: resolved.status, body };
}
