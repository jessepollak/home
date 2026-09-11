"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./money-modal.module.css";

export const MONEY_SHEET_ENTER_MS = 280;
export const MONEY_SHEET_EXIT_MS = 220;
export const MONEY_SHEET_DISMISS_PX = 72;
export const MONEY_SHEET_FLICK_PX = 24;
export const MONEY_SHEET_FLICK_VELOCITY = 0.6;
export const MONEY_SHEET_FLICK_MAX_AGE_MS = 100;

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sheetHeight(sheet: HTMLElement) {
  return sheet.getBoundingClientRect().height || window.innerHeight;
}

function readTranslateY(sheet: HTMLElement) {
  const raw = getComputedStyle(sheet).transform;
  if (!raw || raw === "none") return 0;
  try {
    return new DOMMatrix(raw).m42;
  } catch {
    const match = /matrix(?:3d)?\((.+)\)/.exec(raw);
    if (!match) return 0;
    const parts = match[1].split(",").map(Number);
    return (raw.startsWith("matrix3d") ? parts[13] : parts[5]) || 0;
  }
}

function applySheetShift(
  sheet: HTMLElement,
  y: number,
  ms: number | null,
  ease = "ease-out",
) {
  sheet.style.transition = ms === null ? "none" : `transform ${ms}ms ${ease}`;
  sheet.style.transform = `translate3d(0, ${Math.max(0, y)}px, 0)`;
}

function applySheetHeight(
  sheet: HTMLElement,
  heightPx: number | null,
  ms: number | null,
) {
  sheet.style.transition = ms === null ? "none" : `height ${ms}ms ease-out`;
  sheet.style.height = heightPx === null ? "" : `${Math.max(0, heightPx)}px`;
}

function applySheetReturn(sheet: HTMLElement, heightPx: number, ms: number) {
  sheet.style.transition = `transform ${ms}ms ease-out, height ${ms}ms ease-out`;
  sheet.style.transform = "translate3d(0, 0px, 0)";
  sheet.style.height = `${Math.max(0, heightPx)}px`;
}

function measureNaturalSheetHeight(sheet: HTMLElement) {
  const previousHeight = sheet.style.height;
  const previousTransition = sheet.style.transition;
  sheet.style.transition = "none";
  sheet.style.height = "auto";
  const measured = sheet.getBoundingClientRect().height || sheet.scrollHeight;
  sheet.style.height = previousHeight;
  sheet.style.transition = previousTransition;
  return measured;
}

function clearSheetEnter(sheet: HTMLElement) {
  sheet.style.height = "";
  sheet.style.clipPath = "";
}

let bodyScrollLockCount = 0;
let bodyScrollLockOverflow = "";

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    bodyScrollLockOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyScrollLockOverflow;
    bodyScrollLockOverflow = "";
  }
}

export function useMoneyModal(
  open: boolean,
  immediate = false,
): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number>(0);
  const ownsScrollLockRef = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const clearCloseTimer = () => {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
    };
    const unlockScroll = () => {
      if (!ownsScrollLockRef.current) return;
      unlockBodyScroll();
      ownsScrollLockRef.current = false;
    };
    const finish = () => {
      clearCloseTimer();
      if (dialog.open) dialog.close();
      unlockScroll();
      restoreFocusRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    };

    clearCloseTimer();

    if (open) {
      if (!dialog.open) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        lockBodyScroll();
        ownsScrollLockRef.current = true;
        dialog.showModal();
      }
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        dialog.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
          ?.focus({ preventScroll: true });
      }
      dialog.dataset.state = "open";
      return;
    }

    if (!dialog.open) {
      dialog.dataset.state = "closed";
      return;
    }

    if (dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }

    if (prefersReducedMotion() || immediate) {
      dialog.dataset.state = "closed";
      finish();
      return;
    }

    dialog.dataset.state = "closing";
    closeTimerRef.current = window.setTimeout(finish, MONEY_SHEET_EXIT_MS);
  }, [immediate, open]);

  useEffect(() => {
    return () => {
      window.clearTimeout(closeTimerRef.current);
      if (ownsScrollLockRef.current) {
        unlockBodyScroll();
        ownsScrollLockRef.current = false;
      }
    };
  }, []);

  return dialogRef;
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
  const dialogRef = useMoneyModal(open, immediate);
  const sheetRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number>(0);
  const closingRef = useRef(false);
  const dragRef = useRef({
    pointerId: -1,
    startY: 0,
    offset: 0,
    baseY: 0,
    velocity: 0,
    lastSampleT: 0,
    targetHeight: 0,
    dismissing: false,
    samples: [] as Array<{ y: number; t: number }>,
  });
  const [contentMounted, setContentMounted] = useState(open);
  const [presentedChildren, setPresentedChildren] = useState<ReactNode>(children);
  if (open && presentedChildren !== children) setPresentedChildren(children);
  if (open && !contentMounted) setContentMounted(true);

  const clearSettleTimer = useCallback(() => {
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = 0;
  }, []);

  const finishSheetReturn = useCallback((sheet: HTMLElement, targetHeight: number) => {
    clearSettleTimer();
    sheet.dataset.entered = "";
    if (prefersReducedMotion()) {
      applySheetShift(sheet, 0, null);
      clearSheetEnter(sheet);
      return;
    }
    applySheetReturn(sheet, targetHeight, MONEY_SHEET_ENTER_MS);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = 0;
      if (dragRef.current.pointerId === -1 && !dragRef.current.dismissing && open) {
        clearSheetEnter(sheet);
        sheet.style.transition = "none";
      }
    }, MONEY_SHEET_ENTER_MS);
  }, [clearSettleTimer, open]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    clearSettleTimer();

    if (open) {
      dragRef.current.dismissing = false;
      delete sheet.dataset.entered;
      const reopening = closingRef.current;
      closingRef.current = false;

      if (prefersReducedMotion()) {
        applySheetShift(sheet, 0, null);
        clearSheetEnter(sheet);
        sheet.dataset.entered = "";
        return;
      }

      if (reopening) {
        const currentHeight = sheet.getBoundingClientRect().height;
        const currentY = Math.max(0, readTranslateY(sheet));
        const target = measureNaturalSheetHeight(sheet);
        sheet.style.transition = "none";
        sheet.style.height = `${currentHeight}px`;
        sheet.style.transform = `translate3d(0, ${currentY}px, 0)`;
        const frame = window.requestAnimationFrame(() => {
          if (dragRef.current.pointerId !== -1) return;
          finishSheetReturn(sheet, target);
          sheet.dataset.entered = "";
        });
        return () => window.cancelAnimationFrame(frame);
      }

      const target = measureNaturalSheetHeight(sheet);
      applySheetShift(sheet, 0, null);
      applySheetHeight(sheet, 0, null);
      const frame = window.requestAnimationFrame(() => {
        if (dragRef.current.pointerId !== -1) return;
        applySheetHeight(sheet, target, MONEY_SHEET_ENTER_MS);
        sheet.dataset.entered = "";
      });
      const unlock = window.setTimeout(() => {
        if (dragRef.current.pointerId !== -1 || dragRef.current.dismissing) return;
        clearSheetEnter(sheet);
        sheet.style.transition = "none";
      }, MONEY_SHEET_ENTER_MS);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(unlock);
      };
    }

    if (!dialogRef.current?.open) {
      closingRef.current = false;
      return;
    }
    closingRef.current = true;
    if (dragRef.current.dismissing) return;
    const currentHeight = sheet.getBoundingClientRect().height;
    applySheetHeight(sheet, currentHeight, null);
    if (prefersReducedMotion() || immediate) {
      applySheetShift(sheet, currentHeight || sheetHeight(sheet), null);
      return;
    }
    applySheetShift(sheet, currentHeight || sheetHeight(sheet), MONEY_SHEET_EXIT_MS, "ease-in");
  }, [clearSettleTimer, dialogRef, finishSheetReturn, immediate, open]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  function clearSheetTransform() {
    const sheet = sheetRef.current;
    if (!sheet) return;
    clearSettleTimer();
    sheet.style.transform = "";
    sheet.style.transition = "";
    clearSheetEnter(sheet);
    delete sheet.dataset.dragging;
    delete sheet.dataset.entered;
    closingRef.current = false;
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  function onGrabberPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    clearSettleTimer();
    const currentY = Math.max(0, readTranslateY(sheet));
    const currentHeight = sheet.getBoundingClientRect().height;
    const targetHeight = measureNaturalSheetHeight(sheet);
    const now = event.timeStamp || performance.now();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      offset: 0,
      baseY: currentY,
      velocity: 0,
      lastSampleT: now,
      targetHeight,
      dismissing: false,
      samples: [{ y: event.clientY, t: now }],
    };
    sheet.dataset.dragging = "true";
    sheet.style.transition = "none";
    sheet.style.height = `${currentHeight}px`;
    sheet.style.transform = `translate3d(0, ${currentY}px, 0)`;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onGrabberPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const now = event.timeStamp || performance.now();
    const offset = Math.max(0, event.clientY - drag.startY);
    const shift = drag.baseY + offset;
    drag.samples.push({ y: event.clientY, t: now });
    const windowStart = now - 80;
    while (drag.samples.length > 1 && drag.samples[0].t < windowStart) {
      drag.samples.shift();
    }
    const first = drag.samples[0];
    drag.offset = offset;
    drag.velocity = (event.clientY - first.y) / Math.max(1, now - first.t);
    drag.lastSampleT = now;
    applySheetShift(sheet, shift, null);
  }

  function onGrabberPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = -1;
    finishPointer(event);
    const sheet = sheetRef.current;
    if (!sheet) return;
    const now = event.timeStamp || performance.now();
    const releaseVelocity = now - drag.lastSampleT <= MONEY_SHEET_FLICK_MAX_AGE_MS
      ? drag.velocity
      : 0;
    const shouldDismiss =
      drag.offset >= MONEY_SHEET_DISMISS_PX
      || (drag.offset > MONEY_SHEET_FLICK_PX && releaseVelocity > MONEY_SHEET_FLICK_VELOCITY);
    delete sheet.dataset.dragging;
    if (shouldDismiss) {
      const accepted = onCancel() !== false;
      if (!accepted) {
        finishSheetReturn(sheet, drag.targetHeight);
        return;
      }
      drag.dismissing = true;
      if (prefersReducedMotion()) {
        applySheetShift(sheet, sheetHeight(sheet), null);
        return;
      }
      applySheetShift(sheet, sheetHeight(sheet), MONEY_SHEET_EXIT_MS, "ease-in");
      return;
    }
    if (drag.offset === 0 && drag.baseY === 0 && sheet.style.height === "") {
      applySheetShift(sheet, 0, null);
      return;
    }
    finishSheetReturn(sheet, drag.targetHeight);
  }

  function requestCancel() {
    return onCancel() !== false;
  }

  const visibleChildren = open
    ? children
    : contentMounted && !immediate
      ? presentedChildren
      : null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.root}
      tabIndex={-1}
      aria-labelledby={open ? labelledBy : undefined}
      aria-describedby={open ? describedBy : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestCancel();
      }}
      onClose={() => {
        clearSheetTransform();
        setContentMounted(false);
        setPresentedChildren(null);
        onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        data-money-sheet=""
        data-state={open ? "open" : "closing"}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
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
        {visibleChildren}
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
