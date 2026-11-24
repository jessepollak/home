import { authorizedOperatorAddress, OperatorSection } from "../../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";
import { CustomerDetail, CustomersBackLink } from "@/client/admin-customers/customer-detail";

export const instant = false;

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  if (!address) return null;
  const { customerId } = await params;
  return (
    <OperatorSection address={address} heading="Customer" back={<CustomersBackLink />}>
      <CustomerDetail key={customerId} operator={address} customerId={customerId} />
    </OperatorSection>
  );
}
