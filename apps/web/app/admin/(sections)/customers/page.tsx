import { after } from "next/server";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";
import { scheduleOperatorRecheck } from "@/server/operator/follow-through";

export const maxDuration = 25;

export default async function CustomersPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  scheduleOperatorRecheck(decision, after, "/admin/customers");
  return <OperatorSection address={address} heading="Customers"><OperatorEmpty>Customer search isn&apos;t available yet.</OperatorEmpty></OperatorSection>;
}
