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
import { animate } from "motion/react";
import { MONEY_SHEET_SPRING } from "@/shared/motion";
import styles from "./money-modal.module.css";

export const MONEY_SHEET_DISMISS_FRACTION = 0.25;
export const MONEY_SHEET_DISMISS_PROJECTION_MS = 240;
export const MONEY_SHEET_FLICK_MAX_AGE_MS = 100;
export const MONEY_SHEET_VELOCITY_WINDOW_MS = 160;

type SheetPositionOwner =
  | "idle"
  | "opening"
  | "drag"
  | "returning"
  | "pending-close"
  | "closing";

type SheetAnimation = {
  owner: Extract<SheetPositionOwner, "opening" | "returning" | "closing">;
  sheet: HTMLElement;
  stop: () => void;
};

type PendingSheetClose = {
  translateY: number;
  velocity: number;
};

function setSheetPositionOwner(sheet: HTMLElement, owner: SheetPositionOwner) {
  sheet.dataset.positionOwner = owner;
}

/**
 * Resolves a drag release against the shared proportional threshold. Recent
 * upward velocity always resolves back toward the open position, even when the
 * current translate already cleared the fixed distance threshold (the
 * down-pause-up reopen case). Downward or stationary releases use a projected
 * destination: current translate plus the signed velocity carried over a short
 * spring response horizon.
 */
export function resolveSheetDragDismiss(
  translateY: number,
  releaseVelocity: number,
  sheetHeightPx: number,
) {
  const dismissDistance = sheetHeightPx * MONEY_SHEET_DISMISS_FRACTION;
  if (releaseVelocity < 0) return false;
  return (
    translateY + releaseVelocity * MONEY_SHEET_DISMISS_PROJECTION_MS
    >= dismissDistance
  );
}

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

function applySheetShift(sheet: HTMLElement, y: number) {
  sheet.style.transition = "none";
  sheet.style.transform = `translate3d(0, ${Math.max(0, y)}px, 0)`;
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
): {
  dialogRef: RefObject<HTMLDialogElement | null>;
  finishClose: () => void;
} {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const ownsScrollLockRef = useRef(false);

  const finishClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (ownsScrollLockRef.current) {
      unlockBodyScroll();
      ownsScrollLockRef.current = false;
    }
    restoreFocusRef.current?.focus({ preventScroll: true });
    restoreFocusRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

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

    // MoneyModal owns finalization in every motion mode so the sheet can claim
    // closing ownership before either an exit spring or an immediate close.
    dialog.dataset.state = "closing";
  }, [open]);

  useEffect(() => {
    return () => {
      if (ownsScrollLockRef.current) {
        unlockBodyScroll();
        ownsScrollLockRef.current = false;
      }
    };
  }, []);

  return { dialogRef, finishClose };
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
  const { dialogRef, finishClose } = useMoneyModal(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetAnimRef = useRef<SheetAnimation | null>(null);
  const pendingCloseRef = useRef<PendingSheetClose | null>(null);
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

  const stopSheetAnim = useCallback(() => {
    const active = sheetAnimRef.current;
    if (!active) return;
    sheetAnimRef.current = null;
    active.stop();
    if (active.sheet.dataset.positionOwner === active.owner) {
      setSheetPositionOwner(active.sheet, "idle");
    }
  }, []);

  const startSheetYSpring = useCallback((
    sheet: HTMLElement,
    owner: SheetAnimation["owner"],
    fromY: number,
    toY: number,
    velocity: number,
    onComplete?: () => void,
  ) => {
    stopSheetAnim();
    const start = Math.max(0, fromY);
    const target = Math.max(0, toY);
    let controls: { stop: () => void } | null = null;
    let completed = false;
    const writeY = (latest: number) => {
      sheet.style.transform = `translate3d(0, ${Math.max(0, latest)}px, 0)`;
    };
    const animation: SheetAnimation = {
      owner,
      sheet,
      stop: () => controls?.stop(),
    };
    const finish = () => {
      if (completed) return;
      completed = true;
      if (sheetAnimRef.current === animation) sheetAnimRef.current = null;
      writeY(target);
      if (sheet.dataset.positionOwner === owner) {
        setSheetPositionOwner(sheet, "idle");
      }
      onComplete?.();
    };

    sheet.style.transition = "none";
    setSheetPositionOwner(sheet, owner);
    writeY(start);

    const atOpenTarget = owner !== "closing"
      && start <= target + 0.5
      && velocity <= 0;
    if (atOpenTarget) {
      finish();
      return;
    }

    sheetAnimRef.current = animation;
    controls = animate(start, target, {
      ...MONEY_SHEET_SPRING,
      velocity: velocity * 1000,
      onUpdate: (latest) => {
        if (sheetAnimRef.current !== animation) return;
        const reachedTarget = target < start
          ? latest <= target
          : target > start && latest >= target;
        if (reachedTarget) {
          controls?.stop();
          finish();
          return;
        }
        writeY(latest);
      },
      onComplete: finish,
    });
    if (completed) controls.stop();
  }, [stopSheetAnim]);

  const finishSheetReturn = useCallback((sheet: HTMLElement, targetHeight: number, releaseVelocity = 0) => {
    sheet.dataset.entered = "";
    if (prefersReducedMotion()) {
      stopSheetAnim();
      setSheetPositionOwner(sheet, "returning");
      applySheetShift(sheet, 0);
      clearSheetEnter(sheet);
      setSheetPositionOwner(sheet, "idle");
      return;
    }
    sheet.style.height = `${Math.max(0, targetHeight)}px`;
    startSheetYSpring(sheet, "returning", Math.max(0, readTranslateY(sheet)), 0, releaseVelocity, () => {
      if (dragRef.current.pointerId === -1 && !dragRef.current.dismissing && open) {
        clearSheetEnter(sheet);
        sheet.style.transition = "none";
      }
    });
  }, [open, startSheetYSpring, stopSheetAnim]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    if (open) {
      pendingCloseRef.current = null;
      dragRef.current.dismissing = false;
      const reopening = closingRef.current;
      closingRef.current = false;
      delete sheet.dataset.entered;

      if (prefersReducedMotion()) {
        stopSheetAnim();
        setSheetPositionOwner(sheet, "opening");
        applySheetShift(sheet, 0);
        clearSheetEnter(sheet);
        sheet.dataset.entered = "";
        setSheetPositionOwner(sheet, "idle");
        return;
      }

      if (reopening) {
        const currentHeight = sheet.getBoundingClientRect().height;
        const currentY = Math.max(0, readTranslateY(sheet));
        const target = measureNaturalSheetHeight(sheet);
        sheet.style.transition = "none";
        sheet.style.height = `${currentHeight}px`;
        sheet.style.transform = `translate3d(0, ${currentY}px, 0)`;
        sheet.dataset.entered = "";
        finishSheetReturn(sheet, target);
        return;
      }

      stopSheetAnim();
      clearSheetEnter(sheet);
      sheet.dataset.entered = "";
      const openingDistance = sheetHeight(sheet);
      if (openingDistance <= 0) {
        setSheetPositionOwner(sheet, "idle");
        applySheetShift(sheet, 0);
        return;
      }
      startSheetYSpring(sheet, "opening", openingDistance, 0, 0, () => {
        if (dragRef.current.pointerId === -1 && !dragRef.current.dismissing && open) {
          sheet.style.transition = "none";
        }
      });
      return;
    }

    if (!dialogRef.current?.open) {
      closingRef.current = false;
      return;
    }
    closingRef.current = true;
    const closesImmediately = prefersReducedMotion() || immediate;
    if (dragRef.current.pointerId !== -1 && !closesImmediately) return;
    const pendingClose = pendingCloseRef.current;
    pendingCloseRef.current = null;
    const currentHeight = sheet.getBoundingClientRect().height;
    sheet.style.height = `${Math.max(0, currentHeight)}px`;
    const fromY = pendingClose?.translateY ?? Math.max(0, readTranslateY(sheet));
    const releaseVelocity = pendingClose?.velocity ?? 0;
    if (closesImmediately) {
      stopSheetAnim();
      setSheetPositionOwner(sheet, "closing");
      applySheetShift(sheet, currentHeight || sheetHeight(sheet));
      finishClose();
      return;
    }
    startSheetYSpring(
      sheet,
      "closing",
      fromY,
      sheetHeight(sheet),
      releaseVelocity,
      finishClose,
    );
  }, [dialogRef, finishClose, finishSheetReturn, immediate, open, startSheetYSpring, stopSheetAnim]);

  useEffect(() => stopSheetAnim, [stopSheetAnim]);

  function clearSheetTransform() {
    stopSheetAnim();
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transform = "";
    sheet.style.transition = "";
    clearSheetEnter(sheet);
    delete sheet.dataset.dragging;
    delete sheet.dataset.entered;
    delete sheet.dataset.positionOwner;
    pendingCloseRef.current = null;
    dragRef.current.pointerId = -1;
    dragRef.current.dismissing = false;
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
    stopSheetAnim();
    setSheetPositionOwner(sheet, "drag");
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
    const windowStart = now - MONEY_SHEET_VELOCITY_WINDOW_MS;
    while (drag.samples.length > 2 && drag.samples[0].t < windowStart) {
      drag.samples.shift();
    }
    const newest = drag.samples[drag.samples.length - 1];
    const previous = drag.samples[drag.samples.length - 2] ?? newest;
    drag.offset = offset;
    drag.velocity = (newest.y - previous.y) / Math.max(1, newest.t - previous.t);
    drag.lastSampleT = now;
    applySheetShift(sheet, shift);
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
    const translateY = Math.max(0, drag.baseY + drag.offset);
    delete sheet.dataset.dragging;
    if (!open) {
      // An external close started mid-drag: keep closing from the released
      // position/velocity instead of dropping back to the open position.
      if (prefersReducedMotion()) {
        applySheetShift(sheet, sheetHeight(sheet));
        return;
      }
      startSheetYSpring(sheet, "closing", translateY, sheetHeight(sheet), releaseVelocity, finishClose);
      return;
    }
    if (resolveSheetDragDismiss(translateY, releaseVelocity, sheetHeight(sheet))) {
      drag.dismissing = true;
      pendingCloseRef.current = { translateY, velocity: releaseVelocity };
      setSheetPositionOwner(sheet, "pending-close");
      const accepted = onCancel() !== false;
      if (!accepted) {
        pendingCloseRef.current = null;
        drag.dismissing = false;
        finishSheetReturn(sheet, drag.targetHeight, releaseVelocity);
      }
      return;
    }
    finishSheetReturn(sheet, drag.targetHeight, releaseVelocity);
  }

  function onGrabberPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
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
    const translateY = Math.max(0, drag.baseY + drag.offset);
    delete sheet.dataset.dragging;
    if (!open) {
      if (prefersReducedMotion()) {
        applySheetShift(sheet, sheetHeight(sheet));
        return;
      }
      startSheetYSpring(sheet, "closing", translateY, sheetHeight(sheet), releaseVelocity, finishClose);
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
          onPointerCancel={onGrabberPointerCancel}
          onLostPointerCapture={onGrabberPointerCancel}
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
