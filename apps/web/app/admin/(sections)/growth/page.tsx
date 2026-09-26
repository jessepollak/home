import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readInviteStats } from "@/server/invites/store";
import { readOperatorPageDecision } from "@/server/operator/page";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

export default async function GrowthPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  const stats = await readInviteStats().catch(() => null);
  return (
    <OperatorSection address={address} heading="Growth">
      {stats ? <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader><CardTitle>Invite links</CardTitle></CardHeader><CardContent>{stats.inviteLinks}</CardContent></Card>
        <Card><CardHeader><CardTitle>Attributed sign-ups</CardTitle></CardHeader><CardContent>{stats.attributedSignUps}</CardContent></Card>
      </div> : <OperatorEmpty>Invite data isn&apos;t available.</OperatorEmpty>}
    </OperatorSection>
  );
}
