import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export const instant = false;

export default async function AuditPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  if (!address) return null;
  return <OperatorSection address={address} heading="Audit log"><OperatorEmpty>Admin activity isn&apos;t recorded yet.</OperatorEmpty></OperatorSection>;
}
