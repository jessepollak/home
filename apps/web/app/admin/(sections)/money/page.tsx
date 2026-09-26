import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function MoneyPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorSection address={address} heading="Money"><OperatorEmpty>Revenue isn&apos;t available yet.</OperatorEmpty></OperatorSection>;
}
