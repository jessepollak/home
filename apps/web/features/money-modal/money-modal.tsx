"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./money-modal.module.css";

export const MONEY_SHEET_ENTER_MS = 280;
export const MONEY_SHEET_EXIT_MS = 220;
export const MONEY_SHEET_DISMISS_PX = 72;

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useMoneyModal(open: boolean): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number>(0);
  const previousOverflowRef = useRef("");

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const unlockScroll = () => {
      document.body.style.overflow = previousOverflowRef.current;
    };

    if (open) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
      if (!dialog.open) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        previousOverflowRef.current = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialog.showModal();
        dialog.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus();
      }
      dialog.dataset.state = "open";
      return;
    }

    if (!dialog.open) {
      dialog.dataset.state = "closed";
      unlockScroll();
      return;
    }

    const finish = () => {
      closeTimerRef.current = 0;
      if (dialog.open) dialog.close();
      unlockScroll();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };

    if (prefersReducedMotion()) {
      dialog.dataset.state = "closed";
      finish();
      return;
    }

    dialog.dataset.state = "closing";
    closeTimerRef.current = window.setTimeout(finish, MONEY_SHEET_EXIT_MS);
  }, [open]);

  useEffect(() => {
    return () => {
      window.clearTimeout(closeTimerRef.current);
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, []);

  return dialogRef;
}

export function MoneyModal({
  open,
  labelledBy,
  describedBy,
  onCancel,
  onClose,
  children,
}: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  onCancel: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useMoneyModal(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: -1,
    startY: 0,
    offset: 0,
    lastY: 0,
    lastT: 0,
    velocity: 0,
  });

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (!open) {
      delete sheet.dataset.entered;
      return;
    }
    delete sheet.dataset.entered;
    if (prefersReducedMotion()) {
      sheet.dataset.entered = "";
      return;
    }
    const timer = window.setTimeout(() => {
      sheet.dataset.entered = "";
    }, MONEY_SHEET_ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  function clearSheetTransform() {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transform = "";
    sheet.style.transition = "";
    delete sheet.dataset.dragging;
  }

  function onGrabberPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      offset: 0,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    sheet.dataset.dragging = "true";
    sheet.style.transition = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onGrabberPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(1, event.timeStamp - drag.lastT);
    drag.offset = offset;
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    sheet.style.transform = `translateY(${offset}px)`;
  }

  function onGrabberPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = -1;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    const sheet = sheetRef.current;
    if (!sheet) return;
    const shouldDismiss =
      drag.offset >= MONEY_SHEET_DISMISS_PX || (drag.offset > 24 && drag.velocity > 0.6);
    if (shouldDismiss) {
      if (prefersReducedMotion()) {
        clearSheetTransform();
        onCancel();
        return;
      }
      sheet.style.transition = `transform ${MONEY_SHEET_EXIT_MS}ms ease-in`;
      sheet.style.transform = "translateY(100%)";
      onCancel();
      return;
    }
    if (prefersReducedMotion() || drag.offset === 0) {
      clearSheetTransform();
      return;
    }
    sheet.style.transition = `transform ${MONEY_SHEET_ENTER_MS}ms ease-out`;
    sheet.style.transform = "translateY(0)";
    window.setTimeout(() => {
      if (dragRef.current.pointerId === -1) clearSheetTransform();
    }, MONEY_SHEET_ENTER_MS);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.root}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onClose={() => {
        clearSheetTransform();
        onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        data-money-sheet=""
        data-state={open ? "open" : "closing"}
      >
        <div
          className={styles.grabberHit}
          data-money-sheet-grabber=""
          data-money-sheet-drag=""
          aria-hidden="true"
          onPointerDown={onGrabberPointerDown}
          onPointerMove={onGrabberPointerMove}
          onPointerUp={onGrabberPointerUp}
          onPointerCancel={onGrabberPointerUp}
        >
          <span className={styles.grabber} aria-hidden="true" />
        </div>
        {open ? children : null}
      </div>
    </dialog>
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
