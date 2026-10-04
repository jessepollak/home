"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function RailNav({ className, children, ...props }: ComponentProps<"nav">) {
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  const place = () => {
    const root = nav.current;
    const bar = indicator.current;
    if (!root || !bar) return;
    const current = root.querySelector<HTMLElement>("[data-slot=rail-nav-item][aria-current=page]");
    if (!current) {
      bar.dataset.visible = "false";
      return;
    }
    const offset = current.getBoundingClientRect().top - root.getBoundingClientRect().top;
    bar.style.setProperty("--rail-indicator-y", `${offset}px`);
    bar.style.setProperty("--rail-indicator-height", `${current.offsetHeight}px`);
    bar.dataset.visible = "true";
    if (root.dataset.rail !== "ready") requestAnimationFrame(() => { root.dataset.rail = "ready"; });
  };

  useLayoutEffect(place);

  useEffect(() => {
    const root = nav.current;
    if (!root) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={nav} className={cn("group/rail relative", className)} {...props}>
      {children}
      <span
        ref={indicator}
        aria-hidden="true"
        data-visible="false"
        className="pointer-events-none absolute start-0 top-0 hidden h-[calc(var(--rail-indicator-height)-1rem)] w-0.5 translate-y-[calc(var(--rail-indicator-y)+0.5rem)] rounded-full bg-primary data-[visible=false]:opacity-0 group-data-[rail=ready]/rail:block group-data-[rail=ready]/rail:motion-safe:transition-[translate] group-data-[rail=ready]/rail:motion-safe:duration-180 group-data-[rail=ready]/rail:motion-safe:ease-out"
      />
    </nav>
  );
}

export function RailNavItem({ href, label, icon: Icon, current = false, onClick, unreadCount = 0 }: {
  href: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
  onClick?: () => void;
  unreadCount?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      data-slot="rail-nav-item"
      aria-current={current ? "page" : undefined}
      aria-label={unreadCount > 0 ? `${label}, ${unreadCount} unread` : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-none px-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50",
        "before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 aria-[current=page]:before:opacity-100 in-data-[rail=ready]:before:hidden",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {unreadCount > 0 && <span aria-hidden="true" className="ms-auto rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground tabular-nums">{unreadCount}</span>}
    </Link>
  );
}
