import { EmptyState } from "@/components/empty-state";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencyMark } from "@/components/currency-mark";

export function ShimmerRows({ count = 0, variant = "rows" }: { count?: number; variant?: "rows" | "hero" | "reserved" }) {
  if (variant === "reserved") return <div className="h-48" aria-busy="true" data-loading="reserved" />;
  if (variant === "hero") {
    return <Skeleton className="h-10 w-48" data-shimmer="hero" />;
  }
  return (
    <div className="flex w-full flex-col" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Item key={index} className="flex-nowrap gap-3 py-2" data-shimmer="row">
          <ItemMedia><CurrencyMark pending /></ItemMedia>
          <ItemContent>
            <div className="flex flex-col gap-0.5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-20" />
            </div>
          </ItemContent>
          <Skeleton className="h-4 w-16" />
        </Item>
      ))}
    </div>
  );
}

export function EmptyPanel({ label }: { label: string }) {
  return <EmptyState title={`${label} unavailable`} label={label} />;
}
