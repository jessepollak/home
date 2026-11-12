import { GrowthDashboard } from "@/client/admin/growth-dashboard";
import { readGrowthPageData } from "@/server/growth/page-data";
import { readOperatorPageDecision } from "@/server/operator/page";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

export const instant = false;

export default async function GrowthPage() {
  const address = authorizedOperatorAddress(await readOperatorPageDecision());
  const data = await readGrowthPageData();
  return (
    <OperatorSection address={address} heading="Growth">
      {data ? <GrowthDashboard data={data} operator={address} /> : <OperatorEmpty>Invite data isn&apos;t available.</OperatorEmpty>}
    </OperatorSection>
  );
}
