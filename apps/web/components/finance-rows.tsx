import { useId, type ReactNode } from "react";
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
import styles from "./finance-rows.module.css";

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
      <ItemMedia className="self-center" aria-hidden="true">
        <span className={styles.icon} data-tone={iconTone}>
          {icon}
        </span>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0 self-center">
        <ItemTitle className="text-row-label w-full font-semibold text-foreground">
          {label}
        </ItemTitle>
        {context === undefined ? null : (
          <ItemDescription className="text-caption line-clamp-1" title={contextTitle}>
            {context}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemContent
        className={cn(
          "min-w-0 items-end gap-0 self-center text-right",
          valueTone === "success" && "text-success",
          valueTone === "error" && "text-destructive",
          valueTone === "muted" && "text-muted-foreground",
          valueTone === "accent" && "text-primary",
        )}
      >
        <ItemTitle className="text-row-value w-full justify-end font-mono font-medium text-inherit">
          {value}
        </ItemTitle>
        {valueContext === undefined ? null : (
          <ItemDescription
            className="text-caption line-clamp-1 w-full text-right text-inherit"
            title={valueContextTitle}
          >
            {valueContext}
          </ItemDescription>
        )}
      </ItemContent>
      {onActivate ? (
        <ItemActions className="text-muted-foreground" aria-hidden="true">
          ›
        </ItemActions>
      ) : null}
    </>
  );

  return (
    <li>
      <Item
        data-kind={kind}
        className={cn(
          "grid min-h-12 grid-cols-[auto_minmax(0,1fr)_minmax(0,40%)] flex-nowrap gap-2 rounded-none border-0 border-b border-border px-0.5 py-2 last:border-b-0",
          onActivate && "grid-cols-[auto_minmax(0,1fr)_minmax(0,34%)_auto] cursor-pointer hover:bg-muted",
        )}
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
