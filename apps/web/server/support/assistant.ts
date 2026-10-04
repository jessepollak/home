import "server-only";

import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";
import { type SupportAssistantSettings, parseSupportAssistantSettings } from "@/shared/operator-settings/contract";
import { SUPPORT_CONTRACT_VERSION, type SupportAssistantCapability, type SupportCredentialResponse } from "@/shared/support/contract";
import type { SqlExecutor } from "@/server/db/sql";
import { openSecret, resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";

const aad = { purpose: "support-assistant-key", binding: { provider: "ai-gateway" } };
type CredentialRow = { envelope: string; last4: string; updated_at: Date };
export type EffectiveAssistant = { settings: SupportAssistantSettings; key: string | null; available: boolean; capability: SupportAssistantCapability };
export function gatewayModel(key: string, id: string): LanguageModel { return createGateway({ apiKey: key })(id); }

export class SupportAssistantStore {
  constructor(private readonly sql: SqlExecutor, private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  async credential(): Promise<SupportCredentialResponse> {
    const row = (await this.sql.query<CredentialRow>("SELECT envelope,last4,updated_at FROM support_assistant_credentials WHERE id='default'")).rows[0];
    const ring = resolveSecretKeyring(this.env);
    return { version: SUPPORT_CONTRACT_VERSION, configured: !!row, last4: row?.last4 ?? null, updatedAt: row?.updated_at.toISOString() ?? null, available: !!row && ring.ok && openSecret(ring.keyring, row.envelope, aad).ok };
  }

  private async settings(): Promise<SupportAssistantSettings> {
    const row = (await this.sql.query<{ value: unknown }>("SELECT value FROM operator_settings WHERE domain='support-assistant'")).rows[0];
    const settings = parseSupportAssistantSettings(row?.value ?? { mode: "operator", model: "", instructions: "" });
    if (!settings) throw new Error("Invalid support assistant settings");
    return settings;
  }

  async capability(): Promise<SupportAssistantCapability> {
    const settings = await this.settings();
    const credential = (await this.sql.query<CredentialRow>("SELECT envelope,last4,updated_at FROM support_assistant_credentials WHERE id='default'")).rows[0];
    const ring = resolveSecretKeyring(this.env);
    const available = settings.mode !== "operator" && !!settings.model && !!credential && ring.ok && openSecret(ring.keyring, credential.envelope, aad).ok;
    return { available, handoff: available && settings.mode === "hybrid" };
  }

  async effective(): Promise<EffectiveAssistant> {
    const settings = await this.settings();
    const credential = (await this.sql.query<CredentialRow>("SELECT envelope,last4,updated_at FROM support_assistant_credentials WHERE id='default'")).rows[0];
    const ring = resolveSecretKeyring(this.env);
    const opened = credential && ring.ok ? openSecret(ring.keyring, credential.envelope, aad) : null;
    const key = opened?.ok ? opened.plaintext : null;
    const available = settings.mode !== "operator" && !!settings.model && !!key;
    return { settings, key, available, capability: { available, handoff: available && settings.mode === "hybrid" } };
  }

  async put(apiKey: string, actor: `0x${string}`): Promise<SupportCredentialResponse | null> {
    const ring = resolveSecretKeyring(this.env);
    if (!ring.ok) return null;
    const envelope = sealSecret(ring.keyring, apiKey, aad);
    const last4 = apiKey.slice(-4);
    await this.sql.transaction(async (tx) => {
      const previous = (await tx.query<{ last4: string }>("SELECT last4 FROM support_assistant_credentials WHERE id='default' FOR UPDATE")).rows[0];
      await tx.query(`INSERT INTO support_assistant_credentials (id,envelope,last4,updated_at,updated_by) VALUES ('default',$1,$2,now(),$3)
        ON CONFLICT (id) DO UPDATE SET envelope=$1,last4=$2,updated_at=now(),updated_by=$3`, [envelope, last4, actor]);
      await tx.query(`INSERT INTO admin_audit_log (actor,action,target_kind,target_id,before,after)
        VALUES ($1,'support.credential.update','settings','support-assistant-key',$2::jsonb,$3::jsonb)`, [actor, JSON.stringify({ last4: previous?.last4 ?? null }), JSON.stringify({ last4 })]);
    });
    return this.credential();
  }

  async delete(actor: `0x${string}`): Promise<SupportCredentialResponse> {
    await this.sql.transaction(async (tx) => {
      const previous = (await tx.query<{ last4: string }>("DELETE FROM support_assistant_credentials WHERE id='default' RETURNING last4")).rows[0];
      if (previous) await tx.query(`INSERT INTO admin_audit_log (actor,action,target_kind,target_id,before,after)
        VALUES ($1,'support.credential.delete','settings','support-assistant-key',$2::jsonb,$3::jsonb)`, [actor, JSON.stringify({ last4: previous.last4 }), JSON.stringify({ last4: null })]);
    });
    return this.credential();
  }
}
