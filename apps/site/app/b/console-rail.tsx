"use client";

import { Gift, LifeBuoy, Palette, UserPlus } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useActiveSection } from "./use-active-section";

export const teamChapters = [
  { id: "brand", label: "Your brand", icon: Palette },
  { id: "management", label: "Management", icon: LifeBuoy },
  { id: "referrals", label: "Referrals", icon: UserPlus },
  { id: "growth", label: "Growth", icon: Gift },
] as const;
const chapterIds = teamChapters.map((chapter) => chapter.id);

export function ConsoleRail() {
  const active = useActiveSection(chapterIds);
  const index = teamChapters.findIndex((chapter) => chapter.id === active);
  return (
    <div className="sticky top-20 hidden self-start overflow-hidden rounded-xl bg-background shadow-raised lg:block">
      <p className="flex h-14 items-center border-b px-4 text-base font-semibold">Admin console</p>
      <nav aria-label="Team features" className="relative py-2">
        <span
          aria-hidden="true"
          style={{ "--rail-step": index < 0 ? 0 : index } as CSSProperties}
          className={cn(
            "absolute start-0 top-2 h-11 w-0.5 translate-y-[calc(var(--rail-step)*2.75rem)] py-2 transition-[translate,opacity] duration-(--motion-duration-moderate) ease-standard",
            index < 0 && "opacity-0",
          )}
        >
          <span className="block size-full rounded-full bg-primary" />
        </span>
        {teamChapters.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === active ? "location" : undefined}
            className="flex h-11 items-center gap-3 px-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-[current=location]:text-foreground"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
