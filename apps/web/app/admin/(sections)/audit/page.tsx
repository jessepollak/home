import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor } from "@/server/db/sql";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorPageDecision } from "@/server/operator/page";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS } from "@/server/operator-settings/regions";
import { summarizeAuditEntry } from "@/shared/operator-settings/audit-summary";
import { validCursor, type AuditEntry } from "@/shared/operator-settings/contract";
import { formatAddress, formatPresentationDate } from "@/shared/formatting";
import { authorizedOperatorAddress, OperatorEmpty, OperatorSection } from "../../section-content";

export const instant = false;

type AuditListing = { entries: AuditEntry[]; nextCursor: string | null };

async function readAuditPage(before: string | undefined): Promise<AuditListing | "no-database" | null> {
  if (!readDatabaseUrl()) return "no-database";
  try {
    return await new AdminAuditLog(getSqlExecutor()).list({ before, timeoutMs: OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS });
  } catch (error) {
    writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin/audit", errorName: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const { title, changes } = summarizeAuditEntry(entry);
  return (
    <Item role="listitem" variant="outline" className="min-w-0">
      <ItemContent className="min-w-0">
        <ItemTitle truncate="wrap">{title}</ItemTitle>
        <ItemDescription lines="wrap">
          <time dateTime={entry.occurredAt}>{formatPresentationDate(entry.occurredAt, { style: "date-time-zone", timeZone: "UTC" })}</time> · <span title={entry.actor}>{formatAddress(entry.actor)}</span>
        </ItemDescription>
        {changes.length > 0 && (
          <ul className="grid gap-1 text-sm break-words">
            {changes.map((change) => <li key={change}>{change}</li>)}
          </ul>
        )}
      </ItemContent>
    </Item>
  );
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const decision = await readOperatorPageDecision();
  const address = authorizedOperatorAddress(decision);
  if (!address) return null;
  const requested = (await searchParams).before;
  const before = typeof requested === "string" && validCursor(requested) ? requested : undefined;
  const page = await readAuditPage(before);
  return (
    <OperatorSection address={address} heading="Audit log">
      {page === "no-database" ? (
        <OperatorEmpty>The audit log needs a database.</OperatorEmpty>
      ) : page === null ? (
        <OperatorEmpty>
          The audit log is unavailable.{" "}
          <Link href="/admin/audit" className="font-medium text-primary underline underline-offset-4">Try again</Link>
        </OperatorEmpty>
      ) : page.entries.length === 0 ? (
        <OperatorEmpty>{before ? "No older admin activity." : "No admin activity yet."}</OperatorEmpty>
      ) : (
        <ItemGroup role="list" aria-label="Admin activity, newest first">
          {page.entries.map((entry) => <AuditEntryRow key={entry.id} entry={entry} />)}
        </ItemGroup>
      )}
      {page !== "no-database" && page !== null && (before || page.nextCursor) && (
        <div className="flex flex-wrap gap-2">
          {before && <Link className={buttonVariants({ variant: "outline", size: "touch" })} href="/admin/audit">Newest</Link>}
          {page.nextCursor && <Link className={buttonVariants({ variant: "outline", size: "touch" })} href={`/admin/audit?before=${page.nextCursor}`}>Older</Link>}
        </div>
      )}
    </OperatorSection>
  );
}
