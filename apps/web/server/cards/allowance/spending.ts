import "server-only";

import { encodeFunctionData, erc20Abi } from "viem";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { baseRpc, parseRpcDataWord, parseRpcQuantity, type BaseRpcOptions } from "@/server/chain/rpc";
import { privateJson } from "@/server/http/private-response";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { CARD_ALLOWANCE_CONTRACT_VERSION, parseCardSpendingResponse, type CardSpendingError, type CardSpendingResponse } from "@/shared/cards/allowance-contract";
import { readCardAllowanceRegistry, type CardAllowanceRegistry } from "./config";
import { programFor } from "../programs";
import { resolveCustomer } from "@/server/customers/resolve";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

type Rpc = (method: string, params: readonly unknown[], options?: BaseRpcOptions) => Promise<unknown>;
type Dependencies = {
  authorize: SessionAuthorizer;
  registry: () => CardAllowanceRegistry | null;
  programFor: typeof programFor;
  customer: (session: VerifiedAccountSession) => Promise<{ id: string } | null>;
  rpc: Rpc;
  now: () => string;
  deadline: () => AbortSignal;
};

export function createCardSpendingHandler(deps: Partial<Dependencies> = {}) {
  const authorize = deps.authorize ?? authorizeSession;
  const registry = deps.registry ?? readCardAllowanceRegistry;
  const resolveProgram = deps.programFor ?? programFor;
  const customer = deps.customer ?? ((session: VerifiedAccountSession) => resolveCustomer(session, { create: false }));
  const rpc = deps.rpc ?? baseRpc;
  const deadline = deps.deadline ?? (() => AbortSignal.timeout(5_000));
  const now = deps.now ?? (() => new Date().toISOString());

  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) {
      const error = { version: CARD_ALLOWANCE_CONTRACT_VERSION, error: { code: "CARDS_UNAVAILABLE" } } satisfies CardSpendingError;
      return privateJson(error, 503);
    }
    const unavailable = (): CardSpendingResponse => ({ version: 1, status: "unavailable", fetchedAt: now() });
    let response: CardSpendingResponse;
    try {
      const configured = registry();
      if (!configured) {
        response = { version: 1, status: "not-configured" };
      } else {
        let setEnabled = false;
        try {
          const owner = await customer(session);
          const program = owner ? await resolveProgram(owner.id, configured.bridge.mode, request.signal) : null;
          if (program && program.funding.strategy !== "allowance-pull") return privateJson({ version: 1, status: "not-configured" } satisfies CardSpendingResponse);
          setEnabled = program?.provider === "bridge" && program.mode === "production" && configured.bridge.mode === "production" && program.funding.strategy === "allowance-pull" &&
            program.funding.prerequisitesMet && configured.maximumBaseUnits !== null;
        } catch { setEnabled = false; }
        const signal = AbortSignal.any([request.signal, deadline()]);
        const options = { signal, timeoutMs: 5_000 };
        const block = parseRpcQuantity(await rpc("eth_blockNumber", [], options), "block number");
        signal.throwIfAborted();
        const blockTag = `0x${block.toString(16)}`;
        const wallet = session.smartAccount.address;
        const [balance, allowance, ...retiredValues] = await Promise.all([
          rpc("eth_call", [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [wallet] }) }, blockTag], options),
          rpc("eth_call", [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [wallet, configured.current] }) }, blockTag], options),
          ...configured.retired.map((spender) => rpc("eth_call", [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [wallet, spender] }) }, blockTag], options)),
        ]);
        signal.throwIfAborted();
        const walletAmount = parseRpcDataWord(balance, "wallet balance");
        const allowanceAmount = parseRpcDataWord(allowance, "card allowance");
        response = { version: 1, status: "available", setEnabled, spender: configured.current, walletBaseUnits: walletAmount.toString(),
          allowanceBaseUnits: allowanceAmount.toString(), availableBaseUnits: (walletAmount < allowanceAmount ? walletAmount : allowanceAmount).toString(),
          retired: configured.retired.map((spender, index) => ({ spender, allowanceBaseUnits: parseRpcDataWord(retiredValues[index], "retired card allowance").toString() })),
          blockNumber: block.toString(), fetchedAt: now() };
      }
    } catch {
      response = unavailable();
    }
    return privateJson(parseCardSpendingResponse(response) ? response : unavailable());
  };
}

export const cardSpendingHandler = createCardSpendingHandler();
