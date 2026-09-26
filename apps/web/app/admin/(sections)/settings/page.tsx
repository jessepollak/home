import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function SettingsPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  return <OperatorSection address={address} heading="Settings"><OperatorEmpty>No settings available yet.</OperatorEmpty></OperatorSection>;
}
