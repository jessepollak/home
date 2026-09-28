"use client";

import { AppDrawer, MoneyModalBody, MoneyModalFooter, MoneyModalHeader } from "@/client/money-modal";

const titleId = "email-share-title";
const descriptionId = "email-share-description";

export function EmailShareSheet({
  open,
  onShare,
  onNotNow,
}: {
  open: boolean;
  onShare: () => void;
  onNotNow: () => void;
}) {
  return (
    <AppDrawer open={open} labelledBy={titleId} describedBy={descriptionId} onCancel={onNotNow}>
      <MoneyModalHeader title="Share your email" titleId={titleId} closeLabel="Close" />
      <MoneyModalBody hasFooter className="pt-2">
        <p id={descriptionId} className="text-sm text-muted-foreground">
          Base Account shares it with Home so we can find your account if you need help.
        </p>
      </MoneyModalBody>
      <MoneyModalFooter primaryLabel="Share" onPrimary={onShare} secondaryLabel="Not now" onSecondary={onNotNow} />
    </AppDrawer>
  );
}
