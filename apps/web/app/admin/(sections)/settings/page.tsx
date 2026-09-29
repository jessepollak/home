import { InvestPane } from "@/client/admin/invest-pane";
import { RegionsPane } from "@/client/admin/regions-pane";
import { FeeSettingsForm, type FeeSettingsState } from "@/client/operator/fee-settings-form";
import { FeeSettingsUnavailable } from "@/client/operator/fee-settings-unavailable";
import { getSqlExecutor } from "@/server/db/sql";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorPageDecision } from "@/server/operator/page";
import { readInvestSettingsEntry } from "@/server/operator-settings/invest";
import { readRegionSettingsForPage } from "@/server/operator-settings/regions";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { parseOperatorFeeSettings } from "@/shared/fees/contract";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import { parseRegionSettings, type RegionSettings } from "@/shared/operator-settings/regions";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

async function readFeeSettings(): Promise<FeeSettingsState | null> {
  try {
    const { settings } = await new OperatorSettingsStore(getSqlExecutor()).read("fees");
    const value = parseOperatorFeeSettings(settings.value);
    return value ? { ...settings, value } : null;
  } catch (error) {
    writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin/settings", errorName: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

export default async function SettingsPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  let regionEntry: SettingsEntry<RegionSettings>["settings"] | null = null;
  let investEntry: SettingsEntry<InvestSettings>["settings"] | null = null;
  const database = Boolean(process.env.DATABASE_URL?.trim());
  if (database) {
    try {
      const result = (await readRegionSettingsForPage(getSqlExecutor())).settings;
      const value = parseRegionSettings(result.value);
      if (value) regionEntry = { ...result, value };
    } catch {
      regionEntry = null;
    }
    try {
      investEntry = (await readInvestSettingsEntry())?.settings ?? null;
    } catch {
      investEntry = null;
    }
  }
  const fees = await readFeeSettings();
  return (
    <OperatorSection address={address} heading="Settings">
      {regionEntry ? <RegionsPane key={address} initialEntry={regionEntry} operator={address} /> : <OperatorEmpty>{database ? "Region settings are unavailable. Try again shortly." : "Region settings need a database. Home is offering its built-in regions."}</OperatorEmpty>}
      {investEntry ? <InvestPane key={address} initialEntry={investEntry} operator={address} /> : <OperatorEmpty>{database ? "Invest settings are unavailable. Try again shortly." : "Invest settings need a database. Home is showing its full catalog."}</OperatorEmpty>}
      {fees ? <FeeSettingsForm key={address} operator={address} initial={fees} /> : <FeeSettingsUnavailable />}
    </OperatorSection>
  );
}
