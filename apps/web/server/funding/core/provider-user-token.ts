import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { CreateOrderResult, OrderIntent, ProviderContext } from "@/shared/funding/provider-contract";
import { openSecret, resolveSecretKeyring, sealSecret, type SecretAad } from "@/server/secrets/at-rest";
import type { FundingUserTokenKey, FundingProviderUserTokenStore } from "./user-token-store";

export type ProviderUserTokenCreateOrder = (input: OrderIntent, credential: { userAuthToken: string | null }, ctx: ProviderContext) => Promise<{ result: CreateOrderResult; userAuthToken: string | null; credentialRejected: boolean }>;
export const USER_TOKEN_LOCAL_REUSE_MS = 55 * 24 * 60 * 60 * 1_000;
export type FundingUserTokenBinding = FundingUserTokenKey & { destination: string };
type FundingUserTokenCredential = { token: string; envelope: string };
type FundingUserTokenDispatchRead = { credential: FundingUserTokenCredential | null; expectedEnvelope: string | null };
export type FundingUserTokenDiagnostic = "key-unavailable" | "expired" | "unreadable" | "preserved-unreadable" | "capture-conflict" | "store-failure" | "cleared-after-rejection" | "rejection-clear-conflict" | "captured";
function aad(binding: FundingUserTokenBinding): SecretAad {
  return { purpose: "funding-provider-user-token", binding: { accountProvider: binding.owner.accountProvider, ownerSubject: binding.owner.subject, providerId: binding.providerId, region: binding.region, sandbox: String(binding.sandbox), destination: binding.destination.toLowerCase() } };
}
export function userTokenAad(binding: FundingUserTokenBinding): SecretAad { return aad(binding); }
const REJECTION_CLEAR_ATTEMPTS = 3;
function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8"), b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
export class FundingUserTokenVault {
  private readonly keyring: ReturnType<typeof resolveSecretKeyring>;
  constructor(private readonly deps: { store: FundingProviderUserTokenStore; env: Readonly<Record<string, string | undefined>>; now: () => Date; diagnose: (code: FundingUserTokenDiagnostic, binding: FundingUserTokenBinding) => void }) {
    this.keyring = resolveSecretKeyring(deps.env);
  }
  private diagnose(code: FundingUserTokenDiagnostic, binding: FundingUserTokenBinding): boolean { try { this.deps.diagnose(code, binding); return true; } catch { return false; } }
  async read(binding: FundingUserTokenBinding): Promise<FundingUserTokenCredential | null> {
    return (await this.readForDispatch(binding))?.credential ?? null;
  }
  async readForDispatch(binding: FundingUserTokenBinding): Promise<FundingUserTokenDispatchRead | null> {
    if (!this.keyring.ok) { this.diagnose("key-unavailable", binding); return null; }
    try {
      const row = await this.deps.store.get(binding);
      if (!row) return { credential: null, expectedEnvelope: null };
      if (row.destination !== binding.destination.toLowerCase()) return { credential: null, expectedEnvelope: row.envelope };
      if (Date.parse(row.returnedAt) + USER_TOKEN_LOCAL_REUSE_MS <= this.deps.now().getTime()) {
        const deleted = await this.deps.store.deleteIfEnvelope(binding, row.envelope);
        this.diagnose("expired", binding);
        return { credential: null, expectedEnvelope: deleted ? null : row.envelope };
      }
      const opened = openSecret(this.keyring.keyring, row.envelope, aad(binding));
      if (!opened.ok) { this.diagnose("unreadable", binding); return { credential: null, expectedEnvelope: row.envelope }; }
      return { credential: { token: opened.plaintext, envelope: row.envelope }, expectedEnvelope: row.envelope };
    } catch { this.diagnose("store-failure", binding); return null; }
  }
  async clearAfterRejection(binding: FundingUserTokenBinding, rejected: FundingUserTokenCredential): Promise<boolean> {
    try {
      let envelope = rejected.envelope;
      for (let attempt = 0; attempt < REJECTION_CLEAR_ATTEMPTS; attempt++) {
        if (await this.deps.store.deleteIfEnvelope(binding, envelope)) { this.diagnose("cleared-after-rejection", binding); return true; }
        const row = await this.deps.store.get(binding);
        if (!row) { this.diagnose("cleared-after-rejection", binding); return true; }
        if (!this.keyring.ok || row.destination !== binding.destination.toLowerCase()) break;
        const opened = openSecret(this.keyring.keyring, row.envelope, aad(binding));
        if (!opened.ok || !sameToken(opened.plaintext, rejected.token)) break;
        envelope = row.envelope;
      }
      this.diagnose("rejection-clear-conflict", binding);
      return false;
    } catch { this.diagnose("store-failure", binding); return false; }
  }
  async capture(binding: FundingUserTokenBinding, token: string, expectedEnvelope: string | null): Promise<boolean> {
    if (!this.keyring.ok) { this.diagnose("key-unavailable", binding); return false; }
    try {
      const row = await this.deps.store.get(binding);
      if ((row?.envelope ?? null) !== expectedEnvelope) { this.diagnose("capture-conflict", binding); return false; }
      const now = this.deps.now();
      const live = row !== null && Date.parse(row.returnedAt) + USER_TOKEN_LOCAL_REUSE_MS > now.getTime();
      const existing = row && live ? openSecret(this.keyring.keyring, row.envelope, aad({ ...binding, destination: row.destination })) : null;
      if (existing && !existing.ok) {
        this.diagnose("preserved-unreadable", binding);
        return false;
      }
      const echoed = row !== null && existing?.ok === true && row.destination === binding.destination.toLowerCase() && sameToken(existing.plaintext, token);
      const envelope = sealSecret(this.keyring.keyring, token, aad(binding));
      const timestamp = now.toISOString();
      const written = await this.deps.store.putIfEnvelope(binding, expectedEnvelope, { destination: binding.destination.toLowerCase(), envelope, returnedAt: echoed ? row.returnedAt : timestamp, updatedAt: timestamp });
      this.diagnose(written ? "captured" : "capture-conflict", binding);
      return written;
    } catch { this.diagnose("store-failure", binding); return false; }
  }
}
