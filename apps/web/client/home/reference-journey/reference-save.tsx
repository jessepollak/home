"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ReferencePositionView, ReferenceVaultView } from "./reference-position";

/**
 * Reference Save composition for [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * `variant` is an explicit composition contract, not a theme switch:
 * - `ledger` is the recommended Option A. One Saved hero plus one dense vault ledger, with
 *   the deposit and withdraw actions at the ledger footer and Fee/Curator disclosed inline
 *   for the selected vault.
 * - `tiles` is Option B. The primary deposit action lives in the Saved hero, and each vault
 *   is a larger selectable card in its own section.
 *
 * Both variants receive the same position view and the same selected vault, so the
 * comparison never changes data, labels, or formatting. Withdraw keeps the existing
 * production dialog; this component only owns layout and selection semantics.
 */

export type ReferenceSaveVariant = "ledger" | "tiles";

export type ReferenceSaveCompositionProps = {
  variant: ReferenceSaveVariant;
  position: ReferencePositionView;
  selectedVaultAddress: string | null;
  onSelectVault: (vaultAddress: string) => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
};

export function ReferenceSaveComposition({
  variant,
  position,
  selectedVaultAddress,
  onSelectVault,
  onDeposit,
  onWithdraw,
}: ReferenceSaveCompositionProps) {
  // Every configured candidate stays visible and selectable; unfunded vaults show $0.00.
  const vaults = position.saved.vaults;
  const selectedVault =
    vaults.find((vault) => vault.vaultAddress === selectedVaultAddress) ?? vaults[0] ?? null;
  const canListVaults =
    position.saved.status !== "loading" && position.saved.status !== "unavailable";
  const depositEnabled =
    position.cash.status === "available" && canListVaults && selectedVault !== null;
  const withdrawEnabled = selectedVault?.funded === true;

  return (
    <div className="space-y-4">
      <ReferenceSavedHero
        position={position}
        actions={variant === "tiles" ? (
          <ReferenceSaveActions
            depositEnabled={depositEnabled}
            withdrawEnabled={withdrawEnabled}
            depositTarget={selectedVault?.name ?? null}
            onDeposit={onDeposit}
            onWithdraw={onWithdraw}
          />
        ) : null}
      />

      {variant === "ledger" ? (
        <Card>
          <CardHeader>
            <CardTitle id="reference-vaults-heading" role="heading" aria-level={2}>
              Vaults
            </CardTitle>
          </CardHeader>
          <CardContent inset="list">
            {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
            {position.saved.status === "unavailable" ? (
              <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">
                Saved balance unavailable
              </p>
            ) : null}
            {canListVaults && vaults.length > 0 ? (
              <div role="radiogroup" aria-label="Vault">
                {vaults.map((vault) => (
                  <LedgerVaultRow
                    key={vault.vaultAddress}
                    vault={vault}
                    selected={vault.vaultAddress === selectedVault?.vaultAddress}
                    onSelect={onSelectVault}
                  />
                ))}
              </div>
            ) : null}
            <div className="space-y-2 px-3 pt-3">
              {selectedVault ? (
                <p className="text-xs text-muted-foreground">
                  {`Selected · ${selectedVault.name}`}
                </p>
              ) : null}
              <ReferenceSaveActions
                depositEnabled={depositEnabled}
                withdrawEnabled={withdrawEnabled}
                depositTarget={selectedVault?.name ?? null}
                onDeposit={onDeposit}
                onWithdraw={onWithdraw}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle id="reference-vaults-heading" role="heading" aria-level={2}>
              Your vaults
            </CardTitle>
          </CardHeader>
          <CardContent inset="list">
            {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
            {position.saved.status === "unavailable" ? (
              <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">
                Saved balance unavailable
              </p>
            ) : null}
            {canListVaults && vaults.length > 0 ? (
              <div className="space-y-2 px-1 pb-1" role="radiogroup" aria-label="Vault">
                {vaults.map((vault) => (
                  <TileVaultCard
                    key={vault.vaultAddress}
                    vault={vault}
                    selected={vault.vaultAddress === selectedVault?.vaultAddress}
                    onSelect={onSelectVault}
                  />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ReferenceSavedHero({
  position,
  actions,
}: {
  position: ReferencePositionView;
  actions?: ReactNode;
}) {
  const loading = position.saved.status === "loading";
  const funded = position.saved.funded;
  return (
    <section aria-label="Saved" aria-busy={loading || undefined}>
      <Card variant="flush">
      <CardContent inset="hero">
        <h1 className="text-sm font-normal text-muted-foreground">Saved</h1>
        {loading ? (
          <Skeleton className="h-10 w-48" data-shimmer="reference-saved-hero" />
        ) : (
          <p
            className={`break-words text-2xl font-semibold tracking-tight tabular-nums sm:text-4xl ${funded ? "" : "text-muted-foreground"}`.trim()}
          >
            <MoneyTicker value={position.saved.totalLabel ?? "—"} align="start" reserveDigits={false} />
          </p>
        )}
        <p className="text-sm text-muted-foreground" role="status">
          {savedCaption(position)}
        </p>
        {actions ? <div className="pt-2">{actions}</div> : null}
      </CardContent>
      </Card>
    </section>
  );
}

function ReferenceSaveActions({
  depositEnabled,
  withdrawEnabled,
  depositTarget,
  onDeposit,
  onWithdraw,
}: {
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositTarget: string | null;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="lg"
        className="h-auto min-h-11 whitespace-normal"
        disabled={!depositEnabled}
        aria-label={depositTarget ? `Deposit to ${depositTarget}` : "Deposit"}
        onClick={onDeposit}
      >
        Deposit
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-auto min-h-11 whitespace-normal"
        disabled={!withdrawEnabled}
        aria-label={depositTarget ? `Withdraw from ${depositTarget}` : "Withdraw"}
        onClick={onWithdraw}
      >
        Withdraw
      </Button>
    </div>
  );
}

/** Loading and unavailable savings never claim the customer has nothing saved. */
function savedCaption(position: ReferencePositionView): string {
  if (position.saved.status === "loading") return "Loading…";
  if (position.saved.status === "unavailable") return "Saved balance unavailable";
  if (position.saved.status === "empty") return "Nothing saved yet";
  return position.saved.apyValueLabel
    ? `Earning ~${position.saved.apyValueLabel}`
    : position.saved.apyLabel ?? "Saved balance unavailable";
}

function LedgerVaultRow({
  vault,
  selected,
  onSelect,
}: {
  vault: ReferenceVaultView;
  selected: boolean;
  onSelect: (vaultAddress: string) => void;
}) {
  const detailsId = `reference-vault-${vault.vaultAddress}-details`;
  return (
    <div className={`border-b last:border-b-0 ${selected ? "bg-muted/50" : ""}`.trim()}>
      <Item
        variant="flush"
        className="h-auto min-h-11 cursor-pointer flex-nowrap items-start text-left justify-start"
        data-selected={selected ? "true" : undefined}
        render={
          <Button
            variant="ghost"
            size="lg"
            type="button"
            onClick={() => onSelect(vault.vaultAddress)}
            role="radio"
            aria-checked={selected}
            aria-controls={selected ? detailsId : undefined}
            name="reference-ledger-vault"
          />
        }
      >
        <ItemMedia variant="avatar" aria-hidden="true">
          {selected ? (
            <Check className="size-4 text-primary" />
          ) : (
            <span className="text-xs font-semibold text-foreground">{vault.initials}</span>
          )}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="whitespace-normal break-words" truncate={false}>
            {vault.name}
          </ItemTitle>
          <ItemDescription>{vault.apyLabel}</ItemDescription>
          <ItemTitle numeric truncate={false}>
            <MoneyTicker value={vault.amountLabel} reserveDigits={false} />
          </ItemTitle>
        </ItemContent>
      </Item>
      {selected ? <VaultDisclosure vault={vault} id={detailsId} /> : null}
    </div>
  );
}

function TileVaultCard({
  vault,
  selected,
  onSelect,
}: {
  vault: ReferenceVaultView;
  selected: boolean;
  onSelect: (vaultAddress: string) => void;
}) {
  const detailsId = `reference-vault-${vault.vaultAddress}-details`;
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card pt-1 transition-colors ${
        selected ? "border-primary" : "border-border"
      }`}
      data-selected={selected ? "true" : undefined}
    >
      <Item
        variant="flush"
        className="h-auto min-h-11 cursor-pointer flex-nowrap items-start text-left justify-start"
        render={
          <Button
            variant="ghost"
            size="lg"
            type="button"
            onClick={() => onSelect(vault.vaultAddress)}
            role="radio"
            aria-checked={selected}
            aria-controls={selected ? detailsId : undefined}
            name="reference-tile-vault"
          />
        }
      >
        <ItemMedia variant="avatar" aria-hidden="true">
          {selected ? (
            <Check className="size-4 text-primary" />
          ) : (
            <span className="text-xs font-semibold text-foreground">{vault.initials}</span>
          )}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="whitespace-normal break-words" truncate={false}>
            {vault.name}
          </ItemTitle>
          <ItemDescription>{vault.apyLabel}</ItemDescription>
          <ItemTitle numeric truncate={false}>
            <MoneyTicker value={vault.amountLabel} reserveDigits={false} />
          </ItemTitle>
        </ItemContent>
      </Item>
      {selected ? <VaultDisclosure vault={vault} id={detailsId} /> : null}
    </div>
  );
}

/** The production Fee/Curator disclosure block, kept for the selected vault only. */
function VaultDisclosure({ vault, id }: { vault: ReferenceVaultView; id: string }) {
  return (
    <dl id={id} className="grid grid-cols-2 gap-4 border-t px-4 py-3" aria-label={`${vault.name} details`}>
      <div className="min-w-0">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fee</dt>
        <dd className="mt-1 text-sm tabular-nums">{vault.feeLabel}</dd>
      </div>
      <div className="min-w-0 text-right">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Curator</dt>
        <dd className="mt-1 min-w-0 text-sm">{vault.curatorLabel}</dd>
      </div>
    </dl>
  );
}
