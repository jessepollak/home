import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronRight, CircleAlert, RotateCw } from "lucide-react";
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

export type FinanceRowAction = {
  label: string;
  accessibleLabel: string;
  onAction: (opener: HTMLButtonElement) => void;
  onIntent?: () => void;
  disabled?: boolean;
  pending?: boolean;
};

type FinanceRowCommonProps = {
  kind: "activity" | "balance" | "asset";
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: (element: HTMLLIElement | null) => void };
  icon: ReactNode;
  iconTone?: "neutral" | "incoming" | "outgoing" | "self" | "outlined" | "mark";
  label: ReactNode;
  context?: ReactNode;
  contextLines?: 1 | 2;
  contextTitle?: string;
  value?: ReactNode;
  valueContext?: ReactNode;
  valueContextTitle?: string;
  valueTone?: FinanceRowTone;
};

type FinanceRowInteractionProps =
  | {
      action: FinanceRowAction;
      onActivate?: never;
      activateLabel?: never;
      attention?: never;
      chevron?: never;
      readRetry?: never;
    }
  | {
      action?: never;
      onActivate?: (opener: HTMLElement) => void;
      activateLabel?: string;
      attention?: string;
      chevron?: boolean;
      readRetry?: { label: string; onRetry: () => void };
    };

type FinanceRowProps = FinanceRowCommonProps & FinanceRowInteractionProps;

export type ActivityRowProps = Omit<FinanceRowCommonProps, "kind"> & FinanceRowInteractionProps;
export type BalanceRowProps = Omit<FinanceRowCommonProps, "kind"> & FinanceRowInteractionProps;
export type AssetRowProps = Omit<FinanceRowCommonProps, "kind"> & FinanceRowInteractionProps;

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
  liProps,
  icon,
  iconTone = "neutral",
  label,
  context,
  contextLines = 1,
  contextTitle,
  value,
  valueContext,
  valueContextTitle,
  valueTone = "default",
  action,
  onActivate,
  activateLabel,
  attention,
  chevron = true,
  readRetry,
}: FinanceRowProps) {
  const hintId = useId();
  const activation = action ? undefined : onActivate;
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
      <div className={cn("flex min-w-0 flex-1 items-start gap-3 @max-[14rem]/finance-row:flex-col @max-[14rem]/finance-row:gap-1", contextLines === 2 && "flex-wrap gap-y-1")} data-slot="finance-row-body">
        <ItemContent className={cn("min-w-0 gap-0.5 @max-[14rem]/finance-row:w-full @max-[14rem]/finance-row:self-stretch", contextLines === 2 && "min-w-min", (context === undefined || value === undefined || valueContext === undefined) && "self-center")}>
          <ItemTitle className="w-full" truncate="stacked">{label}</ItemTitle>
          {context === undefined ? null : (
            <ItemDescription lines={contextLines} className={contextLines === 2 ? "whitespace-normal" : undefined} title={contextTitle}>
              {context}
            </ItemDescription>
          )}
        </ItemContent>
        {activation && attention ? <span className="sr-only">{attention}</span> : null}
        {hasValue ? (
          <ItemContent
            className={cn("max-w-2/3 min-w-0 !flex-none items-end gap-0.5 overflow-hidden text-end @max-[14rem]/finance-row:max-w-full", contextLines === 2 && "ms-auto max-w-full", (value === undefined || valueContext === undefined) && "self-center", "@max-[14rem]/finance-row:self-end")}
            data-slot="finance-row-value"
          >
            {value === undefined ? null : (
              <ItemTitle
                className="w-full min-w-0 justify-end text-end"
                numeric
                truncate="wrap"
                tone={valueTitleTone[valueTone]}
                data-value-tone={valueTone}
              >
                {value}
              </ItemTitle>
            )}
            {valueContext === undefined ? null : (
              <ItemDescription
                lines={1}
                className="w-full text-end"
                title={valueContextTitle}
              >
                {valueContext}
              </ItemDescription>
            )}
          </ItemContent>
        ) : null}
      </div>
      {action ? (
        <ItemActions className="shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="compact-touch"
            aria-label={action.accessibleLabel}
            disabled={action.disabled}
            loading={action.pending}
            onClick={(event) => action.onAction(event.currentTarget)}
            onPointerDown={action.onIntent}
          >
            {action.label}
          </Button>
        </ItemActions>
      ) : readRetry || (activation && (attention || chevron)) ? (
        <ItemActions aria-hidden="true">
          {readRetry
            ? <span className="size-4" />
            : attention
            ? <CircleAlert className="size-4 text-foreground" />
            : <ChevronRight className="size-4 text-muted-foreground" />}
        </ItemActions>
      ) : null}
    </>
  );

  return (
    <li {...liProps} className={cn("@container/finance-row", readRetry && "relative", liProps?.className)}>
      <Item
        data-kind={kind}
        className={cn("flex-nowrap items-center gap-3 py-2", activation && "h-auto cursor-pointer")}
        {...(activation
          ? {
              render: (
                <Button
                  type="button"
                  variant="ghost"
                  press="none"
                  aria-describedby={hintId}
                  onClick={(event) => activation(event.currentTarget)}
                />
              ),
            }
          : {})}
      >
        {content}
        {activation ? (
          <span id={hintId} hidden>
            {activateLabel ?? "View details"}
          </span>
        ) : null}
      </Item>
      {readRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="absolute -inset-e-0.5 top-1/2 z-10 size-11 -translate-y-1/2"
          aria-label={readRetry.label}
          onClick={readRetry.onRetry}
        >
          <RotateCw className="size-4 text-primary" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

function DirectionIcon({ value }: { value: string }) {
  if (value === "↓") return <ArrowDown className="size-4" />;
  if (value === "↑") return <ArrowUp className="size-4" />;
  if (value === "↔") return <ArrowLeftRight className="size-4" />;
  return <span>{value}</span>;
}
