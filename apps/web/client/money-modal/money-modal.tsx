"use client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerSwipeHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ArrowLeft, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import styles from "./money-modal.module.css";

export function AppDrawer({
  open,
  labelledBy,
  describedBy,
  immediate = false,
  initialFocusRef,
  onCancel,
  onClose,
  children,
}: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  immediate?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => boolean | void;
  onClose?: () => void;
  children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="down"
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;
        if (onCancel() === false) eventDetails.cancel();
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
    >
      <DrawerContent
        ref={popupRef}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        initialFocus={initialFocusRef ?? (() => (
          popupRef.current?.querySelector<HTMLElement>("[data-initial-focus]:not(:disabled)") ?? true
        ))}
        data-money-sheet=""
        data-immediate={immediate ? "" : undefined}
        className={`${styles.drawer} bg-background text-foreground shadow-lg`}
      >
        <DrawerSwipeHandle data-money-sheet-grabber="" />
        {children}
      </DrawerContent>
    </Drawer>
  );
}

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
    <AppDrawer
      open={open}
      labelledBy={labelledBy}
      describedBy={describedBy}
      immediate={immediate}
      onCancel={onCancel}
      onClose={onClose}
    >
      {children}
    </AppDrawer>
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
    <header className="grid shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-4 pt-1 pb-2">
      {onBack ? (
        <Button className="min-h-11 min-w-11 p-0" variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
        </Button>
      ) : (
        <span />
      )}
      <DrawerTitle id={titleId} className="text-center text-sheet-title font-semibold">
        {title}
      </DrawerTitle>
      <Button
        className="min-h-11 min-w-11 p-0"
        variant="ghost"
        size="icon"
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </Button>
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
        className="min-h-12 text-control font-semibold"
        type={primaryType}
        disabled={primaryDisabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </Button>
      {secondaryLabel && onSecondary ? (
        <Button
          className="min-h-12 text-control font-semibold text-muted-foreground"
          variant="ghost"
          disabled={secondaryDisabled}
          onClick={onSecondary}
        >
          {secondaryLabel}
        </Button>
      ) : null}
    </div>
  );
}
