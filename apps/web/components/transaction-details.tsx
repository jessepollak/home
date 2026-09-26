"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CopyableValue } from "@/components/copyable-value";
import { NetworkMark } from "./network-mark";
import { StatusStep, StatusSteps } from "./ui/status-step";
import { TransactionAmount } from "./transaction-amount";
import { TransactionStatusMark } from "./transaction-status";
import { MoneyModal, MoneyModalBody, MoneyModalFooter, MoneyModalHeader } from "@/client/money-modal";
import type { ReactNode } from "react";
import type { TransactionDetails } from "./transaction-explorer";

export type { TransactionDetails } from "./transaction-explorer";


export function TransactionDetailsModal({
  open,
  titleId,
  details,
  onClose,
  onClosed,
  footerAction,
}: {
  open: boolean;
  titleId: string;
  details: TransactionDetails | null;
  onClose: () => void;
  onClosed?: () => void;
  footerAction?: { label: ReactNode; onClick: () => void; busy?: boolean; error?: string | null } | null;
}) {
  const rows = details?.rows ?? [];
  return (
    <MoneyModal
      open={open}
      labelledBy={titleId}
      onCancel={onClose}
      onClose={onClosed ?? onClose}
    >
      <MoneyModalHeader
        title={details?.title ?? ""}
        titleId={titleId}
        onClose={onClose}
        closeLabel="Close transaction details"
      />
      <MoneyModalBody hasFooter={Boolean(footerAction)} className="pt-4">
        {details?.header ? <div className="pb-4"><TransactionAmount {...details.header} /></div> : null}
        {details?.steps?.length ? <div className="pb-4"><StatusSteps>
          {details.steps.map((step) => <StatusStep key={step.title} status={step.status} title={step.title} time={step.time} />)}
        </StatusSteps></div> : null}
        <Card variant="flush">
          <CardContent inset="list">
            <dl>
              {rows.map((row) => (
                <div
                  className="grid min-h-11 grid-cols-[minmax(6rem,0.65fr)_minmax(0,1.35fr)] items-center gap-3 px-3 text-sm"
                  key={row.label}
                >
                  <dt className="text-sm text-muted-foreground">{row.label}</dt>
                  <dd className={`min-w-0 text-end ${"display" in row && row.display ? "" : "font-medium tabular-nums"}`}>
                    {"network" in row ? (
                      <span className="inline-flex items-center justify-end gap-2"><NetworkMark network={row.network} />{row.value}</span>
                    ) : "statusTone" in row ? (
                      <TransactionStatusMark status={{ label: row.value, tone: row.statusTone }} />
                    ) : row.display ? (
                      <CopyableValue
                        value={row.value}
                        display={row.display}
                        presentation="compact"
                        valueKind={row.label === "Transaction" ? "transaction hash" : "address"}
                        className="justify-end text-end"
                      />
                    ) : row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        {details?.explorer ? (
          <div className="flex justify-end pt-4">
            <a
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={details.explorer.href}
              target="_blank"
              rel="noopener noreferrer"
              title={details.explorer.title}
            >
              {details.explorer.label}
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
        ) : null}
        {footerAction?.error ? <p role="alert" className="text-sm text-destructive">{footerAction.error}</p> : null}
      </MoneyModalBody>
      {footerAction ? (
        <MoneyModalFooter
          primaryLabel={footerAction.label}
          onPrimary={footerAction.onClick}
          primaryDisabled={footerAction.busy}
        />
      ) : null}
    </MoneyModal>
  );
}
