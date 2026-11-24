import { after } from "next/server";
import { authorizedOperatorAddress, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";
import { scheduleOperatorRecheck } from "@/server/operator/follow-through";
import { CustomerSearch } from "@/client/admin-customers/customer-search";

export const maxDuration = 25;

export const instant = false;

export default async function CustomersPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  if (!address) return null;
  scheduleOperatorRecheck(decision, after, "/admin/customers");
  return <OperatorSection address={address} heading="Customers"><CustomerSearch operator={address} /></OperatorSection>;
}
