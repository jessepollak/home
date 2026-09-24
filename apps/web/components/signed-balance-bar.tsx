import { MoneyTicker } from "@/components/money-ticker";
import type { MoneyBreakdownItem } from "@/shared/balances/present";

const segmentColors: Record<MoneyBreakdownItem["id"], string> = {
  borrow: "var(--muted-foreground)",
  cash: "#0aa852",
  investments: "#a064db",
};

export function SignedBalanceBar({ items }: { items: readonly MoneyBreakdownItem[] }) {
  const borrow = items.find((item) => item.id === "borrow");
  const assets = items.filter((item) => item.id !== "borrow" && item.weight > 0);
  return (
    <div
      className="flex h-2 w-full items-center gap-0.5"
      role="img"
      aria-label="Balance allocation"
      data-signed-balance-bar=""
    >
      {borrow ? (
        <>
          <Segment item={borrow} />
          <span className="h-3 w-0.5 shrink-0 bg-foreground" data-balance-axis="" />
        </>
      ) : null}
      {assets.map((item) => <Segment key={item.id} item={item} />)}
    </div>
  );
}

export function MoneyBreakdownLegend({ items }: { items: readonly MoneyBreakdownItem[] }) {
  return (
    <ul className="grid list-none grid-cols-3 gap-x-2 p-0 text-xs text-muted-foreground tabular-nums">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 flex-col gap-1 leading-tight" data-breakdown-item={item.id}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-xs"
              style={{ backgroundColor: segmentColors[item.id] }}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </span>
          <MoneyTicker className="text-[0.8125rem]" value={item.value} align="start" reserveDigits={false} />
        </li>
      ))}
    </ul>
  );
}

function Segment({ item }: { item: MoneyBreakdownItem }) {
  return (
    <span
      className="h-2 min-w-1 rounded-xs"
      data-balance-segment={item.id}
      style={{
        backgroundColor: segmentColors[item.id],
        flexBasis: 0,
        flexGrow: item.weight,
      }}
    />
  );
}
