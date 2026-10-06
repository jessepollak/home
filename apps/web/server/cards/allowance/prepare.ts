import "server-only";

import { encodeFunctionData, erc20Abi, formatUnits, isAddress } from "viem";
import { BASE_USDC } from "@/shared/assets/base";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { CARD_ALLOWANCE_PREPARE_ERRORS, parseCardAllowancePrepareParams, type CardAllowancePrepareErrorReason } from "@/shared/cards/allowance-contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { baseRpc, parseRpcDataWord, parseRpcQuantity, type BaseRpcOptions } from "@/server/chain/rpc";
import { resolveCustomer } from "@/server/customers/resolve";
import { getSqlExecutor } from "@/server/db/sql";
import { createCardAccountStore, type CardAccountLink } from "../account-store";
import { readCardState } from "../journey";
import { programFor } from "../programs";
import { readCardAllowanceRegistry, type CardAllowanceRegistry } from "./config";

export class CardAllowancePreparationError extends Error {
  readonly code: (typeof CARD_ALLOWANCE_PREPARE_ERRORS)[CardAllowancePrepareErrorReason]["code"];
  readonly status: number;
  constructor(reason: CardAllowancePrepareErrorReason) {
    const { code, status } = CARD_ALLOWANCE_PREPARE_ERRORS[reason];
    super({ unavailable: "Card spending limits are unavailable right now. Try again.", "not-ready": "An eligible card is required.",
      invalid: "Use a valid card spender and spending limit.", unchanged: "This card spending limit is already in place." }[reason]);
    this.code = code;
    this.status = status;
  }
}

type Rpc = (method: string, params: readonly unknown[], options?: BaseRpcOptions) => Promise<unknown>;
type Dependencies = {
  registry?: () => CardAllowanceRegistry | null;
  programFor?: typeof programFor;
  customer?: (session: VerifiedAccountSession, signal?: AbortSignal) => Promise<{ id: string; walletId: string | null } | null>;
  account?: (customerId: string, mode: "sandbox" | "production", signal?: AbortSignal) => Promise<CardAccountLink | null>;
  state?: (customerId: string, mode: "sandbox" | "production", signal?: AbortSignal) => ReturnType<typeof readCardState>;
  rpc?: Rpc;
};

export function createCardAllowanceEligibility(deps: Pick<Dependencies, "customer" | "account" | "state" | "programFor"> = {}) {
  const resolveProgram = deps.programFor ?? programFor;
  const customer = deps.customer ?? ((session: VerifiedAccountSession, signal?: AbortSignal) => resolveCustomer(session, { create: false, signal }));
  const account = deps.account ?? ((id: string, mode: "sandbox" | "production", signal?: AbortSignal) => createCardAccountStore(getSqlExecutor()).read(id, mode, signal));
  const state = deps.state ?? ((id: string, mode: "sandbox" | "production", signal?: AbortSignal) => {
    return readCardState(id, mode, { store: createCardAccountStore(getSqlExecutor()), programFor: resolveProgram }, signal);
  });
  return async (session: VerifiedAccountSession, mode: "sandbox" | "production", signal?: AbortSignal): Promise<void> => {
    try {
      signal?.throwIfAborted();
      const resolved = await customer(session, signal);
      signal?.throwIfAborted();
      if (!resolved?.walletId) throw new CardAllowancePreparationError("not-ready");
      const program = await resolveProgram(resolved.id, mode, signal);
      signal?.throwIfAborted();
      if (!program || program.provider !== "bridge" || program.mode !== mode || program.funding.strategy !== "allowance-pull" || !program.funding.prerequisitesMet)
        throw new CardAllowancePreparationError("unavailable");
      const link = await account(resolved.id, mode, signal);
      signal?.throwIfAborted();
      const wallet = session.smartAccount?.address.toLowerCase();
      if (!link || link.provider !== "bridge" || !wallet || !link.cards.some((card) => card.walletAddress.toLowerCase() === wallet))
        throw new CardAllowancePreparationError("not-ready");
      const cardState = await state(resolved.id, mode, signal);
      signal?.throwIfAborted();
      if (cardState.state === "unavailable") throw new CardAllowancePreparationError("unavailable");
      const eligible = link.cards.some((card) => card.walletAddress.toLowerCase() === wallet &&
        cardState.cards.some((fresh) => fresh.id === card.id && (fresh.status === "active" || fresh.status === "frozen")));
      if (!eligible || (cardState.state !== "active" && cardState.state !== "frozen")) throw new CardAllowancePreparationError("not-ready");
    } catch (error) {
      if (signal?.aborted) throw new CardAllowancePreparationError("unavailable");
      if (error instanceof CardAllowancePreparationError) throw error;
      throw new CardAllowancePreparationError("unavailable");
    }
  };
}

export const checkCardAllowanceEligibility = createCardAllowanceEligibility();

export function createCardAllowancePreparation(deps: Dependencies = {}) {
  const registry = deps.registry ?? readCardAllowanceRegistry;
  const eligible = createCardAllowanceEligibility(deps);
  const rpc = deps.rpc ?? baseRpc;

  return async (session: VerifiedAccountSession, input: unknown, signal?: AbortSignal): Promise<MoneyActionDraft> => {
    const params = parseCardAllowancePrepareParams(input);
    if (!params) throw new CardAllowancePreparationError("invalid");
    if (!session.smartAccount) throw new CardAllowancePreparationError("unavailable");
    let configured: CardAllowanceRegistry | null;
    try { configured = registry(); }
    catch { throw new CardAllowancePreparationError("unavailable"); }
    if (!configured) throw new CardAllowancePreparationError("unavailable");
    const set = params.operation === "set";
    if (set && (configured.bridge.mode !== "production" || !configured.maximumBaseUnits)) throw new CardAllowancePreparationError("unavailable");
    const spender = set ? configured.current : params.operation === "revoke" ? params.spender.toLowerCase() : null;
    if (!spender || !isAddress(spender)) throw new CardAllowancePreparationError("invalid");
    const token = BASE_USDC_ADDRESS.toLowerCase();
    if (!isAddress(token)) throw new CardAllowancePreparationError("unavailable");
    if (!set && spender !== configured.current && !configured.retired.includes(spender)) throw new CardAllowancePreparationError("invalid");
    const amount = set ? BigInt(params.allowanceBaseUnits) : BigInt(0);
    if (set && (!configured.maximumBaseUnits || amount === BigInt(0) || amount > BigInt(configured.maximumBaseUnits))) throw new CardAllowancePreparationError("invalid");
    if (set) await eligible(session, configured.bridge.mode, signal);
    let previous: bigint;
    let block: bigint;
    try {
      const deadline = AbortSignal.timeout(5_000);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      block = parseRpcQuantity(await rpc("eth_blockNumber", [], { signal: combined, timeoutMs: 5_000 }), "block number");
      const result = await rpc("eth_call", [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [session.smartAccount.address, spender] }) }, `0x${block.toString(16)}`], { signal: combined, timeoutMs: 5_000 });
      if (combined.aborted) throw new Error("Card allowance read expired");
      previous = parseRpcDataWord(result, "card allowance");
    } catch { throw new CardAllowancePreparationError("unavailable"); }
    if (previous === amount) throw new CardAllowancePreparationError("unchanged");
    const baseUnits = amount.toString();
    return {
      kind: "card-allowance",
      title: set ? "Set card spending limit" : "Remove card spending permission",
      calls: [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
        value: "0", approval: { assetId: BASE_USDC.id, spender } }],
      amounts: [],
      warnings: [set ? `Lets your card program (${spender}) spend up to ${formatUnits(amount, 6)} USDC from Cash for card purchases. You can change or turn this off at any time.` :
        `Removes this card program spender's (${spender}) permission to spend USDC from Cash. Other spenders keep their permissions.`],
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      metadata: { product: "card", operation: set ? "set-allowance" : "revoke-allowance", provider: "bridge",
        mode: configured.bridge.mode, token, spender,
        allowanceBaseUnits: baseUnits, previousAllowanceBaseUnits: previous.toString(),
        maximumBaseUnits: set ? configured.maximumBaseUnits : null, source: { blockNumber: block.toString() } },
    };
  };
}

export const prepareCardAllowanceAction = createCardAllowancePreparation();
