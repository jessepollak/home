import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

export type FinanceRowTone = "default" | "accent" | "success" | "error" | "muted";

type FinanceRowProps = {
  kind: "activity" | "balance" | "asset";
  icon: ReactNode;
  iconTone?: "neutral" | "incoming" | "outgoing" | "self" | "outlined" | "mark";
  label: ReactNode;
  context?: ReactNode;
  contextTitle?: string;
  value: ReactNode;
  valueContext?: ReactNode;
  valueContextTitle?: string;
  valueTone?: FinanceRowTone;
  onActivate?: () => void;
  activateLabel?: string;
};

export type ActivityRowProps = Omit<FinanceRowProps, "kind">;
export type BalanceRowProps = Omit<FinanceRowProps, "kind">;
export type AssetRowProps = Omit<FinanceRowProps, "kind">;

export function ActivityRow(props: ActivityRowProps) {
  return <FinanceRow {...props} kind="activity" />;
}

export function BalanceRow(props: BalanceRowProps) {
  return <FinanceRow {...props} kind="balance" />;
}

export function AssetRow(props: AssetRowProps) {
  return <FinanceRow {...props} kind="asset" />;
}

function FinanceRow({
  kind,
  icon,
  iconTone = "neutral",
  label,
  context,
  contextTitle,
  value,
  valueContext,
  valueContextTitle,
  valueTone = "default",
  onActivate,
  activateLabel,
}: FinanceRowProps) {
  const hintId = useId();
  const content = (
    <>
      <ItemMedia variant="image" className="size-8 self-center translate-y-0 rounded-full bg-muted" aria-hidden="true">
        <span
          className={cn(
            "grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
            iconTone === "incoming" && "text-muted-foreground",
            iconTone === "outgoing" && "text-muted-foreground",
            iconTone === "self" && "text-muted-foreground",
            iconTone === "outlined" && "text-destructive",
            iconTone === "mark" && "overflow-hidden bg-transparent text-inherit",
          )}
          data-tone={iconTone}
        >
          {typeof icon === "string" ? <DirectionIcon value={icon} /> : icon}
        </span>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full text-sm font-medium text-foreground">{label}</ItemTitle>
        {context === undefined ? null : (
          <ItemDescription className="line-clamp-1 text-xs text-muted-foreground" title={contextTitle}>
            {context}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemContent
        className={cn(
          "min-w-0 items-end text-right",
          (valueTone === "success" || valueTone === "accent") && "text-primary",
          valueTone === "error" && "text-destructive",
          valueTone === "muted" && "text-muted-foreground",
        )}
      >
        <ItemTitle className="w-full justify-end text-sm font-medium tabular-nums text-inherit">
          {value}
        </ItemTitle>
        {valueContext === undefined ? null : (
          <ItemDescription
            className="line-clamp-1 w-full text-right text-xs text-muted-foreground"
            title={valueContextTitle}
          >
            {valueContext}
          </ItemDescription>
        )}
      </ItemContent>
      {onActivate ? (
        <ItemActions className="text-muted-foreground" aria-hidden="true">
          <ChevronRight className="size-4" />
        </ItemActions>
      ) : null}
    </>
  );

  return (
    <li>
      <Item
        data-kind={kind}
        size="sm"
        className={cn("flex-nowrap items-center border-0 py-2", onActivate && "cursor-pointer hover:bg-muted")}
        {...(onActivate
          ? {
              render: (
                <Button
                  type="button"
                  variant="ghost"
                  aria-describedby={hintId}
                  onClick={onActivate}
                />
              ),
            }
          : {})}
      >
        {content}
        {onActivate ? (
          <span id={hintId} hidden>
            {activateLabel ?? "View details"}
          </span>
        ) : null}
      </Item>
    </li>
  );
}

function DirectionIcon({ value }: { value: string }) {
  if (value === "↓") return <ArrowDown className="size-4" />;
  if (value === "↑") return <ArrowUp className="size-4" />;
  if (value === "↔") return <ArrowLeftRight className="size-4" />;
  return <span>{value}</span>;
}
