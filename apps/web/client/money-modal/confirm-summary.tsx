"use client";

import { Text } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import type { ReactNode } from "react";
import styles from "./money-modal.module.css";

export type MoneyConfirmRow = {
  label: string;
  value: ReactNode;
};

export function MoneyConfirmSummary({
  amount,
  lead,
  rows,
}: {
  amount: string;
  lead: string;
  rows: readonly MoneyConfirmRow[];
}) {
  return (
    <>
      <div className={styles.confirmAmount}>
        <Text as="div" textStyle="amount" className={styles.confirmFigure}>
          <MoneyTicker value={amount} />
        </Text>
        <Text textStyle="secondary" tone="muted" className={styles.confirmLead}>{lead}</Text>
      </div>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div className={styles.row} key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
