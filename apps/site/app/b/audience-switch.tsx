"use client";

import { cn } from "@/lib/utils";
import { useActiveSection } from "./use-active-section";

const halves = [
  { id: "customers", label: "For your customers" },
  { id: "team", label: "For your team" },
] as const;
const halfIds = halves.map((half) => half.id);

export function AudienceSwitch() {
  const active = useActiveSection(halfIds);
  const index = halves.findIndex((half) => half.id === active);
  return (
    <div className="pointer-events-none sticky top-3 z-20 flex justify-center px-5">
      <nav aria-label="Audience" className="pointer-events-auto relative grid grid-cols-2 rounded-lg bg-background p-1 shadow-floating">
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-md bg-state-pressed transition-[translate,opacity] duration-(--motion-duration-moderate) ease-standard",
            index < 0 && "opacity-0",
            index === 1 && "translate-x-full",
          )}
        />
        {halves.map((half) => (
          <a
            key={half.id}
            href={`#${half.id}`}
            aria-current={half.id === active ? "location" : undefined}
            className="relative flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors duration-(--motion-duration-moderate) ease-standard hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=location]:text-foreground sm:px-4"
          >
            {half.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
