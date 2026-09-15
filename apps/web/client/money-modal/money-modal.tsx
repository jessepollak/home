"use client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerSwipeHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ArrowLeft, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";

export function AppDrawer({ open, labelledBy, describedBy, immediate = false, initialFocusRef, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>; onCancel: () => boolean | void;
  onClose?: () => void; children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Drawer open={open} modal swipeDirection="down" onOpenChange={(nextOpen, eventDetails) => {
      if (nextOpen) return;
      if (onCancel() === false) eventDetails.cancel();
    }} onOpenChangeComplete={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DrawerContent
        ref={popupRef}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        initialFocus={initialFocusRef ?? (() => popupRef.current?.querySelector<HTMLElement>("[data-initial-focus]:not(:disabled)") ?? true)}
        data-money-sheet=""
        data-immediate={immediate ? "" : undefined}
        className="max-h-[88svh] sm:mx-auto sm:max-w-md"
      >
        <DrawerSwipeHandle data-money-sheet-grabber="" />
        {children}
      </DrawerContent>
    </Drawer>
  );
}

export function MoneyModal({ open, labelledBy, describedBy, immediate = false, onCancel, onClose, children }: {
  open: boolean; labelledBy: string; describedBy?: string; immediate?: boolean;
  onCancel: () => boolean | void; onClose: () => void; children: ReactNode;
}) {
  return <AppDrawer open={open} labelledBy={labelledBy} describedBy={describedBy} immediate={immediate} onCancel={onCancel} onClose={onClose}>{children}</AppDrawer>;
}

type MoneyModalHeaderProps = {
  title: string;
  titleId: string;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
} & (
  | { onBack: () => void; backDisabled?: boolean; assetControl?: never }
  | { onBack?: never; backDisabled?: never; assetControl?: ReactNode }
);

export function MoneyModalHeader(props: MoneyModalHeaderProps) {
  const { title, titleId, onClose, closeDisabled = false, closeLabel = "Close" } = props;
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
        <Button autoFocus={!onBack || backDisabled} data-initial-focus={!onBack || backDisabled ? "" : undefined} variant="ghost" size="icon-lg" className="size-11 shrink-0" aria-label={closeLabel} disabled={closeDisabled} onClick={onClose}><X className="size-4" aria-hidden="true" /></Button>
      </div>
    </DrawerHeader>
  );
}

export function MoneyModalBody({ children, className = "", hasFooter = false }: { children: ReactNode; className?: string; hasFooter?: boolean }) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-auto px-4 ${hasFooter ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))]"} ${className}`.trim()}>
      {children}
    </div>
  );
}

export function MoneyModalFooter({ primaryLabel, onPrimary, primaryDisabled = false, primaryType = "button", secondaryLabel, onSecondary, secondaryDisabled = false }: {
  primaryLabel: ReactNode; onPrimary?: () => void; primaryDisabled?: boolean; primaryType?: "button" | "submit";
  secondaryLabel?: ReactNode; onSecondary?: () => void; secondaryDisabled?: boolean;
}) {
  return (
    <DrawerFooter>
      <Button size="lg" className="h-11" type={primaryType} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</Button>
      {secondaryLabel && onSecondary ? <Button size="lg" variant="ghost" className="h-11" disabled={secondaryDisabled} onClick={onSecondary}>{secondaryLabel}</Button> : null}
    </DrawerFooter>
  );
}
