import { createHash } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  MoneyActionOwner,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { moneyActionOwner } from "@/server/money-actions/session";
import {
  appendPermit2Signature,
  recoverTradeSigner,
  wrapSmartAccountSignature,
} from "./permit2";
import {
  MAX_QUOTE_BLOCK_LAG,
  TradePreparationError,
} from "./prepare";
import type {
  FinalizeTradeDependencies,
  FinalizeTradeInput,
  TradeIntent,
  TradeIntentStore,
  TradeBalanceReader,
  Permit2StateReader,
  TradeSignerResolver,
} from "@/shared/trading/server-types";

const MAX_QUOTE_BLOCK_LEAD = BigInt(2);

export async function finalizeTradeAction(
  dependencies: FinalizeTradeDependencies,
  input: FinalizeTradeInput,
): Promise<PreparedMoneyAction> {
  const now = dependencies.now ?? (() => new Date());
  const currentTime = now();
  if (Number.isNaN(currentTime.getTime())) unavailable();
  const owner = moneyActionOwner(input.session);
  if (!owner) unsupported();
  const intent = await dependencies.intentStore.get(owner, input.intentId);
  if (!intent || intent.intentHash !== input.intentHash) invalid();
  assertLiveIntent(intent, currentTime);

  const signer = await dependencies.resolveSigner(input.httpRequest, input.session, input.signal);
  if (!sameSigner(signer, intent.signer)) unsupported();
  await assertFreshExecutionState(dependencies, intent, input.signal);

  const wrapper = input.session.accountProvider === "base-account"
    ? input.signature
    : await recoverAndWrapEoaSignature(intent, input.signature);
  if (
    intent.signer.deployed &&
    !(await dependencies.verifySmartAccountSignature({
      smartAccount: intent.owner.address,
      permitHash: intent.permitHash,
      wrapper,
      signal: input.signal,
    }))
  ) invalid();

  const swapCall = intent.draft.calls[intent.swapCallIndex];
  if (!swapCall || swapCall.approval) invalid();
  const calls = intent.draft.calls.map((call, index) =>
    index === intent.swapCallIndex
      ? { ...call, data: appendPermit2Signature(call.data, wrapper) }
      : { ...call },
  );
  const signatureDigest = createHash("sha256")
    .update(input.signature.toLowerCase())
    .digest("hex");
  const bound = await dependencies.intentStore.bindFinalAction({
    owner,
    id: intent.id,
    intentHash: intent.intentHash,
    finalActionId: intent.reservedActionId,
    signatureDigest,
  });
  if (!bound) invalid();

  let action: PreparedMoneyAction;
  try {
    action = await dependencies.issueAction(
      input.session,
      { ...intent.draft, calls },
      {
        actionId: intent.reservedActionId,
        createdAt: intent.reservedActionCreatedAt,
        sensitivePayloadExpiresAt: intent.expiresAt,
      },
    );
  } catch (error) {
    throw new TradePreparationError("provider-unavailable", error);
  }
  if (action.id !== intent.reservedActionId) invalid();
  return action;
}

export function createTradePreclaimValidator(dependencies: {
  intentStore: TradeIntentStore;
  resolveSigner: TradeSignerResolver;
  readBalance: TradeBalanceReader;
  readPermit2State: Permit2StateReader;
}) {
  return async function validateBeforeClaim(input: {
    request: Request;
    owner: MoneyActionOwner;
    action: PreparedMoneyAction;
    now: string;
  }): Promise<void> {
    if (input.action.kind !== "swap") return;
    const intent = await dependencies.intentStore.getByFinalActionId(input.owner, input.action.id);
    if (!intent || intent.finalActionId !== input.action.id || intent.quoteId !== input.action.quoteId) {
      invalid();
    }
    const currentTime = new Date(input.now);
    if (Number.isNaN(currentTime.getTime())) unavailable();
    assertLiveIntent(intent, currentTime);
    const session: VerifiedAccountSession = {
      user: { subject: input.owner.subject },
      smartAccount: { address: input.owner.address, chainId: 8453 },
      accountProvider: input.owner.accountProvider,
    };
    const signer = await dependencies.resolveSigner(input.request, session, input.request.signal);
    if (!sameSigner(signer, intent.signer)) unsupported();
    await assertFreshExecutionState(dependencies, intent, input.request.signal);
  };
}

async function assertFreshExecutionState(
  dependencies: Pick<FinalizeTradeDependencies, "readBalance" | "readPermit2State">,
  intent: TradeIntent,
  signal?: AbortSignal,
): Promise<void> {
  const balance = await dependencies.readBalance(
    intent.owner.address,
    intent.sellToken,
    signal,
  );
  if (
    balance.address !== intent.owner.address ||
    balance.token !== intent.sellToken ||
    balance.balance < BigInt(intent.spendAmount)
  ) throw new TradePreparationError("insufficient-balance");
  const nonceState = await dependencies.readPermit2State(
    intent.owner.address,
    BigInt(intent.permit.message.nonce),
    signal,
  );
  if (nonceState.used) throw new TradePreparationError("permit-used");
  const quoteBlock = BigInt(intent.quoteBlockNumber);
  const currentBlock = balance.blockNumber > nonceState.blockNumber
    ? balance.blockNumber
    : nonceState.blockNumber;
  if (
    quoteBlock + MAX_QUOTE_BLOCK_LAG < currentBlock ||
    quoteBlock > currentBlock + MAX_QUOTE_BLOCK_LEAD
  ) throw new TradePreparationError("stale-quote");
}

function assertLiveIntent(intent: TradeIntent, now: Date): void {
  const nowMs = now.getTime();
  const deadlineMs = Number(BigInt(intent.permitDeadline) * BigInt(1000));
  if (
    Date.parse(intent.expiresAt) <= nowMs ||
    deadlineMs <= nowMs ||
    Date.parse(intent.createdAt) > nowMs ||
    Date.parse(intent.reservedActionCreatedAt) > nowMs
  ) throw new TradePreparationError("permit-expired");
}

async function recoverAndWrapEoaSignature(
  intent: TradeIntent,
  signature: FinalizeTradeInput["signature"],
) {
  const recovered = await recoverTradeSigner(intent.signingTypedData, signature);
  if (recovered !== intent.signer.signerAddress) invalid();
  return wrapSmartAccountSignature(intent.signer.ownerIndex, signature);
}

function sameSigner(
  left: TradeIntent["signer"],
  right: TradeIntent["signer"],
): boolean {
  return left.smartAccount === right.smartAccount &&
    left.signerAddress === right.signerAddress &&
    left.ownerIndex === right.ownerIndex &&
    left.deployed === right.deployed;
}

function invalid(): never {
  throw new TradePreparationError("invalid-finalization");
}

function unsupported(): never {
  throw new TradePreparationError("signer-unsupported");
}

function unavailable(): never {
  throw new TradePreparationError("provider-unavailable");
}
