import { Inbox } from "lucide-react";
import { redirect } from "next/navigation";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import type { OperatorDecision } from "@/server/operator/authorize";
import { OperatorIdentity } from "./operator-shell";

export function authorizedOperatorAddress(decision: OperatorDecision): `0x${string}` {
  if (decision.kind === "unauthenticated") redirect("/?account=signin");
  if (decision.kind === "forbidden") redirect("/home");
  return decision.address;
}

export function OperatorEmpty({ children }: { children: React.ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function OperatorSection({ address, heading, children }: { address: `0x${string}`; heading: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <OperatorIdentity address={address} />
      <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{heading}</h1>
      {children}
    </div>
  );
}
