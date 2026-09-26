import Link from "next/link";
import { readOperatorPageDecision } from "@/server/operator/page";
import { authorizedOperatorAddress, OperatorSection } from "./section-content";

export default async function AdminNotFound() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return (
    <OperatorSection address={address} heading="Page not found">
      <Link className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" href="/admin">Back to Overview</Link>
    </OperatorSection>
  );
}
