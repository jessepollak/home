import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function AdminPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return (
    <OperatorSection address={address} heading="Overview">
      <section aria-labelledby="attention-heading" className="grid gap-3">
        <h2 id="attention-heading" className="text-lg font-semibold">Needs attention</h2>
        <OperatorEmpty>Needs attention isn&apos;t available yet.</OperatorEmpty>
      </section>
      <section aria-labelledby="business-heading" className="grid gap-3">
        <h2 id="business-heading" className="text-lg font-semibold">Business</h2>
        <OperatorEmpty>Business metrics aren&apos;t available yet.</OperatorEmpty>
      </section>
    </OperatorSection>
  );
}
