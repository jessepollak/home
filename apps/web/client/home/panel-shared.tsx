import type { ReactNode } from "react";
import { EmptyState, Skeleton } from "@home/ui";
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
    <ul className="shimmer-list">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="shimmer-row" data-shimmer="row">
          <CurrencyMark pending />
          <span className="shimmer-identity">
            <Skeleton shape="text" className="shimmer-line shimmer-line-wide" />
            <Skeleton shape="text" className="shimmer-line shimmer-line-narrow" />
          </span>
          <Skeleton shape="text" className="shimmer-pill" />
        </li>
      ))}
    </ul>
  );
}

export function EmptyPanel({ label }: { label: string }) {
  return (
    <section className="empty-panel" aria-label={label}>
      <EmptyState title={`${label} unavailable`} />
    </section>
  );
}
