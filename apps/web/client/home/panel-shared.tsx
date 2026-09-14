import type { ReactNode } from "react";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencyMark } from "@/components/currency-mark";

export function MountedShellPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-shell-panel=""
      hidden={!active}
      inert={active ? undefined : true}
      aria-hidden={active ? undefined : true}
    >
      {children}
    </div>
  );
}

export function ShimmerRows({ count }: { count: number }) {
  return (
    <div className="flex w-full flex-col" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Item key={index} size="sm" className="flex-nowrap" data-shimmer="row">
          <ItemMedia><CurrencyMark pending /></ItemMedia>
          <ItemContent>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </ItemContent>
          <Skeleton className="h-4 w-16" />
        </Item>
      ))}
    </div>
  );
}

export function EmptyPanel({ label }: { label: string }) {
  return (
    <section aria-label={label}>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{label} unavailable</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
