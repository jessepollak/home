import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { after } from "next/server";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../section-content";
import { readOperatorPageDecision } from "@/server/operator/page";
import { scheduleOperatorRecheck } from "@/server/operator/follow-through";
import { readOperatorSetup } from "@/server/operator/setup";
import type { SetupStep } from "@/shared/operator/setup";

export const maxDuration = 25;

export const instant = false;

function SetupSteps({ steps, optional = false }: { steps: SetupStep[]; optional?: boolean }) {
  return (
    <ul className="grid gap-3">
      {steps.map((step) => (
        <li key={step.id} aria-labelledby={`setup-${step.id}`}>
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ItemTitle id={`setup-${step.id}`} truncate="wrap">{step.title}</ItemTitle>
                {optional && <Badge variant="outline">Optional</Badge>}
                <Badge variant={step.state === "ready" ? "secondary" : optional ? "outline" : "warning"}>
                  {step.state === "needs-migration" ? "Needs migration" : step.state === "ready" ? "Ready" : step.state === "missing" ? "Missing" : step.state === "invalid" ? "Invalid" : "Unavailable"}
                </Badge>
              </div>
              <ItemDescription lines="wrap">
                {step.variables.map((entry) => (
                  <span key={entry.name} className="block"><span className="break-all">{entry.name}</span>: <span className="whitespace-nowrap">{entry.state}</span></span>
                ))}
              </ItemDescription>
              {(step.state !== "ready" || step.id === "operators" || step.id === "database") && <ItemDescription lines="wrap">{step.detail}</ItemDescription>}
              {step.state !== "ready" && (
                <ItemDescription lines="wrap">
                  {step.state === "missing" || step.state === "invalid" ? "Set these variables in your hosting project's environment variables, redeploy, then return to Admin. " : ""}
                  <a href={step.documentationHref}>Setup instructions</a>
                </ItemDescription>
              )}
              {step.id === "funding" && (
                <ItemDescription lines="wrap">
                  <Link href="/admin/settings/funding">Money in and out</Link>{" — credential presence there is not a verified provider connection."}
                </ItemDescription>
              )}
            </ItemContent>
          </Item>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminPage() {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  scheduleOperatorRecheck(decision, after, "/admin");
  const setup = await readOperatorSetup();
  return (
    <OperatorSection address={address} heading="Overview">
      <section aria-labelledby="setup-heading" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="setup-heading" className="text-lg font-semibold">Setup</h2>
          <p className="text-sm text-muted-foreground">{setup.requiredStepsLeft === 0 ? "Required setup complete" : `${setup.requiredStepsLeft} required step${setup.requiredStepsLeft === 1 ? "" : "s"} left`}</p>
        </div>
        <div className="grid gap-3">
          <h3 className="font-medium">Required</h3>
          <SetupSteps steps={setup.required} />
        </div>
        <div className="grid gap-3">
          <h3 className="font-medium">Optional</h3>
          <SetupSteps steps={setup.optional} optional />
        </div>
        <div className="grid gap-3">
          <h3 className="font-medium">Settings</h3>
          <ul className="grid gap-3">
            {[
              { href: "/admin/settings", title: "General settings", detail: "Regions, Invest visibility, and fees." },
              { href: "/admin/settings/products", title: "Products and markets", detail: "Manage which new entries are offered." },
              { href: "/admin/settings/funding", title: "Money in and out", detail: "Manage funding providers and corridors." },
            ].map((destination) => (
              <li key={destination.href}>
                <Item variant="outline" render={<Link href={destination.href} />}>
                  <ItemContent className="min-w-0">
                    <ItemTitle truncate="wrap">{destination.title}</ItemTitle>
                    <ItemDescription lines="wrap">{destination.detail}</ItemDescription>
                  </ItemContent>
                  <ItemActions><ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" /></ItemActions>
                </Item>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section aria-labelledby="version-heading" className="grid gap-3">
        <h2 id="version-heading" className="text-lg font-semibold">Running version</h2>
        {setup.build.kind === "unavailable" ? (
          <p className="text-sm text-muted-foreground">Build metadata is absent (local or self-hosted build).</p>
        ) : (
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>Commit {setup.build.commit.slice(0, 7)}</ItemTitle>
              <ItemDescription lines="wrap"><code className="break-all select-all">{setup.build.commit}</code></ItemDescription>
              <ItemDescription lines="wrap">Branch: {setup.build.branch ?? "Not provided"}</ItemDescription>
              <ItemDescription lines="wrap">Environment: {setup.build.environment ?? "Not provided"}</ItemDescription>
              <ItemDescription lines="wrap">Deployment ID: <span className="break-all">{setup.build.deploymentId ?? "Not provided"}</span></ItemDescription>
            </ItemContent>
          </Item>
        )}
      </section>
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
