import { useId } from "react";
import { ChevronRight } from "lucide-react";
import type { BalanceRowProps } from "@/components/finance-rows";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

type ProposalBalanceRowProps = Pick<BalanceRowProps,
  "icon" | "label" | "context" | "value" | "valueContext" | "valueTone" | "onActivate" | "activateLabel" | "chevron">;

export function ProposalBalanceRow({ icon, label, context, value, valueContext, valueTone = "default",
  onActivate, activateLabel, chevron = true,
}: ProposalBalanceRowProps) {
  const hintId = useId();
  return (
    <li className="@container">
      <Item className="min-w-0 flex-nowrap gap-3 py-2 @max-xs:gap-0.5 @max-xs:px-0" render={onActivate ? (
        <Button type="button" variant="ghost" press="none" className="h-auto min-h-11 whitespace-normal" aria-describedby={hintId} onClick={(event) => onActivate(event.currentTarget)} />
      ) : undefined}>
        <ItemMedia variant="avatar" aria-hidden="true">
          <span className="grid size-full place-items-center overflow-hidden rounded-full bg-transparent">{icon}</span>
        </ItemMedia>
        <div className="flex min-w-0 flex-1 flex-col gap-1 @xs:flex-row @xs:items-start @xs:gap-3">
          <ItemContent className="min-w-0 gap-0.5">
            <ItemTitle truncate={false} className="w-full min-w-0"><span className="line-clamp-2 min-w-0 break-words whitespace-normal">{label}</span></ItemTitle>
            {context === undefined ? null : <ItemDescription lines={2}>{context}</ItemDescription>}
          </ItemContent>
          {value !== undefined || valueContext !== undefined ? (
            <ItemContent className="min-w-0 flex-none items-start gap-0.5 @xs:max-w-2/3 @xs:items-end @xs:text-end">
              {value === undefined ? null : (
                <ItemTitle numeric truncate={false} tone={valueTone === "muted" ? "muted" : "default"}>
                  <span className="break-all tabular-nums">{value}</span>
                </ItemTitle>
              )}
              {valueContext === undefined ? null : <ItemDescription size="xs" lines={2} className="@xs:text-end">{valueContext}</ItemDescription>}
            </ItemContent>
          ) : null}
        </div>
        {onActivate && chevron ? <ItemActions aria-hidden="true"><ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" /></ItemActions> : null}
        {onActivate ? <span id={hintId} hidden>{activateLabel ?? "View details"}</span> : null}
      </Item>
    </li>
  );
}
