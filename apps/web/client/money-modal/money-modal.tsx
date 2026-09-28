"use client";

import { useReactiveExpiry } from "@/client/actions/expiry";
import { LoadErrorCard } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerSwipeHandle,
  DrawerTitle,
  opensSoftKeyboard,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { MONEY_ACTION_ID_ATTRIBUTE } from "@/shared/money-actions";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { ArrowLeft, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

const MoneyModalPendingContext = createContext({ pending: false, register: (_id: symbol, _pending: boolean) => {} });
const MoneyModalStepContext = createContext<((report: StepReport) => void) | null>(null);
const MoneyModalExitContext = createContext<() => void>(() => {});
let handoffReturnFocus: HTMLElement | null = null;
const MoneyModalHandoffContext = createContext(false);
/** @public shared money-flow step contract (#1058) */
export const MONEY_MODAL_STEP_DURATION_MS = 180;
/** @public shared money-flow step contract (#1058) */
export const MONEY_MODAL_STEP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const MONEY_MODAL_STEP_ENTER_OPACITY = 0.4;
const desktopDialogQuery = "(min-width: 64rem)";

type StepReport = { step: string; depth: number; element: HTMLElement; initialFocusRef?: RefObject<HTMLElement | null> };

const STEP_FOCUS_TARGETS = ["[data-money-amount-input]:not(:disabled)", "[data-money-step-focus]:not(:disabled)", "[data-initial-focus]:not(:disabled)"];

function stepFocusTarget(report: StepReport, allowAmountInput: boolean) {
  if (report.initialFocusRef?.current) return report.initialFocusRef.current;
  for (const selector of allowAmountInput ? STEP_FOCUS_TARGETS : STEP_FOCUS_TARGETS.slice(1)) {
    const target = report.element.querySelector<HTMLElement>(selector);
    if (target) return target;
  }
  return report.element;
}

function MoneyModalStepHost({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previous = useRef<StepReport | null>(null);
  const lastHeight = useRef(0);
  const lastFocused = useRef<HTMLElement | null>(null);
  const running = useRef<{ step?: Animation; height?: Animation }>({});
  const { pending } = useContext(MoneyModalPendingContext);

  const recoverFocus = useCallback(() => {
    const current = previous.current;
    const host = hostRef.current ?? current?.element.parentElement;
    if (!current || !host) return;
    const active = document.activeElement;
    const parked = active === current.element;
    const lostByRemoval = !host.closest("[data-slot=drawer-popup]")?.contains(active) && lastFocused.current !== null && !lastFocused.current.isConnected;
    if (!parked && !lostByRemoval) return;
    const target = stepFocusTarget(current, lostByRemoval);
    if (target !== active) target.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!pending) recoverFocus();
  }, [pending, recoverFocus]);

  const stopAnimations = useCallback(() => {
    const animations = running.current;
    running.current = {};
    if (animations.step) {
      animations.step.onfinish = null;
      animations.step.oncancel = null;
      void animations.step.finished.catch(() => {});
      animations.step.cancel();
    }
    if (animations.height) {
      animations.height.onfinish = null;
      animations.height.oncancel = null;
      void animations.height.finished.catch(() => {});
      animations.height.cancel();
    }
    hostRef.current?.style.removeProperty("overflow");
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (!running.current.height) lastHeight.current = host.offsetHeight;
    });
    observer?.observe(host);
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    host.addEventListener("focusin", onFocusIn);
    return () => {
      observer?.disconnect();
      host.removeEventListener("focusin", onFocusIn);
      stopAnimations();
    };
  }, [stopAnimations]);

  const report = useCallback((next: StepReport) => {
    const host = hostRef.current ?? next.element.parentElement;
    if (!host) return;
    const prior = previous.current;
    previous.current = next;
    if (!prior) {
      lastHeight.current = host.offsetHeight;
      stepFocusTarget(next, true).focus({ preventScroll: true });
      return;
    }
    if (prior.step === next.step) {
      recoverFocus();
      return;
    }
    const startHeight = running.current.height ? host.offsetHeight : lastHeight.current;
    stopAnimations();
    stepFocusTarget(next, true).focus({ preventScroll: true });
    const endHeight = host.offsetHeight;
    lastHeight.current = endHeight;
    if (typeof next.element.animate !== "function") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const direction = next.depth > prior.depth ? 1 : next.depth < prior.depth ? -1 : 0;
    const x = direction * (getComputedStyle(host).direction === "rtl" ? -16 : 16);
    const stepAnimation = next.element.animate(
      reduced ? [{ opacity: MONEY_MODAL_STEP_ENTER_OPACITY }, { opacity: 1 }] : [
        { opacity: MONEY_MODAL_STEP_ENTER_OPACITY, transform: `translate3d(${x}px,0,0)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: reduced ? 120 : MONEY_MODAL_STEP_DURATION_MS, easing: MONEY_MODAL_STEP_EASING },
    );
    running.current.step = stepAnimation;
    const finishStep = () => {
      if (running.current.step === stepAnimation) running.current.step = undefined;
    };
    stepAnimation.onfinish = finishStep;
    stepAnimation.oncancel = finishStep;
    if (reduced || Math.abs(endHeight - startHeight) < 1 || typeof host.animate !== "function") return;
    host.style.setProperty("overflow", "hidden");
    const heightAnimation = host.animate(
      [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
      { duration: MONEY_MODAL_STEP_DURATION_MS, easing: MONEY_MODAL_STEP_EASING },
    );
    running.current.height = heightAnimation;
    const finishHeight = () => {
      if (running.current.height !== heightAnimation) return;
      running.current.height = undefined;
      host.style.removeProperty("overflow");
      lastHeight.current = host.offsetHeight;
    };
    heightAnimation.onfinish = finishHeight;
    heightAnimation.oncancel = finishHeight;
  }, [recoverFocus, stopAnimations]);

  return <MoneyModalStepContext value={report}><div ref={hostRef} data-slot="money-modal-steps" className="flex min-h-0 flex-1 flex-col">{children}</div></MoneyModalStepContext>;
}

/** @public shared money-flow step contract (#1058) */
export function MoneyModalStep({ step, depth = 0, initialFocusRef, children }: {
  step: string; depth?: number; initialFocusRef?: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const report = useContext(MoneyModalStepContext);
  if (!report) throw new Error("MoneyModalStep requires AppDrawer");
  return <StepContent key={step} step={step} depth={depth} initialFocusRef={initialFocusRef} report={report}>{children}</StepContent>;
}

function StepContent({ step, depth, initialFocusRef, report, children }: {
  step: string; depth: number; initialFocusRef?: RefObject<HTMLElement | null>;
  report: (value: StepReport) => void; children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (elementRef.current) report({ step, depth, element: elementRef.current, initialFocusRef });
  }, [step, depth, initialFocusRef, report]);
  return <div ref={elementRef} data-money-step={step} className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1}>{children}</div>;
}

function ignoreDesktopSwipe(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.toggleAttribute("data-base-ui-swipe-ignore", window.matchMedia?.(desktopDialogQuery).matches ?? false);
}

export function AppDrawer({ open, labelledBy, describedBy, immediate = false, variant = "default", initialFocusRef, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean; variant?: "default" | "money";
  initialFocusRef?: RefObject<HTMLElement | null>; onCancel: () => boolean | void;
  onClose?: () => void; children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const handoff = useContext(MoneyModalHandoffContext);
  const handoffOnMountRef = useRef(handoff);

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    if (handoffOnMountRef.current) lastOutsideFocusRef.current ??= handoffReturnFocus;
    handoffReturnFocus = null;
    return () => {
      if (openRef.current) handoffReturnFocus = lastOutsideFocusRef.current;
    };
  }, []);

  useEffect(() => {
    if (open) return;
    const rememberOutsideFocus = (target: EventTarget | null) => {
      if (target instanceof HTMLButtonElement && !target.closest("[data-money-sheet]")) {
        lastOutsideFocusRef.current = target;
      }
    };
    rememberOutsideFocus(document.activeElement);
    const onFocusIn = (event: FocusEvent) => rememberOutsideFocus(event.target);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    const active = document.activeElement;
    if (open || !(active instanceof HTMLElement) || !popup?.contains(active) || !opensSoftKeyboard(active)) return;
    (active.closest<HTMLElement>("[data-money-step]") ?? popup).focus({ preventScroll: true });
    if (document.activeElement === active) active.blur();
  }, [open]);

  const exit = useCallback(() => { onCancel(); }, [onCancel]);

  return (
    <MoneyModalExitContext value={exit}>
    <Drawer open={open} modal keyboardAware swipeDirection="down" onOpenChange={(nextOpen, eventDetails) => {
      if (nextOpen) return;
      if (onCancel() === false) eventDetails.cancel();
    }} onOpenChangeComplete={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DrawerContent
        ref={popupRef}
        variant={variant}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        initialFocus={initialFocusRef ?? (() => popupRef.current?.querySelector<HTMLElement>("[data-money-amount-input]:not(:disabled)") ?? popupRef.current?.querySelector<HTMLElement>("[data-initial-focus]:not(:disabled)") ?? true)}
        finalFocus={() => {
          const target = lastOutsideFocusRef.current;
          if (openRef.current || opensSoftKeyboard(target)) return false;
          return target?.isConnected && target.getClientRects().length > 0 && !target.matches(":disabled") && !target.closest("[hidden], [inert]") ? target : true;
        }}
        data-money-sheet=""
        onPointerDownCapture={variant === "money" ? ignoreDesktopSwipe : undefined}
        immediate={immediate}
        className="max-h-[min(88svh,calc(100dvh_-_var(--sheet-keyboard-top,0px)_-_var(--sheet-keyboard-inset,0px)_-_2rem))] sm:mx-auto sm:max-w-md"
      >
        <DrawerSwipeHandle data-money-sheet-grabber="" className={variant === "money" ? "lg:hidden" : undefined} />
        <MoneyModalStepHost>{children}</MoneyModalStepHost>
      </DrawerContent>
    </Drawer>
    </MoneyModalExitContext>
  );
}

export function MoneyModal({ open, labelledBy, describedBy, immediate = false, pending = false, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean; pending?: boolean;
  onCancel: () => boolean | void; onClose: () => void; children: ReactNode;
}) {
  const [registrants, setRegistrants] = useState<Set<symbol>>(() => new Set());
  const register = useCallback((id: symbol, active: boolean) => {
    setRegistrants((current) => {
      if (current.has(id) === active) return current;
      const next = new Set(current);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const effectivePending = pending || registrants.size > 0;
  const handoff = useContext(MoneyModalHandoffContext);
  const pendingValue = useMemo(() => ({ pending: effectivePending, register }), [effectivePending, register]);
  return <MoneyModalPendingContext value={pendingValue}><AppDrawer open={open} labelledBy={labelledBy} describedBy={describedBy} immediate={immediate || handoff} variant="money" onCancel={() => effectivePending ? false : onCancel()} onClose={onClose}>{children}</AppDrawer></MoneyModalPendingContext>;
}

/** @public shared money-flow step contract (#1058) */
export function useMoneyModalPending(pending: boolean) {
  const { register } = useContext(MoneyModalPendingContext);
  const id = useRef<symbol>(null);
  id.current ??= Symbol("money-modal-pending");
  useLayoutEffect(() => {
    const token = id.current!;
    register(token, pending);
    return () => register(token, false);
  }, [pending, register]);
}

/** @public shared money-flow step contract (#1058): the exit-journey intent shared by X, Escape, backdrop and swipe */
export function useMoneyModalExit() {
  return useContext(MoneyModalExitContext);
}

type MoneyModalHeaderProps = {
  title: string;
  titleId: string;
  closeLabel?: string;
} & (
  | { onBack: () => void; backDisabled?: boolean; assetControl?: never }
  | { onBack?: never; backDisabled?: never; assetControl?: ReactNode }
);

export function MoneyModalHeader(props: MoneyModalHeaderProps) {
  const { title, titleId, closeLabel = "Close" } = props;
  const exit = useContext(MoneyModalExitContext);
  const isCloseDisabled = useContext(MoneyModalPendingContext).pending;
  const onBack = "onBack" in props ? props.onBack : undefined;
  const backDisabled = "backDisabled" in props ? props.backDisabled ?? false : false;
  const assetControl = "assetControl" in props ? props.assetControl : undefined;
  return (
    <DrawerHeader className="grid shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center text-left">
      <div className="flex min-w-0 justify-start">
        {onBack ? <Button data-initial-focus={!backDisabled ? "" : undefined} variant="ghost" size="icon-lg" className="size-11" aria-label="Back" disabled={backDisabled} onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /></Button> : assetControl ?? <span />}
      </div>
      <DrawerTitle id={titleId} variant="money">{title}</DrawerTitle>
      <div className="flex min-w-0 justify-end">
        <Button data-initial-focus={!isCloseDisabled && (!onBack || backDisabled) ? "" : undefined} variant="ghost" size="icon-lg" className="size-11 shrink-0" aria-label={closeLabel} disabled={isCloseDisabled} onClick={exit}><X className="size-4" aria-hidden="true" /></Button>
      </div>
    </DrawerHeader>
  );
}

export function MoneyModalBody({ children, className = "", hasFooter = false }: { children: ReactNode; className?: string; hasFooter?: boolean }) {
  return (
    <div data-slot="money-modal-body" className={`flex min-h-0 flex-1 flex-col overflow-auto px-4 ${hasFooter ? "pb-4!" : "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!"} ${className}`.trim()}>
      {children}
    </div>
  );
}

/** @public shared money-flow step contract (#1058) */
export function MoneyModalStepLoading({ step, depth, title, titleId, onBack, closeLabel, failed, onRetry, placeholder }: {
  step: string; depth?: number; title: string; titleId: string; onBack?: () => void;
  closeLabel: string; failed: boolean; onRetry: () => void; placeholder?: ReactNode;
}) {
  return <MoneyModalStep step={step} depth={depth}>
    {onBack ? <MoneyModalHeader title={title} titleId={titleId} onBack={onBack} closeLabel={closeLabel} /> : <MoneyModalHeader title={title} titleId={titleId} closeLabel={closeLabel} />}
    <MoneyModalBody className="gap-4 pt-4">
      {failed ? <LoadErrorCard title="Couldn't load this step" onRetry={onRetry} /> : placeholder ? <div aria-busy="true"><div aria-hidden="true">{placeholder}</div><span role="status" className="sr-only">Loading</span></div> : <div aria-busy="true" className="flex min-h-36 flex-col gap-4"><Skeleton className="h-5 w-32" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><span role="status" className="sr-only">Loading</span></div>}
    </MoneyModalBody>
  </MoneyModalStep>;
}

type MoneyModalFooterProps = {
  primaryLabel: ReactNode; onPrimary?: () => void; primaryDisabled?: boolean; primaryLoading?: boolean; primaryType?: "button" | "submit"; primaryAutoFocus?: boolean;
  secondaryLabel?: ReactNode; onSecondary?: () => void; secondaryDisabled?: boolean;
};

export function MoneyModalFooter(props: MoneyModalFooterProps) {
  return <FooterButtons {...props} />;
}

export function MoneyConfirmFooter({ action, actionExpired = false, submitting = false, ...props }: MoneyModalFooterProps & { action: PreparedMoneyAction; actionExpired?: boolean; submitting?: boolean }) {
  return <FooterButtons {...props} action={action} actionExpired={actionExpired} submitting={submitting} />;
}

export function MoneyModalActions({ children }: { children: ReactNode }) {
  return <DrawerFooter>{children}</DrawerFooter>;
}

function FooterButtons({ primaryLabel, onPrimary, primaryDisabled = false, primaryLoading = false, primaryType = "button", primaryAutoFocus = false, secondaryLabel, onSecondary, secondaryDisabled = false, action, actionExpired = false, submitting = false }: MoneyModalFooterProps & { action?: PreparedMoneyAction; actionExpired?: boolean; submitting?: boolean }) {
  const { expired } = useReactiveExpiry(action?.expiresAt ?? null);
  const active = action && !actionExpired && !expired && Number.isFinite(Date.parse(action.expiresAt));
  return (
    <MoneyModalActions>
      <Button size="touch" type={primaryType} data-money-step-focus={primaryAutoFocus ? "" : undefined} disabled={primaryDisabled} loading={primaryLoading || submitting} onClick={onPrimary} {...(active ? { [MONEY_ACTION_ID_ATTRIBUTE]: action.id } : {})}>{primaryLabel}</Button>
      {secondaryLabel && onSecondary ? <Button size="touch" variant="ghost" disabled={secondaryDisabled || submitting} onClick={onSecondary}>{secondaryLabel}</Button> : null}
    </MoneyModalActions>
  );
}

export function moneySheetLoading({ title, titleId, closeLabel, onCancel, onClosed, placeholder }: {
  title: string; titleId?: string; closeLabel: string; onCancel: () => void; onClosed?: () => void; placeholder?: ReactNode;
}) {
  return {
    onCancel,
    onClosed,
    renderLoaded: (sheet: ReactNode) => <MoneyModalHandoff>{sheet}</MoneyModalHandoff>,
    render: ({ open, failed, retry, onCancel: cancel, onClosed: closed }: {
      open: boolean; failed: boolean; retry: () => void; onCancel: () => void; onClosed: () => void;
    }) => <MoneyModalLoadingSheet open={open} title={title} titleId={titleId} closeLabel={closeLabel} failed={failed} retry={retry} onCancel={cancel} onClosed={closed} placeholder={placeholder} />,
  };
}

function MoneyModalHandoff({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState(true);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInitial(false));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <MoneyModalHandoffContext value={initial}>{children}</MoneyModalHandoffContext>;
}

function MoneyModalLoadingSheet({ open, title, titleId, closeLabel, failed, retry, onCancel, onClosed, placeholder }: {
  open: boolean; title: string; titleId?: string; closeLabel: string; failed: boolean; retry: () => void;
  onCancel: () => void; onClosed: () => void; placeholder?: ReactNode;
}) {
  const generatedId = useId();
  const id = titleId ?? generatedId;
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const closedBeforeEntering = !open && !entered;
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });
  useEffect(() => {
    if (closedBeforeEntering) onClosedRef.current();
  }, [closedBeforeEntering]);
  return <MoneyModal open={open && entered} labelledBy={id} onCancel={onCancel} onClose={onClosed}>
    <MoneyModalStepLoading step="loading" title={title} titleId={id} closeLabel={closeLabel} failed={failed} onRetry={retry} placeholder={placeholder} />
  </MoneyModal>;
}
