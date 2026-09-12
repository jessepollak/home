"use client";

import { Button, Heading, IconButton } from "@home/ui";
import { XIcon } from "@home/ui/icons";
import { Sheet, useSheetLifecycle } from "@home/ui/sheet";
import { ArrowLeft } from "lucide-react";
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
        <Button className={styles.backButton} variant="quiet" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
        </Button>
      ) : (
        <span />
      )}
      <Heading id={titleId} level={2} textStyle="sheet-title" className={styles.title}>
        {title}
      </Heading>
      <IconButton
        className={styles.closeButton}
        aria-label={closeLabel}
        icon={XIcon}
        disabled={closeDisabled}
        onClick={onClose}
      />
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
  primaryLabel: ReactNode;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryType?: "button" | "submit";
  secondaryLabel?: ReactNode;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
}) {
  return (
    <div className={styles.footer}>
      <Button
        className={styles.primary}
        type={primaryType}
        disabled={primaryDisabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </Button>
      {secondaryLabel && onSecondary ? (
        <Button
          className={styles.quiet}
          variant="quiet"
          disabled={secondaryDisabled}
          onClick={onSecondary}
        >
          {secondaryLabel}
        </Button>
      ) : null}
    </div>
  );
}
