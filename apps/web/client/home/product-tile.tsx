"use client";

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomeProductTile({
  actionLabel,
  busy = false,
  headingId,
  icon,
  onOpen,
  primary,
  secondary,
  title,
}: {
  actionLabel: string;
  busy?: boolean;
  headingId: string;
  icon: ReactNode;
  onOpen: () => void;
  primary: ReactNode;
  secondary: ReactNode;
  title: string;
}) {
  return (
    <Button
      type="button"
      variant="product-tile"
      size="product-tile"
      onClick={onOpen}
      aria-label={`Open ${title}`}
      aria-busy={busy || undefined}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start justify-between gap-3">
          <span
            id={headingId}
            role="heading"
            aria-level={2}
            className="text-base leading-snug font-medium"
          >
            {title}
          </span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
            {icon}
          </span>
        </span>

        <span className="mt-auto min-w-0 pt-4">
          <span className="block min-w-0 text-lg leading-tight font-semibold tabular-nums">
            {primary}
          </span>
          <span className="mt-1 block min-h-8 text-xs leading-4 text-muted-foreground">
            {secondary}
          </span>
        </span>

        <span className="mt-3 flex items-center justify-between gap-2 text-sm font-medium">
          <span>{actionLabel}</span>
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </span>
    </Button>
  );
}
