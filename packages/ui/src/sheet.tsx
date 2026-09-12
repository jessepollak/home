"use client";

import { animate } from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

const SHEET_SPRING = {
  type: "spring",
  stiffness: 750,
  damping: 55,
  mass: 1,
  restDelta: 0.5,
  restSpeed: 10,
} as const;

export const SHEET_DISMISS_FRACTION = 0.25;
export const SHEET_DISMISS_PROJECTION_MS = 240;
export const SHEET_FLICK_MAX_AGE_MS = 100;
export const SHEET_VELOCITY_WINDOW_MS = 160;

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

type SheetAccessibleName =
  | { title: string; "aria-labelledby"?: never }
  | { title?: never; "aria-labelledby": string };

export type SheetProps = SheetAccessibleName & {
  open: boolean;
  onDismiss: () => boolean | void;
  children: ReactNode;
  className?: string;
  header?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  dragDismiss?: boolean;
  "aria-describedby"?: string;
  /** Bypasses exit motion for privacy-sensitive teardown. */
  immediate?: boolean;
  /** Runs after the native dialog has fully closed. */
  onClosed?: () => void;
};

function setSheetPositionOwner(sheet: HTMLElement, owner: SheetPositionOwner) {
  sheet.dataset.positionOwner = owner;
}

/** Resolve a drag release against the proportional threshold and projected velocity. */
export function resolveSheetDragDismiss(
  translateY: number,
  releaseVelocity: number,
  sheetHeightPx: number,
) {
  const dismissDistance = sheetHeightPx * SHEET_DISMISS_FRACTION;
  if (releaseVelocity < 0) return false;
  return (
    translateY + releaseVelocity * SHEET_DISMISS_PROJECTION_MS
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

export function useSheetLifecycle(
  open: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
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
      let justOpened = false;
      if (!dialog.open) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        lockBodyScroll();
        ownsScrollLockRef.current = true;
        dialog.showModal();
        justOpened = true;
      }
      if (justOpened || document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        const initialFocus = initialFocusRef?.current
          ?? dialog.querySelector<HTMLElement>(
            "[data-initial-focus]:not(:disabled), button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
          );
        initialFocus?.focus({ preventScroll: true });
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
    dialog.dataset.state = "closing";
  }, [initialFocusRef, open]);

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

export const Sheet = forwardRef<HTMLDialogElement, SheetProps>(function Sheet({
  open,
  title,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  onDismiss,
  children,
  className,
  header,
  footer,
  initialFocusRef,
  dismissible = true,
  dragDismiss = false,
  immediate = false,
  onClosed,
}: SheetProps, forwardedRef) {
  const { dialogRef, finishClose } = useSheetLifecycle(open, initialFocusRef);
  useImperativeHandle(forwardedRef, () => dialogRef.current as HTMLDialogElement, [dialogRef]);
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
  // Content mounts when the sheet first opens (no hidden render at startup) and,
  // while the exit spring runs, keeps rendering the snapshot taken while open so
  // a parent that resets its state on close cannot flip the closing sheet's content.
  const [contentMounted, setContentMounted] = useState(open);
  const [presented, setPresented] = useState<{ children: ReactNode; header: ReactNode; footer: ReactNode }>(
    { children, header, footer },
  );
  if (open && (presented.children !== children || presented.header !== header || presented.footer !== footer)) {
    setPresented({ children, header, footer });
  }
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
      ...SHEET_SPRING,
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
      sheet.dataset.state = "open";
      sheet.removeAttribute("aria-hidden");
      sheet.removeAttribute("inert");
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
    sheet.dataset.state = "closing";
    sheet.setAttribute("aria-hidden", "true");
    sheet.setAttribute("inert", "");
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
    if (!dragDismiss || !dismissible || event.button !== 0 || !open) return;
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
    const windowStart = now - SHEET_VELOCITY_WINDOW_MS;
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
    const releaseVelocity = now - drag.lastSampleT <= SHEET_FLICK_MAX_AGE_MS
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
    if (resolveSheetDragDismiss(translateY, releaseVelocity, sheetHeight(sheet))) {
      drag.dismissing = true;
      pendingCloseRef.current = { translateY, velocity: releaseVelocity };
      setSheetPositionOwner(sheet, "pending-close");
      const accepted = onDismiss() !== false;
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
    const releaseVelocity = now - drag.lastSampleT <= SHEET_FLICK_MAX_AGE_MS
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

  function requestDismiss() {
    if (!dismissible) return false;
    return onDismiss() !== false;
  }

  const showSnapshot = !open && contentMounted && !immediate;
  const visibleChildren = open ? children : showSnapshot ? presented.children : null;
  const visibleHeader = open ? header : showSnapshot ? presented.header : null;
  const visibleFooter = open ? footer : showSnapshot ? presented.footer : null;
  const usesSlots = header !== undefined || footer !== undefined;

  return (
    <dialog
      ref={dialogRef}
      className={`home-ui-sheet${className ? ` ${className}` : ""}`}
      tabIndex={-1}
      aria-label={title}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        requestDismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestDismiss();
      }}
      onClose={() => {
        clearSheetTransform();
        setContentMounted(false);
        onClosed?.();
      }}
    >
      <div
        ref={sheetRef}
        className="home-ui-sheet__panel"
        data-home-ui-sheet-panel=""
        data-money-sheet=""
        data-state="open"
        data-drag-dismiss={dragDismiss ? "true" : "false"}
      >
        {dragDismiss && dismissible ? (
          <div
            className="home-ui-sheet__grabber-hit"
            data-money-sheet-grabber=""
            data-money-sheet-drag=""
            aria-hidden="true"
            onPointerDown={onGrabberPointerDown}
            onPointerMove={onGrabberPointerMove}
            onPointerUp={onGrabberPointerUp}
            onPointerCancel={onGrabberPointerCancel}
            onLostPointerCapture={onGrabberPointerCancel}
          >
            <span className="home-ui-sheet__grabber" aria-hidden="true" />
          </div>
        ) : null}
        {usesSlots ? (
          <>
            {visibleHeader ? <div className="home-ui-sheet__header">{visibleHeader}</div> : null}
            <div className="home-ui-sheet__body">{visibleChildren}</div>
            {visibleFooter ? <div className="home-ui-sheet__footer">{visibleFooter}</div> : null}
          </>
        ) : visibleChildren}
      </div>
    </dialog>
  );
});
