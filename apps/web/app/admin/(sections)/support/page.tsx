import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function SupportPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorSection address={address} heading="Support"><OperatorEmpty>Support inbox isn&apos;t available yet.</OperatorEmpty></OperatorSection>;
}
