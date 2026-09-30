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
import type { DeferredSheetHandoff } from "@/client/money-modal/deferred-sheet";
import { MONEY_ACTION_ID_ATTRIBUTE } from "@/shared/money-actions";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { ArrowLeft, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

const MoneyModalPendingContext = createContext({ pending: false, register: (_id: symbol, _pending: boolean) => {} });
const MoneyModalStepContext = createContext<((report: StepReport) => void) | null>(null);
const MoneyModalExitContext = createContext<() => void>(() => {});
type MoneyModalHandoffScope = { carry: DeferredSheetHandoff; role: "shell" } | { carry: DeferredSheetHandoff; role: "loaded"; initial: boolean };
const MoneyModalHandoffContext = createContext<MoneyModalHandoffScope | null>(null);
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

const UNSETTLED_POPUP_STATES = ["data-starting-style", "data-ending-style", "data-swiping", "data-nested-drawer-open"];

type HeightTrack = { animation?: Animation; last: number; maxHeight: string };

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function popupSettled(popup: HTMLElement) {
  if (!popup.hasAttribute("data-open") || UNSETTLED_POPUP_STATES.some((name) => popup.hasAttribute(name))) return false;
  return !(popup.getAnimations?.() ?? []).some((animation) => "transitionProperty" in animation);
}

function cancelAnimation(animation: Animation | undefined) {
  if (!animation) return;
  animation.onfinish = null;
  animation.oncancel = null;
  void animation.finished.catch(() => {}); // oxlint-disable-line home/no-silent-catch -- cancelling a step or height animation rejects finished; the host retargets from the measured state
  animation.cancel();
}

function keyboardOpen(popup: HTMLElement) {
  return (Number.parseFloat(getComputedStyle(popup).getPropertyValue("--sheet-keyboard-inset")) || 0) > 0;
}

function acceptsHandoffHeight(popup: HTMLElement) {
  return popup.hasAttribute("data-open") && !popup.hasAttribute("data-ending-style") && !keyboardOpen(popup);
}

function easePopupHeight(popup: HTMLElement, track: HeightTrack, from: number, measuredHeight?: number) {
  cancelAnimation(track.animation);
  track.animation = undefined;
  const to = measuredHeight ?? popup.offsetHeight;
  track.last = to;
  if (from <= 0 || Math.abs(to - from) < 1 || typeof popup.animate !== "function" || prefersReducedMotion()) return;
  const animation = popup.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: MONEY_MODAL_STEP_DURATION_MS, easing: MONEY_MODAL_STEP_EASING });
  track.animation = animation;
  animation.onfinish = () => {
    track.animation = undefined;
    if (popupSettled(popup)) easePopupHeight(popup, track, to);
    else track.last = popup.offsetHeight;
  };
  animation.oncancel = () => {
    if (track.animation === animation) track.animation = undefined;
  };
}

function MoneyModalStepHost({ carriedHeight, releaseHeight, children }: { carriedHeight: () => number; releaseHeight: (popup: HTMLElement | null, measured: number) => void; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previous = useRef<StepReport | null>(null);
  const height = useRef<HeightTrack>({ last: 0, maxHeight: "" });
  const lastFocused = useRef<HTMLElement | null>(null);
  const stepAnimationRef = useRef<Animation | undefined>(undefined);
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
    cancelAnimation(stepAnimationRef.current);
    stepAnimationRef.current = undefined;
    cancelAnimation(height.current.animation);
    height.current.animation = undefined;
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const popup = host.closest<HTMLElement>("[data-slot=drawer-popup]");
    const track = height.current;
    const observer = !popup || typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      if (track.animation) return;
      const box = entries[0]?.borderBoxSize;
      const measuredHeight = (Array.isArray(box) ? box[0] : box)?.blockSize ?? popup.offsetHeight;
      if (!previous.current || track.last === 0) {
        track.last = measuredHeight;
        return;
      }
      const maxHeight = getComputedStyle(popup).maxHeight;
      const clampChanged = track.maxHeight !== "" && maxHeight !== track.maxHeight;
      track.maxHeight = maxHeight;
      if (clampChanged || !popupSettled(popup)) track.last = measuredHeight;
      else easePopupHeight(popup, track, track.last, measuredHeight);
    });
    if (popup) observer?.observe(popup);
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    host.addEventListener("focusin", onFocusIn);
    return () => {
      observer?.disconnect();
      host.removeEventListener("focusin", onFocusIn);
      stopAnimations();
      releaseHeight(popup, track.last);
      previous.current = null;
    };
  }, [releaseHeight, stopAnimations]);

  const report = useCallback((next: StepReport) => {
    const host = hostRef.current ?? next.element.parentElement;
    if (!host) return;
    const popup = host.closest<HTMLElement>("[data-slot=drawer-popup]");
    const track = height.current;
    const prior = previous.current;
    previous.current = next;
    if (!prior) {
      const from = carriedHeight();
      stepFocusTarget(next, true).focus({ preventScroll: true });
      if (popup && from > 0 && acceptsHandoffHeight(popup)) easePopupHeight(popup, track, from);
      return;
    }
    if (prior.step === next.step) {
      if (popup && track.animation) easePopupHeight(popup, track, popup.offsetHeight);
      recoverFocus();
      return;
    }
    const from = popup && track.animation ? popup.offsetHeight : track.last;
    stopAnimations();
    stepFocusTarget(next, true).focus({ preventScroll: true });
    if (popup) easePopupHeight(popup, track, from);
    if (typeof next.element.animate !== "function") return;
    const reduced = prefersReducedMotion();
    const direction = next.depth > prior.depth ? 1 : next.depth < prior.depth ? -1 : 0;
    const x = direction * (getComputedStyle(host).direction === "rtl" ? -16 : 16);
    const stepAnimation = next.element.animate(
      reduced ? [{ opacity: MONEY_MODAL_STEP_ENTER_OPACITY }, { opacity: 1 }] : [
        { opacity: MONEY_MODAL_STEP_ENTER_OPACITY, transform: `translate3d(${x}px,0,0)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: reduced ? 120 : MONEY_MODAL_STEP_DURATION_MS, easing: MONEY_MODAL_STEP_EASING },
    );
    stepAnimationRef.current = stepAnimation;
    const finishStep = () => {
      if (stepAnimationRef.current === stepAnimation) stepAnimationRef.current = undefined;
    };
    stepAnimation.onfinish = finishStep;
    stepAnimation.oncancel = finishStep;
  }, [carriedHeight, recoverFocus, stopAnimations]);

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

export function AppDrawer({ open, labelledBy, describedBy, immediate = false, variant = "default", initialFocusRef, onCancel, onClose, onOpened, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean; variant?: "default" | "money";
  initialFocusRef?: RefObject<HTMLElement | null>; onCancel: () => boolean | void;
  onClose?: () => void; onOpened?: () => void; children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const handoff = useContext(MoneyModalHandoffContext);
  const receivedCarryRef = useRef(handoff?.role === "loaded" && handoff.initial && open ? handoff.carry : null);
  const shellCarry = handoff?.role === "shell" ? handoff.carry : null;
  const carriedHeightRef = useRef(0);
  const carriedHeight = useCallback(() => carriedHeightRef.current, []);
  const releaseHeight = useCallback((popup: HTMLElement | null, measured: number) => {
    if (shellCarry) shellCarry.carryHeight(popup && acceptsHandoffHeight(popup) ? measured || popup.offsetHeight : 0);
  }, [shellCarry]);

  useLayoutEffect(() => {
    openRef.current = open;
    if (!open) carriedHeightRef.current = 0;
  }, [open]);

  useLayoutEffect(() => {
    const received = receivedCarryRef.current?.take();
    if (received) {
      lastOutsideFocusRef.current ??= received.returnFocus;
      if (received.height > 0) carriedHeightRef.current = received.height;
    }
    return () => {
      if (openRef.current) shellCarry?.carryReturnFocus(lastOutsideFocusRef.current);
    };
  }, [shellCarry]);

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
    }} onOpenChangeComplete={(nextOpen) => { if (nextOpen) onOpened?.(); else onClose?.(); }}>
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
        <MoneyModalHandoffContext value={null}>
          <MoneyModalStepHost carriedHeight={carriedHeight} releaseHeight={releaseHeight}>{children}</MoneyModalStepHost>
        </MoneyModalHandoffContext>
      </DrawerContent>
    </Drawer>
    </MoneyModalExitContext>
  );
}

export function MoneyModal({ open, labelledBy, describedBy, immediate = false, pending = false, onCancel, onClose, onOpened, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean; pending?: boolean;
  onCancel: () => boolean | void; onClose: () => void; onOpened?: () => void; children: ReactNode;
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
  return <MoneyModalPendingContext value={pendingValue}><AppDrawer open={open} labelledBy={labelledBy} describedBy={describedBy} immediate={immediate || (handoff?.role === "loaded" && handoff.initial)} variant="money" onCancel={() => effectivePending ? false : onCancel()} onClose={onClose} onOpened={onOpened}>{children}</AppDrawer></MoneyModalPendingContext>;
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
    renderLoaded: (sheet: ReactNode, handoff: DeferredSheetHandoff) => <MoneyModalHandoff carry={handoff}>{sheet}</MoneyModalHandoff>,
    render: ({ open, failed, retry, onCancel: cancel, onClosed: closed, onEntered, handoff }: {
      open: boolean; failed: boolean; retry: () => void; onCancel: () => void; onClosed: () => void; onEntered: () => void; handoff: DeferredSheetHandoff;
    }) => <MoneyModalLoadingSheet open={open} title={title} titleId={titleId} closeLabel={closeLabel} failed={failed} retry={retry} onCancel={cancel} onClosed={closed} onEntered={onEntered} placeholder={placeholder} handoff={handoff} />,
  };
}

function MoneyModalHandoff({ carry, children }: { carry: DeferredSheetHandoff; children: ReactNode }) {
  const [initial, setInitial] = useState(true);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInitial(false));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const scope = useMemo<MoneyModalHandoffScope>(() => ({ carry, role: "loaded", initial }), [carry, initial]);
  return <MoneyModalHandoffContext value={scope}>{children}</MoneyModalHandoffContext>;
}

function MoneyModalLoadingSheet({ open, title, titleId, closeLabel, failed, retry, onCancel, onClosed, onEntered, placeholder, handoff }: {
  open: boolean; title: string; titleId?: string; closeLabel: string; failed: boolean; retry: () => void;
  onCancel: () => void; onClosed: () => void; onEntered: () => void; placeholder?: ReactNode; handoff: DeferredSheetHandoff;
}) {
  const scope = useMemo<MoneyModalHandoffScope>(() => ({ carry: handoff, role: "shell" }), [handoff]);
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
  return <MoneyModalHandoffContext value={scope}><MoneyModal open={open && entered} labelledBy={id} onCancel={onCancel} onClose={onClosed} onOpened={onEntered}>
    <MoneyModalStepLoading step="loading" title={title} titleId={id} closeLabel={closeLabel} failed={failed} onRetry={retry} placeholder={placeholder} />
  </MoneyModal></MoneyModalHandoffContext>;
}
