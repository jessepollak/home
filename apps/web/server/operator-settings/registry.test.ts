import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { readOperatorConfig } from "@/server/operator/config";
import { readPayoutSignerConfig } from "@/server/operator/payout-signers";
import { serverSettingsRegistry } from "@/server/operator-settings/registry";
import { OperatorSettingsStore, OperatorSettingsValidationError } from "@/server/operator-settings/store";
import { createPostgresSqlExecutor, type SqlQueryResult } from "@/server/db/sql";
import { GROWTH_SETTINGS_DEFAULTS } from "@/shared/operator-settings/growth";
import type { OperatorAccountConfig } from "@/shared/operator-settings/operator-account";

const signer = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const administrator = "0x1111111111111111111111111111111111111111";
const configured = readPayoutSignerConfig({ HOME_PAYOUT_SIGNER_ADDRESSES: signer });

test("operator and payout signer lists share the existing fail-closed address grammar", () => {
  for (const raw of [undefined, "", " \t\r\n\f\v"]) {
    expect(readPayoutSignerConfig({ HOME_PAYOUT_SIGNER_ADDRESSES: raw })).toEqual({ kind: "absent" });
    expect(readOperatorConfig({ HOME_OPERATOR_ADDRESSES: raw })).toEqual({ kind: "absent" });
  }
  for (const raw of [",", `${signer},`, `,${signer}`, `${signer}, ,${administrator}`, `${signer},${getAddress(signer)}`, `${signer},bad`, "0x1234", `\u00a0${signer}`, `0X${signer.slice(2)}`]) {
    expect(readPayoutSignerConfig({ HOME_PAYOUT_SIGNER_ADDRESSES: raw })).toEqual({ kind: "misconfigured" });
    expect(readOperatorConfig({ HOME_OPERATOR_ADDRESSES: raw })).toEqual({ kind: "misconfigured" });
  }
  for (const raw of [` \t${getAddress(signer)}\n,\r${administrator}\f`, "0xabCdefabcdefabcdefabcdefabcdefabcdefabcd," + administrator]) {
    const result: OperatorAccountConfig = { kind: "configured", addresses: new Set([signer, administrator]) };
    expect(readPayoutSignerConfig({ HOME_PAYOUT_SIGNER_ADDRESSES: raw })).toEqual(result);
    expect(readOperatorConfig({ HOME_OPERATOR_ADDRESSES: raw })).toEqual(result);
  }
});

class MemorySql {
  row: Record<string, unknown> | undefined;
  audit: unknown[][] = [];
  readonly sql = createPostgresSqlExecutor("postgres://unused", {
    attachPool: () => {},
    poolFactory: () => ({
      query: (text, values) => this.query(text, values),
      connect: async () => ({ query: (text, values) => this.query(text, values), release: () => {} }),
      end: async () => {},
      on: () => {},
    }),
  });

  async query(text: string, values: unknown[] = []): Promise<SqlQueryResult> {
    let rows: Record<string, unknown>[] = [];
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows, rowCount: 0 };
    if (text.startsWith("SELECT * FROM operator_settings")) rows = this.row ? [this.row] : [];
    else if (text.startsWith("INSERT INTO operator_settings") || text.startsWith("UPDATE operator_settings")) {
      this.row = { domain: values[0], schema_version: values[1], value: JSON.parse(String(values[2])), revision: String(Number(this.row?.revision ?? 0) + 1), updated_at: new Date("2026-10-01T00:00:00Z"), updated_by: values[3] };
      rows = [this.row];
    } else if (text.startsWith("INSERT INTO admin_audit_log")) this.audit.push(values);
    else throw new Error("Unexpected test query");
    return { rows, rowCount: rows.length };
  }
}

test("growth store writes fail closed and reevaluate signer eligibility on every write", async () => {
  let signers: OperatorAccountConfig = { kind: "absent" };
  const sql = new MemorySql();
  const store = new OperatorSettingsStore(sql.sql, serverSettingsRegistry(() => signers));
  const write = (payoutAccount: string | null, holdDays = 31) => store.write({ domain: "growth", expectedRevision: Number(sql.row?.revision ?? 0), value: { ...GROWTH_SETTINGS_DEFAULTS, holdDays, payoutAccount }, actor: administrator });
  await expect(write(signer)).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  const draft = await write(null);
  expect(draft.settings.value).toEqual({ ...GROWTH_SETTINGS_DEFAULTS, holdDays: 31 });
  signers = { kind: "misconfigured" };
  await expect(write(signer)).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  signers = configured;
  await expect(write(administrator)).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  expect((await write(getAddress(signer))).settings.value).toEqual({ ...GROWTH_SETTINGS_DEFAULTS, holdDays: 31, payoutAccount: signer });
  signers = { kind: "absent" };
  await expect(write(signer, 32)).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  expect((await store.read("growth")).settings.value).toEqual({ ...GROWTH_SETTINGS_DEFAULTS, holdDays: 31, payoutAccount: signer });
  expect((await write(null, 32)).settings.value).toEqual({ ...GROWTH_SETTINGS_DEFAULTS, holdDays: 32 });
  expect(sql.audit).toHaveLength(3);
  const defaults = new OperatorSettingsStore(new MemorySql().sql);
  expect((await defaults.read("growth")).settings).toMatchObject({ value: { enabled: false, payoutAccount: null }, revision: 0, source: "default" });
});
