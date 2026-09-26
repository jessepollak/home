"use client";

import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { formatPresentationDate } from "@/shared/formatting";
import { Skeleton } from "@/components/ui/skeleton";
import type { IdentityVerificationStatus } from "@/shared/identity/contract";
import { identityRetryCopy, identityStateCopy } from "./copy";

export function IdentityRow({ status, onAction }: { status: IdentityVerificationStatus | null; onAction: () => void }) {
  if (!status) {
    return (
      <Item className="min-w-0">
        <ItemContent className="min-w-0">
          <ItemTitle>Identity</ItemTitle>
          <Skeleton className="h-4 w-32" aria-label="Loading identity status" />
        </ItemContent>
      </Item>
    );
  }
  const copy = identityStateCopy[status.state];
  const detail = status.state === "retry" && status.retryReason
    ? identityRetryCopy[status.retryReason].text
    : copy.detail;
  return (
    <Item className="min-w-0">
      <ItemContent className="min-w-0">
        <ItemTitle>Identity</ItemTitle>
        <ItemDescription aria-live="polite">{copy.title}</ItemDescription>
        {detail ? <ItemDescription>{detail}</ItemDescription> : null}
        {status.state === "verified" && status.verifiedAt ? (
          <ItemDescription>{formatPresentationDate(status.verifiedAt, { style: "calendar-date", timeZone: "UTC" })}</ItemDescription>
        ) : null}
        {status.action === "contact-support" ? (
          <ItemDescription>{status.supportUrl ? (
            <a href={status.supportUrl} target="_blank" rel="noopener noreferrer">Contact Home support</a>
          ) : "Contact Home support"}</ItemDescription>
        ) : null}
      </ItemContent>
      {copy.button ? (
        <ItemActions>
          <Button variant="outline" onClick={onAction}>{copy.button}</Button>
        </ItemActions>
      ) : null}
    </Item>
  );
}
