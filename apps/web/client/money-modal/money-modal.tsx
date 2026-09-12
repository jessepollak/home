"use client";

import { Sheet, useSheetLifecycle } from "@home/ui/sheet";
import type { ReactNode } from "react";
import styles from "./money-modal.module.css";

export const useMoneyModal = useSheetLifecycle;

export function MoneyModal({
  open,
  labelledBy,
  describedBy,
  immediate = false,
  onCancel,
  onClose,
  children,
}: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  immediate?: boolean;
  onCancel: () => boolean | void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      className={styles.typography}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onDismiss={onCancel}
      onClosed={onClose}
      immediate={immediate}
      dragDismiss
    >
      {children}
    </Sheet>
  );
}

export function MoneyModalHeader({
  title,
  titleId,
  onBack,
  onClose,
  closeDisabled = false,
  closeLabel = "Close",
}: {
  title: string;
  titleId: string;
  onBack?: () => void;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
}) {
  return (
    <header className={styles.header}>
      {onBack ? (
        <button className={styles.backButton} type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          <span className={styles.srOnly}>Back</span>
        </button>
      ) : (
        <span />
      )}
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <button
        className={styles.closeButton}
        type="button"
        disabled={closeDisabled}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
        <span className={styles.srOnly}>{closeLabel}</span>
      </button>
    </header>
  );
}

export function MoneyModalFooter({
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryType = "button",
  secondaryLabel,
  onSecondary,
  secondaryDisabled = false,
}: {
  primaryLabel: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryType?: "button" | "submit";
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
}) {
  return (
    <div className={styles.footer}>
      <button
        className={styles.primary}
        type={primaryType}
        disabled={primaryDisabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </button>
      {secondaryLabel && onSecondary ? (
        <button
          className={styles.quiet}
          type="button"
          disabled={secondaryDisabled}
          onClick={onSecondary}
        >
          {secondaryLabel}
        </button>
      ) : null}
    </div>
  );
}
