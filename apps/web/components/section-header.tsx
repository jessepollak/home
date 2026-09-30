"use client";

import type { ReactNode } from "react";
import { CardAction, CardTitle } from "@/components/ui/card";

type SectionVariantProps = {
  variant?: "section";
  headingId: string;
  title: ReactNode;
  ariaLevel?: number;
  action?: ReactNode;
};

export function SectionHeader(props: SectionVariantProps) {

  const { headingId, title, ariaLevel = 2, action } = props;

  return (
    <>
      <CardTitle id={headingId} role="heading" aria-level={ariaLevel}>{title}</CardTitle>
      {action !== undefined ? <CardAction>{action}</CardAction> : null}
    </>
  );
}
