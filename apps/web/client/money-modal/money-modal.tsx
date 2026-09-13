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
        className="max-h-[88svh] bg-background text-foreground shadow-lg data-[immediate]:duration-0 sm:mx-auto sm:max-w-md sm:rounded-t-xl"
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

export function MoneyModalHeader({ title, titleId, onBack, onClose, closeDisabled = false, closeLabel = "Close" }: {
  title: string; titleId: string; onBack?: () => void; onClose: () => void;
  closeDisabled?: boolean; closeLabel?: string;
}) {
  return (
    <DrawerHeader className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 pb-0 text-left">
      {onBack ? <Button variant="ghost" size="icon-lg" className="size-11" aria-label="Back" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /></Button> : <span />}
      <DrawerTitle id={titleId} className="text-center">{title}</DrawerTitle>
      <Button variant="ghost" size="icon-lg" className="size-11" aria-label={closeLabel} disabled={closeDisabled} onClick={onClose}><X className="size-4" aria-hidden="true" /></Button>
    </DrawerHeader>
  );
}

export function MoneyModalBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${className}`.trim()}>
      {children}
    </div>
  );
}

export function MoneyModalFooter({ primaryLabel, onPrimary, primaryDisabled = false, primaryType = "button", secondaryLabel, onSecondary, secondaryDisabled = false }: {
  primaryLabel: ReactNode; onPrimary?: () => void; primaryDisabled?: boolean; primaryType?: "button" | "submit";
  secondaryLabel?: ReactNode; onSecondary?: () => void; secondaryDisabled?: boolean;
}) {
  return (
    <DrawerFooter className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Button size="lg" className="h-11" type={primaryType} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</Button>
      {secondaryLabel && onSecondary ? <Button size="lg" variant="ghost" className="h-11" disabled={secondaryDisabled} onClick={onSecondary}>{secondaryLabel}</Button> : null}
    </DrawerFooter>
  );
}
