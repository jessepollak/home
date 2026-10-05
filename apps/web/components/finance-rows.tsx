import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, ChevronRight, CircleAlert, RotateCw } from "lucide-react";
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
  iconTone?: "neutral" | "incoming" | "outgoing" | "self" | "outlined" | "mark" | "stack";
  label: ReactNode;
  labelSuffix?: ReactNode;
  context?: ReactNode;
  reserveContext?: boolean;
  contextLines?: 1 | 2;
  contextTitle?: string;
  value?: ReactNode;
  valueContext?: ReactNode;
  valueContextTitle?: string;
  valueContextLines?: 1 | 2 | "wrap";
  valueTone?: FinanceRowTone;
};

type FinanceRowInteractionProps =
  | {
      action: FinanceRowAction;
      onActivate?: never;
      onIntent?: never;
      activateLabel?: never;
      attention?: never;
      chevron?: never;
      readRetry?: never;
      disclosure?: never;
    }
  | {
      action?: never;
      onActivate?: (opener: HTMLElement) => void;
      onIntent?: () => void;
      activateLabel?: string;
      attention?: string;
      chevron?: boolean;
      readRetry?: { label: string; onRetry: () => void };
      disclosure?: { expanded: boolean; controls?: string; content?: ReactNode };
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
  labelSuffix,
  context,
  reserveContext = false,
  contextLines = 1,
  contextTitle,
  value,
  valueContext,
  valueContextTitle,
  valueContextLines,
  valueTone = "default",
  action,
  onActivate,
  onIntent,
  activateLabel,
  attention,
  chevron = true,
  readRetry,
  disclosure,
}: FinanceRowProps) {
  const hintId = useId();
  const activation = action ? undefined : onActivate;
  const hasValue = value !== undefined || valueContext !== undefined;
  const reservesEmptyContext = context === undefined && reserveContext && labelSuffix === undefined;
  const rowContext = context === undefined && (!reserveContext || reservesEmptyContext) ? null : (
    <ItemDescription lines={contextLines} tone={disclosure ? "disclosure" : undefined} className={cn(contextLines === 2 && "whitespace-normal", labelSuffix !== undefined && "order-4 mt-0.5 max-w-full shrink-0")} title={contextTitle}>
      {context ?? <span aria-hidden="true">{"\u00a0"}</span>}
    </ItemDescription>
  );
  const labelAndContext = (
    <>
      <ItemTitle className={labelSuffix === undefined ? "w-full min-w-0" : "order-1 max-w-full shrink-0 whitespace-normal"} truncate={labelSuffix === undefined ? "stacked" : false}>
        {labelSuffix === undefined ? label : <span className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5">
          <span className="min-w-0 truncate">{label}{" "}</span>
          <span className="shrink-0 whitespace-nowrap">{labelSuffix}</span>
        </span>}
      </ItemTitle>
      {rowContext}
    </>
  );
  const valuePieces = (
    <>
      {value === undefined ? null : (
        <ItemTitle
          className={labelSuffix === undefined ? "w-full min-w-0 justify-end text-end" : "order-2 -mb-0.5 ms-auto max-w-full shrink-0 justify-end text-end"}
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
          lines={valueContextLines ?? (labelSuffix === undefined ? 1 : "wrap")}
          className={labelSuffix === undefined ? "w-full text-end" : "order-5 mt-0.5 ms-auto max-w-full shrink-0 text-end"}
          tone={disclosure ? "disclosure" : undefined}
          title={valueContextTitle}
        >
          {valueContext}
        </ItemDescription>
      )}
    </>
  );
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
            iconTone === "stack" && "bg-transparent text-inherit",
          )}
          data-tone={iconTone}
        >
          {typeof icon === "string" ? <DirectionIcon value={icon} /> : icon}
        </span>
      </ItemMedia>
      <div className={cn("flex min-w-0 flex-1 items-start", labelSuffix === undefined ? cn("gap-3 @max-[14rem]/finance-row:flex-col @max-[14rem]/finance-row:gap-1", contextLines === 2 && "flex-wrap gap-y-1") : "flex-wrap gap-x-2 gap-y-0 @max-[14rem]/finance-row:order-3 @max-[14rem]/finance-row:basis-full")} data-slot="finance-row-body">
        {labelSuffix === undefined ? (
          <ItemContent className={cn("min-w-0 gap-0.5 @max-[14rem]/finance-row:w-full @max-[14rem]/finance-row:self-stretch", contextLines === 2 && "min-w-min", reservesEmptyContext && "min-h-[calc(2.875em+0.125rem)] justify-center", (context === undefined || value === undefined || valueContext === undefined) && "self-center")}>
            {labelAndContext}
          </ItemContent>
        ) : <div className="contents" data-slot="finance-row-label">{labelAndContext}</div>}
        {activation && attention ? <span className="sr-only">{attention}</span> : null}
        {labelSuffix !== undefined ? <span aria-hidden="true" className="order-3 h-0 basis-full" /> : null}
        {hasValue ? labelSuffix === undefined ? (
          <ItemContent
            position="value"
            className={cn("max-w-2/3 min-w-0 items-end gap-0.5 overflow-hidden text-end @max-[14rem]/finance-row:max-w-full", contextLines === 2 && "ms-auto max-w-full", (value === undefined || valueContext === undefined) && "self-center", "@max-[14rem]/finance-row:self-end")}
            data-slot="finance-row-value"
          >
            {valuePieces}
          </ItemContent>
        ) : <div className="contents" data-slot="finance-row-value">{valuePieces}</div> : null}
      </div>
      {action ? (
        <ItemActions className={cn("shrink-0", labelSuffix !== undefined && "@max-[14rem]/finance-row:order-2 @max-[14rem]/finance-row:ms-auto")}>
          <Button
            type="button"
            variant="secondary"
            size="compact-touch"
            aria-label={action.accessibleLabel}
            disabled={action.disabled}
            loading={action.pending}
            onClick={(event) => action.onAction(event.currentTarget)}
            onPointerDown={action.onIntent}
            onFocus={action.onIntent}
          >
            {action.label}
          </Button>
        </ItemActions>
      ) : readRetry || (activation && (attention || chevron || disclosure)) ? (
        <ItemActions aria-hidden="true" className={labelSuffix !== undefined ? "@max-[14rem]/finance-row:order-2 @max-[14rem]/finance-row:ms-auto" : undefined}>
          {readRetry
            ? <span className="size-4" />
            : attention
            ? <CircleAlert className="size-4 text-foreground" />
            : disclosure
            ? <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", disclosure.expanded && "rotate-180")} />
            : <ChevronRight className="size-4 text-muted-foreground" />}
        </ItemActions>
      ) : null}
    </>
  );

  return (
    <li {...liProps} className={cn("@container/finance-row", readRetry && "relative", liProps?.className)}>
      <Item
        data-kind={kind}
        className={cn("flex-nowrap items-center gap-3 py-2", labelSuffix !== undefined && "@max-[14rem]/finance-row:flex-wrap", activation && "h-auto cursor-pointer")}
        {...(activation
          ? {
              render: (
                <Button
                  type="button"
                  variant="ghost"
                  press="none"
                  aria-describedby={hintId}
                  aria-expanded={disclosure?.expanded}
                  aria-controls={disclosure?.expanded ? disclosure.controls : undefined}
                  onPointerDown={onIntent}
                  onFocus={onIntent}
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
      {disclosure?.expanded ? disclosure.content : null}
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
