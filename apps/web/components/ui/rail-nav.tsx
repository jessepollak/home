import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function RailNavItem({ href, label, icon: Icon, current = false, onClick }: {
  href: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-none px-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50",
        "before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 aria-[current=page]:before:opacity-100",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
