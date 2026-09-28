import { RegionsPane } from "@/client/admin/regions-pane";
import { getSqlExecutor } from "@/server/db/sql";
import { readOperatorPageDecision } from "@/server/operator/page";
import { readRegionSettingsForPage } from "@/server/operator-settings/regions";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { parseRegionSettings, type RegionSettings } from "@/shared/operator-settings/regions";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

export default async function SettingsPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  let entry: SettingsEntry<RegionSettings>["settings"] | null = null;
  const database = Boolean(process.env.DATABASE_URL?.trim());
  if (database) {
    try {
      const result = (await readRegionSettingsForPage(getSqlExecutor())).settings;
      const value = parseRegionSettings(result.value);
      if (value) entry = { ...result, value };
    } catch {
      entry = null;
    }
  }
  return (
    <OperatorSection address={address} heading="Settings">
      {entry ? <RegionsPane initialEntry={entry} /> : <OperatorEmpty>{database ? "Region settings are unavailable. Try again shortly." : "Region settings need a database. Home is offering its built-in regions."}</OperatorEmpty>}
    </OperatorSection>
  );
}
