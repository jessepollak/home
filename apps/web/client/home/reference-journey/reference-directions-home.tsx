"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HomeBalanceRowView } from "@/client/home/balances-panel";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ReferenceHomeIntent } from "./reference-home";
import {
  ReferenceDisclosureRow,
  ReferenceHomeActionBand,
  ReferenceMoneyValue,
  ReferenceNetPositionHeadline,
  ReferenceNetPositionHeading,
  ReferenceVaultIdentity,
  referenceCashCaption,
  referenceSavedSummaryCaption,
} from "./reference-directions-parts";
import type { ReferencePositionView } from "./reference-position";

/**
 * Three unapproved Home direction examples for
 * [issue #654](https://github.com/jessepollak/home/issues/654), all driven by the same
 * `ReferencePositionView` and the same fixtures:
 *
 * - `ReferenceOverviewHome` (recommended): net position, one Cash / Save summary list,
 *   one action band, recent activity. No per-vault list and no Borrow tile.
 * - `ReferenceStatementHome`: one statement boundary whose Cash and Save rows disclose
 *   their detail in place, with the cash actions scoped inside the disclosure.
 * - `ReferenceTabbedHome`: local owned tabs split Money from Activity on Home.
 *
 * These are production-intended proposal compositions, not the live Home data path. They
 * are not reachable from `HomeShell`; loading, empty, partial, and debt semantics come
 * from the presenter and stay possible even though the checkpoint stories are funded.
 */

export type ReferenceDirectionsHomeProps = {
  position: ReferencePositionView;
  /** The production Activity panel for this surface; the compositions do not restyle it. */
  activityContent: ReactNode;
  onIntent?: (intent: ReferenceHomeIntent) => void;
  onOpenSave?: (vaultAddress?: string) => void;
};

/**
 * Cash is stated exactly once here: the hero carries net position and assets, and the
 * Cash row owns the available amount. Save states the aggregate with the combined APY.
 */
function ReferenceMoneySummary({
  position,
  onOpenSave,
}: {
  position: ReferencePositionView;
  onOpenSave?: (vaultAddress?: string) => void;
}) {
  return (
    <Card>
      <CardContent inset="list">
        <ul className="list-none p-0">
          <li>
            <Item variant="flush" className="h-auto min-h-14 flex-nowrap items-center">
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words" truncate={false}>
                  <span role="heading" aria-level={2}>
                    Cash
                  </span>
                </ItemTitle>
                <ItemDescription lines={1}>{referenceCashCaption(position)}</ItemDescription>
              </ItemContent>
              <span className="text-sm text-foreground tabular-nums">
                <ReferenceMoneyValue value={position.cash.subtotalLabel} />
              </span>
            </Item>
          </li>
          <li>
            <Item
              variant="flush"
              className="h-auto min-h-14 flex-nowrap items-center text-left"
              render={
                onOpenSave ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="h-auto min-h-11"
                    aria-label="Open Save"
                    onClick={() => onOpenSave()}
                  />
                ) : undefined
              }
            >
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words" truncate={false}>
                  <span role="heading" aria-level={2}>
                    Save
                  </span>
                </ItemTitle>
                <ItemDescription lines={1}>
                  {referenceSavedSummaryCaption(position)}
                </ItemDescription>
              </ItemContent>
              <span className="flex items-center gap-1 text-sm text-foreground tabular-nums">
                <ReferenceMoneyValue value={position.saved.totalLabel} />
                {onOpenSave ? (
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                ) : null}
              </span>
            </Item>
          </li>
        </ul>
        {position.cash.rows.length > 1 && position.statusNote ? (
          <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground" role="status">
            {position.statusNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ReferenceOverviewHome({
  position,
  activityContent,
  onIntent,
  onOpenSave,
}: ReferenceDirectionsHomeProps) {
  return (
    <div className="space-y-4">
      <ReferenceNetPositionHeading position={position} />
      <ReferenceMoneySummary position={position} onOpenSave={onOpenSave} />
      <ReferenceHomeActionBand onIntent={onIntent} />
      {/* The Activity panel already owns its card and labelled region. */}
      <div>{activityContent}</div>
    </div>
  );
}

export function ReferenceStatementHome({
  position,
  activityContent,
  onIntent,
  onOpenSave,
}: ReferenceDirectionsHomeProps) {
  // Cash is the default-disclosed row so the primary action is visible on first render.
  const [openRows, setOpenRows] = useState({ cash: true, save: false });
  const fundedVaults = position.saved.vaults.filter((vault) => vault.funded);
  const canListVaults =
    position.saved.status !== "loading" && position.saved.status !== "unavailable";

  return (
    <div className="space-y-4">
      {/* One statement boundary: headline, disclosed rows, and locally scoped actions. */}
      <Card variant="flush">
        <CardContent inset="hero">
          <ReferenceNetPositionHeadline position={position} />
        </CardContent>
        <div className="border-t">
          <ReferenceDisclosureRow
            id="reference-statement-cash"
            toggleLabel="Cash details"
            expanded={openRows.cash}
            onToggle={() => setOpenRows((current) => ({ ...current, cash: !current.cash }))}
            heading={
              <span role="heading" aria-level={2} className="text-sm font-medium">
                Cash
              </span>
            }
            summary={
              <>
                <span>{referenceCashCaption(position)}</span>
                <ReferenceMoneyValue value={position.cash.subtotalLabel} />
              </>
            }
          >
            {position.cash.status === "loading" ? <ShimmerRows count={1} /> : null}
            {position.cash.rows.length > 0 ? (
              <ul className="list-none p-0">
                {position.cash.rows.map((row) => (
                  <HomeBalanceRowView key={row.key} row={row} />
                ))}
              </ul>
            ) : position.cash.status === "unavailable" ? (
              <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">
                Cash balance unavailable
              </p>
            ) : null}
            {/* Cash actions stay with the cash they act on. */}
            <div className="px-3 pt-2 pb-3">
              <ReferenceHomeActionBand onIntent={onIntent} />
            </div>
          </ReferenceDisclosureRow>

          <ReferenceDisclosureRow
            id="reference-statement-save"
            toggleLabel="Save details"
            expanded={openRows.save}
            onToggle={() => setOpenRows((current) => ({ ...current, save: !current.save }))}
            heading={
              <span role="heading" aria-level={2} className="text-sm font-medium">
                Save
              </span>
            }
            summary={
              <>
                <span>{referenceSavedSummaryCaption(position)}</span>
                <ReferenceMoneyValue value={position.saved.totalLabel} />
              </>
            }
          >
            {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
            {position.saved.status === "unavailable" ? (
              <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">
                Saved balance unavailable
              </p>
            ) : null}
            {canListVaults && fundedVaults.length > 0 ? (
              <ul className="list-none p-0">
                {fundedVaults.map((vault) => (
                  <li key={vault.vaultAddress}>
                    <Item
                      variant="flush"
                      className="h-auto min-h-14 flex-nowrap items-start justify-start text-left"
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="lg"
                          className="h-auto min-h-11"
                          aria-label={`Open ${vault.name} in Save`}
                          onClick={() => onOpenSave?.(vault.vaultAddress)}
                        />
                      }
                    >
                      <ReferenceVaultIdentity vault={vault} />
                      <ItemActions aria-hidden="true">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </ItemActions>
                    </Item>
                  </li>
                ))}
              </ul>
            ) : null}
            {canListVaults && fundedVaults.length === 0 ? (
              <div className="px-3 pb-2">
                <Empty className="items-start justify-start text-left">
                  <EmptyHeader className="items-start">
                    <EmptyTitle>Nothing saved yet</EmptyTitle>
                  </EmptyHeader>
                </Empty>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-auto min-h-11 w-full whitespace-normal"
                  onClick={() => onOpenSave?.()}
                >
                  Get started
                </Button>
              </div>
            ) : null}
          </ReferenceDisclosureRow>
        </div>
      </Card>
      <div>{activityContent}</div>
    </div>
  );
}

export function ReferenceTabbedHome({
  position,
  activityContent,
  onIntent,
  onOpenSave,
}: ReferenceDirectionsHomeProps) {
  return (
    <Tabs defaultValue="money">
      <TabsList variant="line" size="touch" className="w-full">
        <TabsTrigger value="money">
          Money
        </TabsTrigger>
        <TabsTrigger value="activity">
          Activity
        </TabsTrigger>
      </TabsList>
      <TabsContent value="money">
        <div className="space-y-4">
          <ReferenceNetPositionHeading position={position} />
          <ReferenceMoneySummary position={position} onOpenSave={onOpenSave} />
          <ReferenceHomeActionBand onIntent={onIntent} />
        </div>
      </TabsContent>
      <TabsContent value="activity">{activityContent}</TabsContent>
    </Tabs>
  );
}
