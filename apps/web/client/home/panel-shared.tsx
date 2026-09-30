import { EmptyState } from "@/components/empty-state";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencyMark } from "@/components/currency-mark";

export function ShimmerRows({ count = 0, variant = "rows" }: { count?: number; variant?: "rows" | "hero" }) {
  if (variant === "hero") {
    return <Skeleton className="h-10 w-48" data-shimmer="hero" />;
  }
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
  return <EmptyState title={`${label} unavailable`} label={label} />;
}
