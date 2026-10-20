import Link from "next/link";
import { BrandSettingsForm, type BrandSettingsState } from "@/client/operator/brand-settings-form";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor } from "@/server/db/sql";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorPageDecision } from "@/server/operator/page";
import { OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS } from "@/server/operator-settings/regions";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { BRAND_SETTINGS_DOMAIN, parseBrandSettings } from "@/shared/operator-branding/contract";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../../section-content";

export const instant = false;

async function readBrandForEditor(): Promise<BrandSettingsState | "no-database" | null> {
  if (!readDatabaseUrl()) return "no-database";
  try {
    const { settings } = await new OperatorSettingsStore(getSqlExecutor()).read(BRAND_SETTINGS_DOMAIN, { timeoutMs: OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS });
    const value = parseBrandSettings(settings.value);
    return value ? { ...settings, value } : null;
  } catch (error) {
    writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin/settings/brand", errorName: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

export default async function BrandSettingsPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  const entry = await readBrandForEditor();
  return (
    <OperatorSection address={address} heading="Brand" parent={{ href: "/admin/settings", label: "Settings" }}>
      {entry === "no-database" ? (
        <OperatorEmpty>Brand settings need a database. Customers see Home’s built-in brand.</OperatorEmpty>
      ) : entry ? (
        <BrandSettingsForm key={address} initial={entry} operator={address} />
      ) : (
        <OperatorEmpty>
          Brand settings are unavailable. Customers see Home’s built-in brand until they load.{" "}
          <Link href="/admin/settings/brand" className="font-medium text-primary underline underline-offset-4">Try again</Link>
        </OperatorEmpty>
      )}
    </OperatorSection>
  );
}
