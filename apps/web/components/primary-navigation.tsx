"use client";

import { ChartNoAxesCombined, House } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  return (
    <nav
      className="relative z-20 order-2 grid shrink-0 grid-cols-2 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] max-md:-mx-4 md:order-1 md:static md:w-full md:border-t-0 md:border-b"
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
            variant="ghost"
            className={cn(
              "group/nav-item relative h-14 min-h-14 min-w-0 flex-col gap-1 rounded-none border-0 bg-transparent px-0 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:z-1 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring active:translate-y-0 motion-reduce:transition-none md:flex-row md:justify-start md:gap-2 md:px-2.5",
              isActive && "text-foreground hover:bg-transparent",
            )}
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            aria-controls="navigation-panel"
          >
            <span
              className={cn(
                "inline-flex size-8 shrink-0 origin-center items-center justify-center rounded-md border border-transparent text-foreground transition-[background-color,border-color,color,transform] group-active/nav-item:scale-95 motion-reduce:transition-none motion-reduce:group-active/nav-item:scale-100",
                isActive && "border-primary bg-primary text-primary-foreground",
              )}
              aria-hidden="true"
            >
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.9} />
            </span>
            <span className={cn(
              "max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-metadata font-semibold leading-none",
              isActive && "font-bold",
            )}>
              {item.label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
