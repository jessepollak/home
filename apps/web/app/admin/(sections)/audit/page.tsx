import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function AuditPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorSection address={address} heading="Audit log"><OperatorEmpty>Admin activity isn&apos;t recorded yet.</OperatorEmpty></OperatorSection>;
}
