import "server-only";

import type { BASE_USDC } from "@/shared/assets/base";
import type { CardPurchase } from "@/shared/cards/transactions-contract";
import type { RevealRequest, RevealGrant } from "@/shared/cards/contract";
import type { CardMode, CardProviderName, CardEventSource, CardObservation } from "./provider";

export type CardFunding =
  | Readonly<{ strategy: "allowance-pull"; chainId: 8453; token: typeof BASE_USDC; spender: `0x${string}`;
      retired: readonly `0x${string}`[]; maximumBaseUnits: string | null; prerequisitesMet: boolean }>
  | Readonly<{ strategy: "deposit" }>;
export type ProgramLink = Readonly<{ customerId: string; mode: CardMode; accountId: string | null; cardholderId: string | null }>;
export type ProgramAccount = Readonly<{
  status: "verification-required" | "verification-pending" | "ready" | "ineligible" | "restricted" | "unavailable";
  cardholderId: string | null;
  link: Partial<Pick<ProgramLink, "cardholderId">>;
}>;
export type ProgramCard = Readonly<{ providerCardId: string; cardholderId: string | null; last4: string;
  status: "active" | "frozen" | "restricted" | "canceled" }>;
export type ProgramCardRead = Readonly<{ providerCardId: string } & ({ ok: true; card: ProgramCard } | { ok: false })>;
export type EnrollResult = Readonly<{ link: Partial<Pick<ProgramLink, "accountId" | "cardholderId">> }>;
export type ProgramPurchase = CardPurchase & Readonly<{ cardId: string; authorizationId: string | null }>;
export type PurchaseRef = Readonly<{ id: string; kind: "authorization" | "transaction" }>;
export type CardProgram = Readonly<{
  provider: CardProviderName;
  mode: CardMode;
  funding: CardFunding;
  enrollmentHosts: readonly string[];
  readAccount(link: ProgramLink, signal?: AbortSignal): Promise<ProgramAccount>;
  readCards(link: ProgramLink, ids: readonly string[], signal?: AbortSignal): Promise<readonly ProgramCardRead[]>;
  enroll(link: ProgramLink, request: { customerId: string; idempotencyKey: string }): Promise<EnrollResult>;
  enrollmentNext(link: ProgramLink, request: { redirectUri: string }): Promise<{ kind: "redirect"; url: string } | { kind: "complete" }>;
  issue(link: ProgramLink, wallet: `0x${string}`, idempotencyKey: string): Promise<ProgramCard>;
  setFrozen(link: ProgramLink, id: string, frozen: boolean, idempotencyKey: string): Promise<ProgramCard>;
  reveal(link: ProgramLink, id: string, request: RevealRequest): Promise<RevealGrant>;
  purchases: Readonly<{
    read(ref: PurchaseRef, signal?: AbortSignal): Promise<ProgramPurchase>;
    list(id: string, since: Date, signal?: AbortSignal): Promise<{ rows: ProgramPurchase[]; partial: boolean }>;
    refFor(event: CardObservation): PurchaseRef | null;
  }>;
  events: readonly CardEventSource[];
}>;
