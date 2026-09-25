"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSelectedLayoutSegments } from "next/navigation";
import { ArrowLeft, Menu } from "lucide-react";
import { AddressText } from "@/components/address-text";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { RailNavItem } from "@/components/ui/rail-nav";
import { Separator } from "@/components/ui/separator";
import { brand } from "@/config/brand";
import { operatorNavigation } from "@/config/operator-navigation";

function SectionLinks({ pathname, sectionRoute, onNavigate }: { pathname: string; sectionRoute: boolean; onNavigate?: (href: string) => void }) {
  return (
    <nav aria-label="Operator sections" className="grid gap-1">
      {operatorNavigation.map((item, index) => (
        <div key={item.id}>
          {index > 0 && item.group !== operatorNavigation[index - 1].group && <Separator className="my-3" />}
          <RailNavItem
            href={item.href}
            label={item.label}
            icon={item.icon}
            current={sectionRoute && (pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)))}
            onClick={onNavigate && (() => onNavigate(item.href))}
          />
        </div>
      ))}
    </nav>
  );
}

const OperatorAddressContext = createContext<((address: `0x${string}`) => void) | null>(null);
let historyRestorePending = false;
const restoreListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (restoreListeners.size === 0) {
      historyRestorePending = true;
      return;
    }
    historyRestorePending = false;
    for (const listener of restoreListeners) listener();
  });
}

export function OperatorIdentity({ address }: { address: `0x${string}` }) {
  const setAddress = useContext(OperatorAddressContext);

  useLayoutEffect(() => {
    setAddress?.(address);
  }, [address, setAddress]);

  return null;
}

export function OperatorShell({ address, children }: { address: `0x${string}`; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const restoring = useRef(historyRestorePending);
  const refreshObserved = useRef(false);
  const [verifying, setVerifying] = useState(() => historyRestorePending);
  const [currentAddress, setAddress] = useState(address);
  const [lastPropAddress, setLastPropAddress] = useState(address);
  if (address !== lastPropAddress) {
    setLastPropAddress(address);
    setAddress(address);
  }
  const sectionRoute = useSelectedLayoutSegments().includes("(sections)");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(pathname);
  const menuNavigationPending = useRef(false);
  const updateAddress = useCallback((nextAddress: `0x${string}`) => {
    if (!restoring.current) setAddress(nextAddress);
  }, []);

  useEffect(() => {
    const onRestore = () => {
      restoring.current = true;
      setVerifying(true);
      startRefresh(() => router.refresh());
    };
    restoreListeners.add(onRestore);
    if (historyRestorePending) {
      historyRestorePending = false;
      onRestore();
    }
    return () => { restoreListeners.delete(onRestore); };
  }, [router, startRefresh]);

  useEffect(() => {
    if (refreshing) {
      refreshObserved.current = true;
    } else if (restoring.current && refreshObserved.current) {
      refreshObserved.current = false;
      restoring.current = false;
      setVerifying(false);
      setAddress(address);
    }
  }, [address, refreshing]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 48rem)");
    const closeAtDesktop = () => { if (media.matches) setMenuOpen(false); };
    if (menuOpen) closeAtDesktop();
    media.addEventListener("change", closeAtDesktop);
    return () => media.removeEventListener("change", closeAtDesktop);
  }, [menuOpen]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const focusTrigger = menuNavigationPending.current;
    menuNavigationPending.current = false;
    const trigger = menuButton.current;
    if (focusTrigger && trigger && trigger.offsetParent !== null) {
      trigger.focus();
      return;
    }
    const content = document.querySelector<HTMLElement>("[data-operator-content]");
    if (!content) return;
    const focusHeading = () => {
      const heading = content.querySelector<HTMLElement>("h1");
      heading?.focus();
      return Boolean(heading);
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => { if (focusHeading()) observer.disconnect(); });
    observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  const restoreFocusTarget = () => {
    const button = menuButton.current;
    if (button && button.offsetParent !== null) return button;
    return document.querySelector<HTMLElement>("[data-operator-content] h1");
  };
  const closeMenu = () => setMenuOpen(false);
  const navigateFromMenu = (href: string) => {
    menuNavigationPending.current = href !== pathname;
    closeMenu();
  };

  return (
    <OperatorAddressContext.Provider value={updateAddress}>
      <div className="min-h-dvh bg-background text-foreground md:flex">
        <aside aria-label="Operator sidebar" className="hidden w-64 shrink-0 flex-col overflow-y-auto border-e md:sticky md:top-0 md:flex md:h-dvh">
          <div className="px-4 py-6 text-lg font-semibold">{brand.name}</div>
          <SectionLinks pathname={pathname} sectionRoute={sectionRoute} />
          <div className="mt-auto grid gap-3 border-t px-4 py-5">
            <Link href="/home" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />Back to Home
            </Link>
            {!verifying && <AddressText address={currentAddress} presentation="compact" />}
          </div>
        </aside>
        <header className="flex min-h-16 items-center justify-between border-b px-5 md:hidden">
          <span className="text-lg font-semibold">{brand.name}</span>
          <Button ref={menuButton} variant="ghost" size="icon-lg" className="size-11" aria-label="Open sections menu" aria-expanded={menuOpen} onClick={() => { menuNavigationPending.current = false; setMenuOpen(true); }}>
            <Menu aria-hidden="true" />
          </Button>
        </header>
        <Drawer open={menuOpen} onOpenChange={setMenuOpen} onOpenChangeComplete={(open) => { if (!open) restoreFocusTarget()?.focus(); }}>
          <DrawerContent aria-label="Sections" finalFocus={restoreFocusTarget}>
            <DrawerHeader><DrawerTitle>Sections</DrawerTitle></DrawerHeader>
            <div className="overflow-y-auto px-3 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <SectionLinks pathname={pathname} sectionRoute={sectionRoute} onNavigate={navigateFromMenu} />
              <Separator className="my-3" />
              <Link href="/home" onClick={() => navigateFromMenu("/home")} className="flex min-h-11 items-center gap-2 px-4 text-sm font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />Back to Home
              </Link>
              <div className="px-4 py-3">{!verifying && <AddressText address={currentAddress} presentation="compact" />}</div>
            </div>
          </DrawerContent>
        </Drawer>
        <main data-operator-content className="min-w-0 flex-1 px-6 py-10 md:px-10">{children}</main>
      </div>
    </OperatorAddressContext.Provider>
  );
}
