import { InvestPane } from "@/client/admin/invest-pane";
import { RegionsPane } from "@/client/admin/regions-pane";
import { getSqlExecutor } from "@/server/db/sql";
import { readOperatorPageDecision } from "@/server/operator/page";
import { readInvestSettingsEntry } from "@/server/operator-settings/invest";
import { readRegionSettingsForPage } from "@/server/operator-settings/regions";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import { parseRegionSettings, type RegionSettings } from "@/shared/operator-settings/regions";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

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
  return (
    <OperatorSection address={address} heading="Settings">
      {regionEntry ? <RegionsPane initialEntry={regionEntry} /> : <OperatorEmpty>{database ? "Region settings are unavailable. Try again shortly." : "Region settings need a database. Home is offering its built-in regions."}</OperatorEmpty>}
      {investEntry ? <InvestPane initialEntry={investEntry} /> : <OperatorEmpty>{database ? "Invest settings are unavailable. Try again shortly." : "Invest settings need a database. Home is showing its full catalog."}</OperatorEmpty>}
    </OperatorSection>
  );
}
