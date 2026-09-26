"use client";

import { useReactiveExpiry } from "@/client/actions/expiry";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerSwipeHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MONEY_ACTION_ID_ATTRIBUTE } from "@/shared/money-actions";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { ArrowLeft, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";

const MoneyModalPendingContext = createContext(false);

export function AppDrawer({ open, labelledBy, describedBy, immediate = false, initialFocusRef, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>; onCancel: () => boolean | void;
  onClose?: () => void; children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) return;
    const rememberOutsideFocus = (target: EventTarget | null) => {
      if (target instanceof HTMLElement && target !== document.body && !target.closest("[data-money-sheet]")) {
        lastOutsideFocusRef.current = target;
      }
    };
    rememberOutsideFocus(document.activeElement);
    const onFocusIn = (event: FocusEvent) => rememberOutsideFocus(event.target);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  return (
    <Drawer open={open} modal keyboardAware swipeDirection="down" onOpenChange={(nextOpen, eventDetails) => {
      if (nextOpen) return;
      if (onCancel() === false) eventDetails.cancel();
    }} onOpenChangeComplete={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DrawerContent
        ref={popupRef}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        initialFocus={initialFocusRef ?? (() => popupRef.current?.querySelector<HTMLElement>("[data-money-amount-input]:not(:disabled)") ?? popupRef.current?.querySelector<HTMLElement>("[data-initial-focus]:not(:disabled)") ?? true)}
        finalFocus={() => {
          const target = lastOutsideFocusRef.current;
          return target?.isConnected && !target.matches(":disabled") ? target : true;
        }}
        data-money-sheet=""
        immediate={immediate}
        className="max-h-[min(88svh,calc(100dvh_-_var(--sheet-keyboard-inset,0px)_-_2rem))] sm:mx-auto sm:max-w-md"
      >
        <DrawerSwipeHandle data-money-sheet-grabber="" />
        {children}
      </DrawerContent>
    </Drawer>
  );
}

export function MoneyModal({ open, labelledBy, describedBy, immediate = false, pending = false, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean; pending?: boolean;
  onCancel: () => boolean | void; onClose: () => void; children: ReactNode;
}) {
  return <MoneyModalPendingContext value={pending}><AppDrawer open={open} labelledBy={labelledBy} describedBy={describedBy} immediate={immediate} onCancel={() => pending ? false : onCancel()} onClose={onClose}>{children}</AppDrawer></MoneyModalPendingContext>;
}

type MoneyModalHeaderProps = {
  title: string;
  titleId: string;
  onClose: () => void;
  closeLabel?: string;
} & (
  | { onBack: () => void; backDisabled?: boolean; assetControl?: never }
  | { onBack?: never; backDisabled?: never; assetControl?: ReactNode }
);

export function MoneyModalHeader(props: MoneyModalHeaderProps) {
  const { title, titleId, onClose, closeLabel = "Close" } = props;
  const isCloseDisabled = useContext(MoneyModalPendingContext);
  const onBack = "onBack" in props ? props.onBack : undefined;
  const backDisabled = "backDisabled" in props ? props.backDisabled ?? false : false;
  const assetControl = "assetControl" in props ? props.assetControl : undefined;
  return (
    <DrawerHeader className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center text-left">
      <div className="flex min-w-0 justify-start overflow-hidden">
        {onBack ? <Button autoFocus={!backDisabled} data-initial-focus={!backDisabled ? "" : undefined} variant="ghost" size="icon-lg" className="size-11" aria-label="Back" disabled={backDisabled} onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /></Button> : assetControl ?? <span />}
      </div>
      <DrawerTitle id={titleId} variant="money">{title}</DrawerTitle>
      <div className="flex min-w-0 justify-end overflow-hidden">
        <Button autoFocus={!isCloseDisabled && (!onBack || backDisabled)} data-initial-focus={!isCloseDisabled && (!onBack || backDisabled) ? "" : undefined} variant="ghost" size="icon-lg" className="size-11 shrink-0" aria-label={closeLabel} disabled={isCloseDisabled} onClick={onClose}><X className="size-4" aria-hidden="true" /></Button>
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

type MoneyModalFooterProps = {
  primaryLabel: ReactNode; onPrimary?: () => void; primaryDisabled?: boolean; primaryType?: "button" | "submit"; primaryAutoFocus?: boolean;
  secondaryLabel?: ReactNode; onSecondary?: () => void; secondaryDisabled?: boolean;
};

export function MoneyModalFooter(props: MoneyModalFooterProps) {
  return <FooterButtons {...props} />;
}

export function MoneyConfirmFooter({ action, actionExpired = false, submitting = false, ...props }: MoneyModalFooterProps & { action: PreparedMoneyAction; actionExpired?: boolean; submitting?: boolean }) {
  return <FooterButtons {...props} action={action} actionExpired={actionExpired} submitting={submitting} />;
}

function FooterButtons({ primaryLabel, onPrimary, primaryDisabled = false, primaryType = "button", primaryAutoFocus = false, secondaryLabel, onSecondary, secondaryDisabled = false, action, actionExpired = false, submitting = false }: MoneyModalFooterProps & { action?: PreparedMoneyAction; actionExpired?: boolean; submitting?: boolean }) {
  const { expired } = useReactiveExpiry(action?.expiresAt ?? null);
  const active = action && !actionExpired && !expired && Number.isFinite(Date.parse(action.expiresAt));
  return (
    <DrawerFooter>
      <Button size="touch" type={primaryType} autoFocus={primaryAutoFocus} disabled={primaryDisabled} loading={submitting} onClick={onPrimary} {...(active ? { [MONEY_ACTION_ID_ATTRIBUTE]: action.id } : {})}>{primaryLabel}</Button>
      {secondaryLabel && onSecondary ? <Button size="touch" variant="ghost" disabled={secondaryDisabled || submitting} onClick={onSecondary}>{secondaryLabel}</Button> : null}
    </DrawerFooter>
  );
}
