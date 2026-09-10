"use client";

import { ChartNoAxesCombined, House } from "lucide-react";
import {
  isHomeNestedPanelId,
  navigationItems,
  type NavigationId,
  type ShellPanelId,
} from "@/config/navigation";
import styles from "./primary-navigation.module.css";

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
    <nav className={styles.navigation} aria-label="Main navigation">
      {navigationItems.map((item) => {
        const Icon = navigationIcons[item.id];
        const isActive =
          activeNavigation === item.id ||
          (item.id === "home" && isHomeNestedPanelId(activeNavigation));

        return (
          <button
            key={item.id}
            id={`${item.id}-nav`}
            type="button"
            className={`${styles.item} ${isActive ? styles.active : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            aria-controls="navigation-panel"
          >
            <span className={styles.iconFrame} aria-hidden="true">
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.9} />
            </span>
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
