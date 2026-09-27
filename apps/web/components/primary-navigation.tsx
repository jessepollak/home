"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChartNoAxesCombined, House } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import {
  shellChromeCompensationClassName,
  shellWidthClassName,
} from "@/components/shell-layout";
import {
  isHomeNestedPanelId,
  navigationItems,
  type NavigationId,
  type ShellPanelId,
} from "@/config/navigation";
import { visualViewportKeyboardInset } from "./visual-viewport";
import styles from "./primary-navigation.module.css";

type PrimaryNavigationProps = {
  activeNavigation: ShellPanelId;
  onNavigate: (id: NavigationId) => void;
  labels?: Partial<Record<NavigationId, string>>;
};

const navigationIcons = {
  home: House,
  invest: ChartNoAxesCombined,
} satisfies Record<NavigationId, typeof House>;

export function PrimaryNavigation({
  activeNavigation,
  onNavigate,
  labels,
}: PrimaryNavigationProps) {
  const prefersReducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const [direction, setDirection] = useState("ltr");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useLayoutEffect(() => {
    if (navRef.current) setDirection(getComputedStyle(navRef.current).direction);
  }, [activeNavigation]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const target = document.activeElement;
      setKeyboardOpen(window.matchMedia("(max-width: 39.9375rem)").matches &&
        target instanceof HTMLElement && !!target.closest("#navigation-panel") &&
        (target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || target.isContentEditable) &&
        !!viewport && visualViewportKeyboardInset(window.innerHeight, viewport) > 0);
    };
    const deferUpdate = () => requestAnimationFrame(update);
    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", deferUpdate);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", deferUpdate);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);

  const activeIndex = navigationItems.findIndex((item) =>
    activeNavigation === item.id ||
    (item.id === "home" && isHomeNestedPanelId(activeNavigation)));

  return (
    <div className={`contents sm:order-1 sm:block sm:w-full sm:shrink-0 sm:bg-background ${shellChromeCompensationClassName}`}>
      <nav
        ref={navRef}
        aria-label="Main navigation"
        aria-hidden={keyboardOpen ? true : undefined}
        inert={keyboardOpen}
        data-keyboard-hidden={keyboardOpen ? "true" : undefined}
        className={`${shellWidthClassName} ${styles.navigation} fixed inset-x-0 z-30 grid grid-cols-2 rounded-full p-1 opacity-100 transition-[opacity,transform] duration-150 motion-reduce:transition-none sm:relative sm:z-auto sm:min-h-14 sm:rounded-none sm:border-x sm:border-y sm:p-0 sm:transition-none`}
      >
        <span aria-hidden="true" className={`${styles.floor} pointer-events-none absolute inset-0 rounded-full sm:hidden`} />
        <motion.span
          aria-hidden="true"
          data-navigation-pill=""
          className={`${styles.pill} pointer-events-none absolute inset-y-1 start-1 rounded-full bg-foreground/10 dark:bg-foreground/15 sm:hidden`}
          animate={{ x: activeIndex > 0 ? (direction === "rtl" ? "-100%" : "100%") : "0%" }}
          transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", visualDuration: 0.16, bounce: 0.1 }}
        />
        {navigationItems.map((item, index) => {
          const Icon = navigationIcons[item.id];
          const isActive = index === activeIndex;

          return (
            <Button
              key={item.id}
              id={`${item.id}-nav`}
              variant="navigation"
              size="tab"
              className="relative z-10 min-w-0 w-full sm:h-full sm:min-h-11"
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? "page" : undefined}
              aria-controls="navigation-panel"
            >
              <span className={`${styles.content} flex min-w-0 w-full flex-col items-center justify-center gap-0.5 sm:contents`}>
                <Icon className={`size-5.5 sm:size-5 sm:transition-transform sm:group-active/button:scale-95 sm:group-active/button:duration-0 motion-reduce:sm:transition-none motion-reduce:sm:group-active/button:scale-none ${isActive ? "text-primary sm:text-current" : "text-foreground/70 sm:text-current"}`} aria-hidden="true" />
                <span className={`block max-w-full truncate text-[0.625rem] leading-3 font-medium sm:text-sm sm:font-medium sm:leading-normal sm:transition-colors motion-reduce:sm:transition-none ${isActive ? "text-foreground sm:text-current" : "text-foreground/70 sm:text-current"}`}>{labels?.[item.id] ?? item.label}</span>
              </span>
            </Button>
          );
        })}
        {activeIndex >= 0 ? (
          <span
            className="pointer-events-none absolute bottom-1 left-0 hidden w-1/2 px-6 transition-transform duration-120 ease-out motion-reduce:transition-none sm:block"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
            aria-hidden="true"
          >
            <span className="block h-0.5 rounded-full bg-primary" />
          </span>
        ) : null}
      </nav>
    </div>
  );
}
