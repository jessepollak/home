import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function CustomersPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorSection address={address} heading="Customers"><OperatorEmpty>Customer search isn&apos;t available yet.</OperatorEmpty></OperatorSection>;
}
