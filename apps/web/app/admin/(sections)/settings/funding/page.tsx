import { FundingSettings, FundingSettingsUnavailable } from "@/client/admin/funding-settings";
import { readFundingOfferingView } from "@/server/funding/offering";
import { readOperatorPageDecision } from "@/server/operator/page";
import { authorizedOperatorAddress, OperatorSection } from "../../../section-content";

export default async function FundingSettingsPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  const view = await readFundingOfferingView().catch(() => null);
  return (
    <OperatorSection address={address} heading="Money in and out" parent={{ href: "/admin/settings", label: "Settings" }}>
      {view ? <FundingSettings key={address} view={view} operator={address} /> : <FundingSettingsUnavailable />}
    </OperatorSection>
  );
}
