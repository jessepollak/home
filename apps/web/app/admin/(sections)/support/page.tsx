import { authorizedOperatorAddress, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";
import { OperatorSupportInbox } from "@/client/operator-support/operator-support-inbox";
import { SupportAssistantSettings } from "@/client/operator-support/assistant-settings";

export const instant = false;

export default async function SupportPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return (
    <OperatorSection address={address} heading="Support">
      <OperatorSupportInbox />
      <SupportAssistantSettings operator={address} />
    </OperatorSection>
  );
}
