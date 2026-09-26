import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import type { MoneyBreakdownItem } from "@/shared/balances/present";

const segmentColors: Record<MoneyBreakdownItem["id"], string> = {
  borrow: "var(--muted-foreground)",
  cash: "#0aa852",
  investments: "#a064db",
};

type BreakdownProps = {
  items: readonly MoneyBreakdownItem[];
  selectedId: MoneyBreakdownItem["id"] | null;
  onSelect: (id: MoneyBreakdownItem["id"]) => void;
};

export function SignedBalanceBar({ items, selectedId, onSelect }: BreakdownProps) {
  const borrow = items.find((item) => item.id === "borrow");
  const assets = items.filter((item) => item.id !== "borrow" && item.weight > 0);
  return (
    <div
      className="flex h-2 w-full items-center gap-0.5"
      aria-hidden="true"
      data-signed-balance-bar=""
    >
      {borrow ? (
        <>
          <Segment item={borrow} selectedId={selectedId} onSelect={onSelect} />
          <span className="h-3 w-0.5 shrink-0 bg-foreground" data-balance-axis="" />
        </>
      ) : null}
      {assets.map((item) => (
        <Segment key={item.id} item={item} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function MoneyBreakdownLegend({ items, selectedId, onSelect }: BreakdownProps) {
  return (
    <ul aria-label="Balance allocation" className="grid list-none grid-cols-3 gap-x-2 p-0 text-xs text-muted-foreground tabular-nums">
      {items.map((item) => {
        const selected = selectedId === item.id;
        return (
          <li key={item.id} className="min-w-0 leading-tight" data-breakdown-item={item.id} data-selected={selected ? "true" : undefined}>
            <Button
              type="button"
              variant="balance-legend"
              size="balance-legend"
              press="none"
              aria-pressed={selected}
              data-selected={selected ? "true" : undefined}
              onClick={() => onSelect(item.id)}
              className="-mx-1.5 -my-1 flex w-full min-w-0 flex-col items-start gap-1 px-1.5 py-1 text-start"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-xs"
                  style={{ backgroundColor: segmentColors[item.id] }}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </span>
              <MoneyTicker className="text-[0.8125rem]" value={item.value} align="start" reserveDigits={false} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Segment({ item, selectedId, onSelect }: {
  item: MoneyBreakdownItem;
  selectedId: MoneyBreakdownItem["id"] | null;
  onSelect: BreakdownProps["onSelect"];
}) {
  return (
    <Button
      type="button"
      variant="balance-segment"
      size="balance-segment"
      press="none"
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item.id)}
      className="relative h-2 min-w-1 shrink"
      data-balance-segment={item.id}
      data-selected={selectedId === item.id ? "true" : undefined}
      data-muted={selectedId !== null && selectedId !== item.id ? "" : undefined}
      style={{
        backgroundColor: segmentColors[item.id],
        flexBasis: 0,
        flexGrow: item.weight,
      }}
    />
  );
}
