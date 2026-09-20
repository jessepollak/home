"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Item } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShimmerRows } from "@/client/home/panel-shared";
import {
  ReferenceDisclosureRow,
  ReferenceMoneyValue,
  ReferenceSaveActionBand,
  ReferenceSavedHeadline,
  ReferenceSavedHeading,
  ReferenceVaultDetails,
  ReferenceVaultIdentity,
} from "./reference-directions-parts";
import type { ReferencePositionView, ReferenceVaultView } from "./reference-position";

/**
 * Three unapproved Save direction examples for
 * [issue #654](https://github.com/jessepollak/home/issues/654), all driven by the same
 * `ReferencePositionView`, the same fixtures, and the same selected-vault contract as the
 * connected reference journey:
 *
 * - `ReferenceWorkspaceSave` (recommended): Saved aggregate with the combined APY, one
 *   selected-vault workspace with a change-vault `Select`, a Fee/Curator disclosure, and
 *   Deposit primary / Withdraw quiet scoped by the visible vault name.
 * - `ReferenceStatementSave`: one statement boundary where each vault row discloses its
 *   own details and actions in place.
 * - `ReferenceTabbedSave`: local owned tabs split Your savings from All vaults, with an
 *   explicit selected target and one action band in normal flow.
 *
 * Proposal-only source: not reachable from `HomeShell`. Deposit and Withdraw keep the
 * journey's callback shape (`onDeposit` / `onWithdraw`) so the existing money sheet can be
 * wired without this module simulating a provider result.
 */

export type ReferenceDirectionsSaveProps = {
  position: ReferencePositionView;
  selectedVaultAddress: string | null;
  onSelectVault: (vaultAddress: string | null) => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
};

function selectedVaultWithFallback(
  vaults: readonly ReferenceVaultView[],
  selectedVaultAddress: string | null,
): ReferenceVaultView | null {
  return (
    vaults.find((vault) => vault.vaultAddress === selectedVaultAddress) ??
    vaults.find((vault) => vault.funded) ??
    vaults[0] ??
    null
  );
}

/** The selected vault's Fee/Curator detail opens in place, below the workspace summary. */
function VaultDetailsDisclosure({
  vault,
  open,
  onToggle,
  detailsId,
}: {
  vault: ReferenceVaultView;
  open: boolean;
  onToggle: () => void;
  detailsId: string;
}) {
  return (
    <div className="border-t">
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="h-auto min-h-11 w-full justify-between text-left whitespace-normal"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span>Vault details</span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`.trim()}
          aria-hidden="true"
        />
      </Button>
      <div id={detailsId} hidden={!open}>
        <ReferenceVaultDetails vault={vault} />
      </div>
    </div>
  );
}

export function ReferenceWorkspaceSave({
  position,
  selectedVaultAddress,
  onSelectVault,
  onDeposit,
  onWithdraw,
}: ReferenceDirectionsSaveProps) {
  const vaults = position.saved.vaults;
  const selectedVault = selectedVaultWithFallback(vaults, selectedVaultAddress);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const otherFundedVaults = vaults.filter(
    (vault) => vault.funded && vault.vaultAddress !== selectedVault?.vaultAddress,
  );
  const canUseVault =
    position.saved.status !== "loading" && position.saved.status !== "unavailable";
  const depositEnabled = position.cash.status === "available" && canUseVault && selectedVault !== null;
  const withdrawEnabled = selectedVault?.funded === true;
  const detailsId = "reference-workspace-vault-details";

  return (
    <div className="space-y-4">
      <ReferenceSavedHeading position={position} />

      <Card>
        <CardHeader>
          <CardTitle>
            <span role="heading" aria-level={2}>
              Your vault
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent inset="list">
          {canUseVault && vaults.length > 0 ? (
            <div className="px-3 pt-2 pb-1">
              <Field>
                <FieldLabel htmlFor="reference-change-vault">Vault</FieldLabel>
                <Select
                  value={selectedVault?.vaultAddress ?? null}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    setDetailsOpen(false);
                    onSelectVault(value);
                  }}
                >
                  <SelectTrigger id="reference-change-vault" size="touch" className="w-full">
                    <SelectValue>{() => "Change vault"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {vaults.map((vault) => (
                      <SelectItem key={vault.vaultAddress} value={vault.vaultAddress}>
                        {vault.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}
          {position.saved.status === "loading" ? <ShimmerRows count={1} /> : null}
          {position.saved.status === "unavailable" ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Saved balance unavailable</p>
          ) : null}

          {canUseVault && selectedVault ? (
            <>
              <Item variant="flush" className="h-auto min-h-14">
                <ReferenceVaultIdentity vault={selectedVault} />
              </Item>
              {otherFundedVaults.length > 0 ? (
                <div className="border-t px-3 py-2">
                  <p className="text-xs text-muted-foreground">Also saved</p>
                  <ul className="mt-1 space-y-1">
                    {otherFundedVaults.map((vault) => (
                      <li key={vault.vaultAddress} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words">{vault.name}</span>
                        <span className="shrink-0 tabular-nums">
                          <ReferenceMoneyValue value={vault.amountLabel} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <VaultDetailsDisclosure
                vault={selectedVault}
                open={detailsOpen}
                onToggle={() => setDetailsOpen((open) => !open)}
                detailsId={detailsId}
              />
              <div className="px-3 pt-3 pb-1">
                <ReferenceSaveActionBand
                  vaultName={selectedVault.name}
                  depositEnabled={depositEnabled}
                  withdrawEnabled={withdrawEnabled}
                  onDeposit={onDeposit}
                  onWithdraw={onWithdraw}
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReferenceStatementSave({
  position,
  selectedVaultAddress,
  onSelectVault,
  onDeposit,
  onWithdraw,
}: ReferenceDirectionsSaveProps) {
  const vaults = position.saved.vaults;
  // The disclosed vault is the exact selection; closing every row leaves no scoped action.
  const selectedVault =
    vaults.find((vault) => vault.vaultAddress === selectedVaultAddress) ?? null;
  const canUseVault =
    position.saved.status !== "loading" && position.saved.status !== "unavailable";
  const depositEnabled = position.cash.status === "available" && selectedVault !== null;
  const withdrawEnabled = selectedVault?.funded === true;

  return (
    <div className="space-y-4">
      <Card variant="flush">
        <CardContent inset="hero">
          <ReferenceSavedHeadline position={position} />
        </CardContent>
        <div className="border-t">
          {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
          {position.saved.status === "unavailable" ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Saved balance unavailable</p>
          ) : null}
          {canUseVault
            ? vaults.map((vault) => {
                const expanded = selectedVault?.vaultAddress === vault.vaultAddress;
                const detailsId = `reference-statement-vault-${vault.vaultAddress.slice(2, 10)}`;
                return (
                  <ReferenceDisclosureRow
                    key={vault.vaultAddress}
                    id={detailsId}
                    toggleLabel={`${vault.name} details`}
                    expanded={expanded}
                    onToggle={() => onSelectVault(expanded ? null : vault.vaultAddress)}
                    heading={
                      <span role="heading" aria-level={2} className="whitespace-normal break-words">
                        {vault.name}
                      </span>
                    }
                    summary={
                      <>
                        <span>{vault.apyLabel}</span>
                        <ReferenceMoneyValue value={vault.amountLabel} />
                      </>
                    }
                  >
                    <ReferenceVaultDetails vault={vault} />
                    <div className="px-3 pt-2 pb-3">
                      <ReferenceSaveActionBand
                        vaultName={vault.name}
                        depositEnabled={depositEnabled}
                        withdrawEnabled={withdrawEnabled}
                        onDeposit={onDeposit}
                        onWithdraw={onWithdraw}
                      />
                    </div>
                  </ReferenceDisclosureRow>
                );
              })
            : null}
        </div>
      </Card>
    </div>
  );
}

function SelectableVaultRow({
  vault,
  selected,
  onSelect,
  group,
}: {
  vault: ReferenceVaultView;
  selected: boolean;
  onSelect: (vaultAddress: string) => void;
  group: string;
}) {
  return (
    <Item
      variant="flush"
      className="h-auto min-h-14 cursor-pointer flex-nowrap items-start justify-start text-left"
      data-selected={selected ? "true" : undefined}
      render={
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-auto min-h-11"
          role="radio"
          aria-checked={selected}
          name={group}
          onClick={() => onSelect(vault.vaultAddress)}
        />
      }
    >
      <ReferenceVaultIdentity vault={vault} selected={selected} />
    </Item>
  );
}

export function ReferenceTabbedSave({
  position,
  selectedVaultAddress,
  onSelectVault,
  onDeposit,
  onWithdraw,
}: ReferenceDirectionsSaveProps) {
  const vaults = position.saved.vaults;
  const selectedVault = selectedVaultWithFallback(vaults, selectedVaultAddress);
  const fundedVaults = vaults.filter((vault) => vault.funded);
  const canUseVault =
    position.saved.status !== "loading" && position.saved.status !== "unavailable";
  const depositEnabled = position.cash.status === "available" && selectedVault !== null;
  const withdrawEnabled = selectedVault?.funded === true;

  return (
    <div className="space-y-4">
      <ReferenceSavedHeading position={position} />

      <Tabs defaultValue="savings">
        <TabsList variant="line" size="touch" className="w-full">
          <TabsTrigger value="savings">
            Your savings
          </TabsTrigger>
          <TabsTrigger value="all">
            All vaults
          </TabsTrigger>
        </TabsList>
        <TabsContent value="savings">
          <div className="space-y-3">
          {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
          {position.saved.status === "unavailable" ? (
            <p className="text-sm text-muted-foreground">Saved balance unavailable</p>
          ) : null}
          {canUseVault && selectedVault ? (
            <p className="text-xs text-muted-foreground">Selected · {selectedVault.name}</p>
          ) : null}
          {canUseVault && fundedVaults.length > 0 ? (
            <div role="radiogroup" aria-label="Your savings">
              {fundedVaults.map((vault) => (
                <SelectableVaultRow
                  key={vault.vaultAddress}
                  vault={vault}
                  selected={vault.vaultAddress === selectedVault?.vaultAddress}
                  onSelect={(vaultAddress) => onSelectVault(vaultAddress)}
                  group="reference-savings-vault"
                />
              ))}
            </div>
          ) : null}
          {canUseVault && fundedVaults.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {position.saved.status === "empty"
                ? "Nothing saved yet. Choose a vault in All vaults to start."
                : "Nothing saved yet"}
            </p>
          ) : null}
          {/* One action band in normal flow, scoped by the selected vault's visible name. */}
          <ReferenceSaveActionBand
            vaultName={selectedVault?.name ?? null}
            depositEnabled={depositEnabled}
            withdrawEnabled={withdrawEnabled}
            onDeposit={onDeposit}
            onWithdraw={onWithdraw}
          />
          </div>
        </TabsContent>
        <TabsContent value="all">
          <div className="space-y-2">
          {canUseVault ? (
            <>
              <p className="text-xs text-muted-foreground">
                Every configured vault stays selectable. Unfunded vaults show a zero balance.
              </p>
              <div role="radiogroup" aria-label="All vaults">
                {vaults.map((vault) => (
                  <SelectableVaultRow
                    key={vault.vaultAddress}
                    vault={vault}
                    selected={vault.vaultAddress === selectedVault?.vaultAddress}
                    onSelect={(vaultAddress) => onSelectVault(vaultAddress)}
                    group="reference-all-vaults"
                  />
                ))}
              </div>
            </>
          ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
