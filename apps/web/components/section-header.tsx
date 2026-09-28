"use client";

import type { ReactNode } from "react";
import { CardAction, CardTitle } from "@/components/ui/card";
import { MoneyTicker } from "@/components/money-ticker";

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
  subtotal: string | null;
};

export function SectionHeader(props: SectionVariantProps | GroupVariantProps) {
  if (props.variant === "group") {
    return (
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        <h3 id={props.headingId}>{props.label}</h3>
        {props.subtotal ? (
          <MoneyTicker
            className="text-right tracking-normal normal-case"
            value={props.subtotal}
            reserveDigits={false}
          />
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
