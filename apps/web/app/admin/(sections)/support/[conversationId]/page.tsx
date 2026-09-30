import { OperatorSupportInbox } from "@/client/operator-support/operator-support-inbox";
import { authorizedOperatorAddress, OperatorSection } from "../../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function SupportConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  const { conversationId } = await params;
  return <OperatorSection address={address} heading="Support"><OperatorSupportInbox conversationId={conversationId} /></OperatorSection>;
}
