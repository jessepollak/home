import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronRight, CircleAlert } from "lucide-react";
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

export type FinanceRowTone = "default" | "success" | "error" | "muted";

type FinanceRowProps = {
  kind: "activity" | "balance" | "asset";
  icon: ReactNode;
  iconTone?: "neutral" | "incoming" | "outgoing" | "self" | "outlined" | "mark";
  label: ReactNode;
  context?: ReactNode;
  contextTitle?: string;
  value?: ReactNode;
  valueContext?: ReactNode;
  valueContextTitle?: string;
  valueTone?: FinanceRowTone;
  onActivate?: (opener: HTMLElement) => void;
  activateLabel?: string;
  attention?: string;
  chevron?: boolean;
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

const valueTitleTone = {
  default: "default",
  success: "gain",
  error: "destructive",
  muted: "muted",
} as const;

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
  attention,
  chevron = true,
}: FinanceRowProps) {
  const hintId = useId();
  const hasValue = value !== undefined || valueContext !== undefined;
  const content = (
    <>
      <ItemMedia variant="avatar" aria-hidden="true">
        <span
          className={cn(
            "grid size-full place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
            iconTone === "incoming" && "bg-market-gain/10 text-market-gain",
            iconTone === "outgoing" && "bg-market-loss/10 text-market-loss",
            iconTone === "self" && "text-muted-foreground",
            iconTone === "outlined" && "text-destructive",
            iconTone === "mark" && "overflow-hidden bg-transparent text-inherit",
          )}
          data-tone={iconTone}
        >
          {typeof icon === "string" ? <DirectionIcon value={icon} /> : icon}
        </span>
      </ItemMedia>
      <div className="flex min-w-0 flex-1 items-start gap-3" data-slot="finance-row-body">
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="w-full">{label}</ItemTitle>
          {context === undefined ? null : (
            <ItemDescription lines={1} title={contextTitle}>
              {context}
            </ItemDescription>
          )}
        </ItemContent>
        {onActivate && attention ? <span className="sr-only">{attention}</span> : null}
        {hasValue ? (
          <ItemContent
            className="max-w-2/3 min-w-0 !flex-none items-end gap-0.5 overflow-hidden text-right"
            data-slot="finance-row-value"
          >
            {value === undefined ? null : (
              <ItemTitle
                className="w-full min-w-0 justify-end"
                numeric
                truncate={false}
                tone={valueTitleTone[valueTone]}
                data-value-tone={valueTone}
              >
                {value}
              </ItemTitle>
            )}
            {valueContext === undefined ? null : (
              <ItemDescription
                lines={1}
                size="xs"
                className="w-full text-right"
                title={valueContextTitle}
              >
                {valueContext}
              </ItemDescription>
            )}
          </ItemContent>
        ) : null}
      </div>
      {onActivate && (attention || chevron) ? (
        <ItemActions aria-hidden="true">
          {attention
            ? <CircleAlert className="size-4 text-foreground" />
            : <ChevronRight className="size-4 text-muted-foreground" />}
        </ItemActions>
      ) : null}
    </>
  );

  return (
    <li>
      <Item
        data-kind={kind}
        className={cn("flex-nowrap items-center gap-3 py-2", onActivate && "cursor-pointer")}
        {...(onActivate
          ? {
              render: (
                <Button
                  type="button"
                  variant="ghost"
                  press="none"
                  aria-describedby={hintId}
                  onClick={(event) => onActivate(event.currentTarget)}
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
