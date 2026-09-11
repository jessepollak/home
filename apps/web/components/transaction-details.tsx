"use client";

import { MoneyModal, MoneyModalHeader } from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import type { TransactionDetails } from "./transaction-explorer";
import styles from "./transaction-details.module.css";

export type {
  TransactionDetailRow,
  TransactionDetails,
  TransactionExplorerLink,
} from "./transaction-explorer";

export function TransactionDetailsModal({
  open,
  titleId,
  details,
  onClose,
}: {
  open: boolean;
  titleId: string;
  details: TransactionDetails | null;
  onClose: () => void;
}) {
  const rows = details?.rows ?? [];
  return (
    <MoneyModal
      open={open}
      labelledBy={titleId}
      onCancel={onClose}
      onClose={onClose}
    >
      <MoneyModalHeader
        title={details?.title ?? ""}
        titleId={titleId}
        onClose={onClose}
        closeLabel="Close transaction details"
      />
      <div className={modal.body}>
        <dl className={modal.rows}>
          {rows.map((row) => (
            <div className={modal.row} key={row.label}>
              <dt>{row.label}</dt>
              <dd title={row.title}>{row.value}</dd>
            </div>
          ))}
        </dl>
        {details?.explorer ? (
          <p className={styles.explorerWrap}>
            <a
              className={styles.explorer}
              href={details.explorer.href}
              target="_blank"
              rel="noreferrer"
            >
              {details.explorer.label}
            </a>
          </p>
        ) : null}
      </div>
    </MoneyModal>
  );
}
