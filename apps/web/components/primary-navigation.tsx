"use client";

import { ChartNoAxesCombined, House } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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

type PrimaryNavigationProps = {
  activeNavigation: ShellPanelId;
  onNavigate: (id: NavigationId) => void;
};

const navigationIcons = {
  home: House,
  invest: ChartNoAxesCombined,
} satisfies Record<NavigationId, typeof House>;

export function PrimaryNavigation({
  activeNavigation,
  onNavigate,
}: PrimaryNavigationProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className={`order-2 w-full shrink-0 bg-background pb-[env(safe-area-inset-bottom)] sm:order-1 sm:pb-0 ${shellChromeCompensationClassName}`}
    >
      <nav
        className={`${shellWidthClassName} grid min-h-shell-mobile-navigation grid-cols-2 border-t sm:border-x sm:border-b`}
      aria-label="Main navigation"
    >
      {navigationItems.map((item) => {
        const Icon = navigationIcons[item.id];
        const isActive =
          activeNavigation === item.id ||
          (item.id === "home" && isHomeNestedPanelId(activeNavigation));

        return (
          <Button
            key={item.id}
            id={`${item.id}-nav`}
            variant="navigation"
            size="lg"
            className="relative h-full min-h-11 min-w-0"
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            aria-controls="navigation-panel"
          >
            {isActive ? (
              <motion.span
                layoutId="primary-navigation-indicator"
                className="absolute inset-x-6 bottom-1 h-0.5 rounded-full bg-primary"
                transition={reducedMotion ? { duration: 0 } : { duration: 0.12, ease: "easeOut" }}
                aria-hidden="true"
              />
            ) : null}
            <Icon className="size-5 transition-transform group-active/button:scale-95 motion-reduce:transition-none" aria-hidden="true" />
            <span className="truncate transition-colors motion-reduce:transition-none">{item.label}</span>
          </Button>
        );
      })}
      </nav>
    </div>
  );
}
