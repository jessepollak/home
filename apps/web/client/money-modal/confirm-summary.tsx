"use client";

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
        <p className={styles.confirmFigure}>{amount}</p>
        <p className={styles.confirmLead}>{lead}</p>
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
