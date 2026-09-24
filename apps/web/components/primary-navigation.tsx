"use client";

import { ChartNoAxesCombined, House } from "lucide-react";
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
  const activeIndex = navigationItems.findIndex((item) =>
    activeNavigation === item.id ||
    (item.id === "home" && isHomeNestedPanelId(activeNavigation)));

  return (
    <div
      className={`order-2 w-full shrink-0 bg-background pb-[var(--shell-safe-area-bottom)] sm:order-1 sm:pb-0 ${shellChromeCompensationClassName}`}
    >
      <nav
        className={`${shellWidthClassName} relative grid min-h-shell-mobile-navigation grid-cols-2 border-t sm:border-x sm:border-b`}
      aria-label="Main navigation"
    >
      {navigationItems.map((item, index) => {
        const Icon = navigationIcons[item.id];
        const isActive = index === activeIndex;

        return (
          <Button
            key={item.id}
            id={`${item.id}-nav`}
            variant="navigation"
            size="lg"
            className="h-full min-h-11 min-w-0"
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            aria-controls="navigation-panel"
          >
            <Icon className="size-5 transition-transform group-active/button:scale-95 group-active/button:duration-0 motion-reduce:transition-none motion-reduce:group-active/button:scale-none" aria-hidden="true" />
            <span className="truncate transition-colors motion-reduce:transition-none">{item.label}</span>
          </Button>
        );
      })}
      {activeIndex >= 0 ? (
        <span
          className="pointer-events-none absolute bottom-1 left-0 w-1/2 px-6 transition-transform duration-120 ease-out motion-reduce:transition-none"
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
