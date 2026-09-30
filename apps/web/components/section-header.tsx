"use client";

import type { ReactNode } from "react";
import { CardAction, CardTitle } from "@/components/ui/card";
import { MoneyTicker } from "@/components/money-ticker";
import type { BalanceFigure } from "@/shared/balances/present";

type SectionVariantProps = {
  variant?: "section";
  headingId: string;
  title: ReactNode;
  ariaLevel?: number;
  action?: ReactNode;
};

type GroupVariantProps = {
  variant: "group";
  headingId: string;
  label: ReactNode;
  subtotal: BalanceFigure | null;
};

export function SectionHeader(props: SectionVariantProps | GroupVariantProps) {
  if (props.variant === "group") {
    return (
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        <h3 id={props.headingId}>{props.label}</h3>
        {props.subtotal ? (
          <span className="text-right tracking-normal normal-case" data-subtotal-status={props.subtotal.status === "complete" ? undefined : props.subtotal.status}>
            {props.subtotal.status === "partial" ? <span>Partial balance </span> : null}
            <span className="text-foreground">
              {props.subtotal.value === null ? (
                <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>
              ) : (
                <MoneyTicker value={props.subtotal.value} reserveDigits={false} animated={props.subtotal.status !== "partial"} />
              )}
            </span>
          </span>
        ) : null}
      </div>
    );
  }

  const { headingId, title, ariaLevel = 2, action } = props;

  return (
    <>
      <CardTitle id={headingId} role="heading" aria-level={ariaLevel}>{title}</CardTitle>
      {action !== undefined ? <CardAction>{action}</CardAction> : null}
    </>
  );
}
