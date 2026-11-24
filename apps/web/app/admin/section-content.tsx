import { ArrowLeft, Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import type { OperatorPageDecision } from "@/server/operator/page";
import { OperatorIdentity } from "./operator-shell";

export function authorizedOperatorAddress(decision: OperatorPageDecision): `0x${string}` | null {
  if (decision.kind === "unauthenticated") redirect("/?account=signin");
  if (decision.kind === "forbidden") redirect("/home");
  return decision.kind === "operator" ? decision.address : null;
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

export function OperatorSection({ address, heading, parent, back, children }: { address: `0x${string}`; heading: string; parent?: { href: string; label: string }; back?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <OperatorIdentity address={address} />
      {back}
      {parent && (
        <Link href={parent.href} className="-mb-6 inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />{parent.label}
        </Link>
      )}
      <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{heading}</h1>
      {children}
    </div>
  );
}
