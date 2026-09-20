"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { HomeMark } from "@/components/home-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { reimaginedMoveExecutor } from "./fixtures";
import {
  entryCountLabel,
  presentUnresolvedMovement,
  type ExplorationMoneyState,
} from "./money-state";
import {
  amountTextFromBaseUnits,
  useExplorationMoney,
  useMoveMoneyFlow,
  type ExplorationMoneyController,
  type MoveMoneyExecutor,
  type MoveMoneyStart,
} from "./move-money";
import { MoveMoneyFlow, type MoveMoneyGrammar } from "./move-money-view";
import {
  ActivityEntryRow,
  FactList,
  MoneyValue,
  MovementNotice,
  type ExplorationFact,
} from "./parts";

/**
 * Money Map — direction 1 of the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * A position directory: the overview states the net position and what is available to use,
 * then lists positions that each open their own detail. Vault-level inventory lives in the
 * Saved detail rather than on the overview, and every action is taken from the position it
 * belongs to.
 *
 * Navigation: Money · Activity · Explore.
 */

export type MoneyMapTab = "money" | "activity" | "explore";
export type MoneyMapScreen = "overview" | "cash" | "saved" | "debt" | "move";

export type MoneyMapProps = {
  initialState: ExplorationMoneyState;
  initialTab?: MoneyMapTab;
  initialScreen?: MoneyMapScreen;
  initialFlow?: MoveMoneyStart;
  executeMove?: MoveMoneyExecutor;
};

const moneyMapTabs: readonly { id: MoneyMapTab; label: string }[] = [
  { id: "money", label: "Money" },
  { id: "activity", label: "Activity" },
  { id: "explore", label: "Explore" },
];

const moneyMapGrammar: MoveMoneyGrammar = {
  destination: {
    title: "Where should this go?",
    description: "You choose the vault. Nothing is selected by rate.",
    continueLabel: "Continue",
  },
  amount: {
    title: "How much are you moving?",
    description: "This comes out of available cash and goes into the vault you chose.",
    label: "Amount",
    continueLabel: "Review deposit",
  },
  review: {
    title: "Check this deposit",
    description: "These are the exact facts that will be submitted.",
    submitLabel: (amountLabel) => `Deposit ${amountLabel}`,
  },
  pending: {
    title: "Deposit submitted",
    description: "Waiting for Base to confirm. Nothing has moved yet.",
  },
  result: {
    confirmedTitle: (amountLabel) => `Deposited ${amountLabel}`,
    confirmedDescription: (destinationName) => `Your cash is now saved in ${destinationName}.`,
    failedTitle: "The deposit didn't go through",
    failedDescription: "No money moved. Nothing will retry on its own.",
    unknownTitle: "We couldn't confirm this deposit",
    unknownDescription: "Check Activity before sending anything again.",
  },
  showStepRail: false,
  stepRailLabels: ["Amount", "Review", "Result"],
  receipt: "panel",
  headingTag: "h2",
  backLabel: "Back",
  cancelLabel: "Cancel",
  doneLabel: "Done",
  activityLabel: "Check Activity",
};

export function MoneyMap({
  initialState,
  initialTab = "money",
  initialScreen = "overview",
  initialFlow,
  executeMove = reimaginedMoveExecutor("confirmed"),
}: MoneyMapProps) {
  const money = useExplorationMoney(initialState);
  const [tab, setTab] = useState<MoneyMapTab>(initialTab);
  const [screen, setScreen] = useState<MoneyMapScreen>(initialScreen);
  const [flowStart, setFlowStart] = useState<MoveMoneyStart>(initialFlow ?? { step: "destination" });
  const [flowKey, setFlowKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const unresolved = presentUnresolvedMovement(money.state);

  const openTab = useCallback((next: MoneyMapTab) => {
    setTab(next);
    setScreen("overview");
    setNotice(null);
  }, []);

  const openFlow = useCallback((start: MoveMoneyStart) => {
    setFlowStart(start);
    setFlowKey((current) => current + 1);
    // The workspace lives in the Money tab, so opening it from Activity has to move there
    // too; otherwise the screen changes with nothing to show.
    setTab("money");
    setScreen("move");
    setNotice(null);
  }, []);

  const title =
    tab === "activity"
      ? "Activity"
      : tab === "explore"
        ? "Explore"
        : screen === "cash"
          ? "Cash"
          : screen === "saved"
            ? "Saved"
            : screen === "debt"
              ? "Debt"
              : screen === "move"
                ? "Move money"
                : "Money";

  const retryFailed = useCallback(() => {
    if (!unresolved?.vaultAddress || !unresolved.amountBaseUnits) return;
    // Reopens the amount step with the same vault and amount so the person confirms it
    // again. A failed or unknown outcome never resubmits on its own.
    openFlow({
      step: "amount",
      destinationId: unresolved.vaultAddress,
      amountText: amountTextFromBaseUnits(unresolved.amountBaseUnits),
    });
  }, [openFlow, unresolved]);

  return (
    <div
      // A fixed shell height is what lets the panel scroll on its own: with only a minimum
      // height the shell grows with its content and pushes the navigation off-screen. A
      // comparison frame supplies its own height so a scaled board still ends exactly at
      // its bottom navigation.
      style={{ height: "var(--home-reimagined-frame-height, 100svh)" }}
      className="flex flex-col bg-muted"
    >
      <header className="w-full shrink-0 border-b bg-background">
        <div className={`${shellContentFrameClassName} flex min-h-14 items-center gap-2 py-2`}>
          {screen === "move" || (tab === "money" && screen !== "overview") ? (
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11"
              aria-label="Back to money"
              onClick={() => {
                setScreen("overview");
                setNotice(null);
              }}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <HomeMark onClick={() => openTab("money")} />
          )}
          {/* The shell owns the single h1, matching Home's chrome. */}
          <h1 className="min-w-0 text-base font-semibold">{title}</h1>
        </div>
      </header>

      {/* The panel owns vertical scrolling so the bottom navigation stays persistent while
          a pending or failed movement lengthens the screen. */}
      <main className="min-h-0 flex-1 overflow-y-auto bg-muted pb-4">
        <div className={`${shellContentFrameClassName} py-4`}>
          {notice ? (
            <MovementNotice
              title="Not part of this exploration"
              description={notice}
            />
          ) : null}

          {tab === "money" && screen === "overview" ? (
            <MoneyMapOverview
              money={money}
              unresolved={unresolved}
              onOpenDetail={(next) => {
                setNotice(null);
                setScreen(next);
              }}
              onMove={() => openFlow({ step: "destination" })}
              onOpenActivity={() => openTab("activity")}
              onRetry={retryFailed}
              onIntent={(label) => setNotice(`${label} keeps its existing Home flow in this exploration.`)}
            />
          ) : null}

          {tab === "money" && screen === "cash" ? (
            <MoneyMapCashDetail
              money={money}
              onMove={() => openFlow({ step: "destination" })}
              onIntent={(label) => setNotice(`${label} keeps its existing Home flow in this exploration.`)}
            />
          ) : null}

          {tab === "money" && screen === "saved" ? (
            <MoneyMapSavedDetail
              money={money}
              onMoveFromVault={(vaultAddress) =>
                openFlow({ step: "amount", destinationId: vaultAddress })
              }
            />
          ) : null}

          {tab === "money" && screen === "debt" ? <MoneyMapDebtDetail money={money} /> : null}

          {tab === "money" && screen === "move" ? (
            <MoveMoneyWorkspace
              key={flowKey}
              money={money}
              start={flowStart}
              execute={executeMove}
              onExit={() => setScreen("overview")}
              onOpenActivity={() => openTab("activity")}
            />
          ) : null}

          {tab === "activity" ? (
            <MoneyMapActivity money={money} onRetry={retryFailed} />
          ) : null}

          {tab === "explore" ? (
            <MoneyMapExplore
              onIntent={(label) => setNotice(`${label} keeps its existing Home flow in this exploration.`)}
            />
          ) : null}
        </div>
      </main>

      {/* Bottom navigation, matching Home's persistent three-item grammar. */}
      <nav aria-label="Money map navigation" className="w-full shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className={`${shellContentFrameClassName} flex`}>
          {moneyMapTabs.map((entry) => (
            <Button
              key={entry.id}
              variant="navigation"
              size="lg"
              className="min-h-12 flex-1"
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => openTab(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function MoveMoneyWorkspace({
  money,
  start,
  execute,
  onExit,
  onOpenActivity,
}: {
  money: ExplorationMoneyController;
  start: MoveMoneyStart;
  execute: MoveMoneyExecutor;
  onExit: () => void;
  onOpenActivity: () => void;
}) {
  const flow = useMoveMoneyFlow({
    state: money.state,
    position: money.position,
    start,
    execute,
    record: money.record,
    settle: money.settle,
  });
  return (
    <MoveMoneyFlow
      flow={flow}
      position={money.position}
      grammar={moneyMapGrammar}
      onExit={onExit}
      onOpenActivity={onOpenActivity}
    />
  );
}

function MoneyMapOverview({
  money,
  unresolved,
  onOpenDetail,
  onMove,
  onOpenActivity,
  onRetry,
  onIntent,
}: {
  money: ExplorationMoneyController;
  unresolved: ReturnType<typeof presentUnresolvedMovement>;
  onOpenDetail: (screen: Exclude<MoneyMapScreen, "move">) => void;
  onMove: () => void;
  onOpenActivity: () => void;
  onRetry: () => void;
  onIntent: (label: string) => void;
}) {
  const { position, state } = money;
  const loading = position.status === "loading";
  const funded = BigInt(
    state.cash.status === "available" ? state.cash.baseUnits : "0",
  ) > BigInt(0) || position.fundedVaults > 0;
  // With no vault list there is no destination, so the deposit action cannot be offered.
  const vaultsUnavailable = !loading && position.vaults.length === 0;

  return (
    <div className="grid gap-4">
      {unresolved ? (
        <MovementNotice
          tone={unresolved.tone}
          title={unresolved.title}
          description={unresolved.description}
        >
          {unresolved.safeNextStep === "retry" ? (
            <Button variant="secondary" className="h-11" onClick={onRetry}>
              Try again
            </Button>
          ) : (
            <Button variant="secondary" className="h-11" onClick={onOpenActivity}>
              Check Activity
            </Button>
          )}
        </MovementNotice>
      ) : null}

      <section aria-label="Position" aria-busy={loading || undefined}>
        <Card>
          <CardContent inset="hero">
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">Net position</p>
              {loading ? (
                <span className="sr-only" role="status">
                  Loading your money position…
                </span>
              ) : null}
              {loading ? (
                <Skeleton className="h-9 w-40" />
              ) : position.netPositionLabel ? (
                <MoneyValue value={position.netPositionLabel} emphasis="lg" label={`Net position ${position.netPositionLabel}`} />
              ) : (
                <p className="text-2xl font-semibold text-muted-foreground">Incomplete</p>
              )}
              {loading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {position.debtSettled
                    ? "Nothing owed"
                    : position.debtLabel
                      ? `Debt ${position.debtLabel}`
                      : "Debt not counted yet"}
                </p>
              )}
            </div>

            <Separator />

            <div className="grid gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-muted-foreground">Available to use</span>
                {loading ? (
                  <Skeleton className="h-6 w-24" />
                ) : position.availableLabel ? (
                  <MoneyValue value={position.availableLabel} emphasis="md" label={`Available to use ${position.availableLabel}`} />
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-muted-foreground">Saved</span>
                <span className="flex items-baseline gap-2">
                  {loading ? (
                    <Skeleton className="h-6 w-24" />
                  ) : position.savedLabel ? (
                    <MoneyValue value={position.savedLabel} emphasis="md" label={`Saved ${position.savedLabel}`} />
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                  )}
                  {!loading && position.apyLabel ? (
                    <span className="text-sm text-muted-foreground">{position.apyLabel}</span>
                  ) : null}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {loading ? (
                <>
                  <Button className="h-11 flex-1" disabled>
                    Move money
                  </Button>
                  <Button variant="outline" size="lg" className="h-11" disabled>
                    Add money
                  </Button>
                </>
              ) : funded ? (
                <>
                  <Button
                    className="h-11 flex-1"
                    onClick={onMove}
                    disabled={vaultsUnavailable}
                  >
                    Move money
                  </Button>
                  <Button variant="outline" size="lg" className="h-11" onClick={() => onIntent("Add money")}>
                    Add money
                  </Button>
                </>
              ) : (
                <Button className="h-11 flex-1" onClick={() => onIntent("Add money")}>
                  Add money
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {position.notes.length > 0 ? (
        <MovementNotice
          title="Some balances are not counted yet"
          description={position.notes.join(" ")}
        />
      ) : null}

      <section aria-labelledby="money-map-positions">
        <h2 id="money-map-positions" className="mb-2 text-sm font-medium">
          Positions
        </h2>
        <Card>
          <CardContent inset="list">
            <ul className="grid list-none gap-1 p-0">
              <li>
                <Item
                  render={<Button variant="ghost" />}
                  className="min-h-14 flex-nowrap justify-start text-left"
                  onClick={() => onOpenDetail("cash")}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle truncate={false}>Cash</ItemTitle>
                    {loading ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {position.availableLabel
                          ? `${position.availableLabel} available to use`
                          : "Available to use is unavailable"}
                      </p>
                    )}
                  </ItemContent>
                  <ItemActions aria-hidden="true" className="shrink-0">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              </li>
              <li>
                <Item
                  render={<Button variant="ghost" />}
                  className="min-h-14 flex-nowrap justify-start text-left"
                  onClick={() => onOpenDetail("saved")}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle truncate={false}>Saved</ItemTitle>
                    {loading ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {position.savedLabel
                          ? `${position.savedLabel} in ${position.fundedVaults} ${position.fundedVaults === 1 ? "vault" : "vaults"}`
                          : "Saved balance is unavailable"}
                      </p>
                    )}
                  </ItemContent>
                  <ItemActions aria-hidden="true" className="shrink-0">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              </li>
              <li>
                <Item
                  render={<Button variant="ghost" />}
                  className="min-h-14 flex-nowrap justify-start text-left"
                  onClick={() => onOpenDetail("debt")}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle truncate={false}>Debt</ItemTitle>
                    {loading ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {position.debtSettled
                          ? "Nothing owed"
                          : position.debtLabel ?? "Not counted in the total yet"}
                      </p>
                    )}
                  </ItemContent>
                  <ItemActions aria-hidden="true" className="shrink-0">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              </li>
              <li>
                <Item
                  render={<Button variant="ghost" />}
                  className="min-h-14 flex-nowrap justify-start text-left"
                  onClick={onOpenActivity}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle truncate={false}>Activity</ItemTitle>
                    {loading ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {money.activity.entries.length > 0
                          ? `${entryCountLabel(money.activity.entries.length)}, newest first`
                          : "Nothing has happened yet"}
                      </p>
                    )}
                  </ItemContent>
                  <ItemActions aria-hidden="true" className="shrink-0">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

    </div>
  );
}

function MoneyMapCashDetail({
  money,
  onMove,
  onIntent,
}: {
  money: ExplorationMoneyController;
  onMove: () => void;
  onIntent: (label: string) => void;
}) {
  const { position } = money;
  const facts: ExplorationFact[] = [
    { label: "Available to use", value: position.availableLabel ?? "Unavailable" },
  ];
  if (position.netPositionLabel) {
    facts.push({ label: "Net position", value: position.netPositionLabel });
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent inset="hero">
          <div className="grid gap-4">
            <FactList facts={facts} label="Cash facts" />
            <p className="text-sm text-muted-foreground">
              Available to use is cash only. Saved balances stay in their vaults until you move
              them.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 flex-1"
                onClick={onMove}
                disabled={position.status === "loading" || position.vaults.length === 0}
              >
                Move money into a vault
              </Button>
              <Button variant="outline" size="lg" className="h-11" onClick={() => onIntent("Add money")}>
                Add money
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="money-map-cash-holdings">
        <h2 id="money-map-cash-holdings" className="mb-2 text-sm font-medium">
          Cash holdings
        </h2>
        <Card>
          <CardContent inset="list">
            <ul className="grid list-none gap-1 p-0">
              {position.cashRows.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">
                  No cash balance is available to show.
                </li>
              ) : (
                position.cashRows.map((row) => (
                  <li key={row.key}>
                    <Item size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle truncate={false}>{row.name}</ItemTitle>
                        <p className="text-sm text-muted-foreground">
                          {row.countedInTotal
                            ? "Counted in available to use"
                            : "Not counted until a display quote is configured"}
                        </p>
                      </ItemContent>
                      <ItemActions className="shrink-0">
                        <span className="text-sm font-medium tabular-nums">{row.amountLabel}</span>
                      </ItemActions>
                    </Item>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MoneyMapSavedDetail({
  money,
  onMoveFromVault,
}: {
  money: ExplorationMoneyController;
  onMoveFromVault: (vaultAddress: string) => void;
}) {
  const { position } = money;
  const facts: ExplorationFact[] = [
    { label: "Saved", value: position.savedLabel ?? "Unavailable" },
    { label: "Weighted rate", value: position.apyLabel ?? "Unavailable" },
  ];
  if (position.reconciliationLabel) {
    facts.push({ label: "Net position", value: position.reconciliationLabel });
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent inset="hero">
          <FactList facts={facts} label="Saved facts" />
        </CardContent>
      </Card>

      <section aria-labelledby="money-map-vaults">
        <h2 id="money-map-vaults" className="mb-2 text-sm font-medium">
          Vaults
        </h2>
        <Card>
          <CardContent inset="list">
            <ul className="grid list-none gap-1 p-0">
              {position.vaults.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">
                  Vault balances are unavailable right now.
                </li>
              ) : (
                position.vaults.map((vault) => (
                  <li key={vault.vaultAddress}>
                    <Item className="min-h-14">
                      <ItemContent className="min-w-0">
                        <ItemTitle truncate={false}>{vault.name}</ItemTitle>
                        <p className="text-sm text-muted-foreground">
                          {vault.apyLabel ?? "Rate unavailable"} · {vault.funded ? `${vault.amountLabel} saved` : "Nothing saved yet"}
                        </p>
                      </ItemContent>
                      <ItemActions className="shrink-0">
                        <Button
                          variant="outline"
                          size="lg"
                          className="h-11"
                          onClick={() => onMoveFromVault(vault.vaultAddress)}
                        >
                          Add
                        </Button>
                      </ItemActions>
                    </Item>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MoneyMapDebtDetail({ money }: { money: ExplorationMoneyController }) {
  const { position } = money;
  const facts: ExplorationFact[] = [
    {
      label: "Debt",
      value: position.debtSettled ? "Nothing owed" : position.debtLabel ?? "Unavailable",
    },
  ];
  if (position.reconciliationLabel) {
    facts.push({ label: "Net position", value: position.reconciliationLabel });
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent inset="hero">
          <div className="grid gap-3">
            <FactList facts={facts} label="Debt facts" />
            <p className="text-sm text-muted-foreground">
              {position.debtSettled
                ? "Debt was verified at zero, so the net position is cash plus saved."
                : "Debt is subtracted from the net position. Amounts come from your borrowing position."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MoneyMapActivity({
  money,
  onRetry,
}: {
  money: ExplorationMoneyController;
  onRetry: () => void;
}) {
  const { activity } = money;
  const unresolved = presentUnresolvedMovement(money.state, { context: "activity" });
  return (
    <div className="grid gap-4">
      {unresolved ? (
        <section aria-labelledby="money-map-unresolved">
          <h2 id="money-map-unresolved" className="mb-2 text-sm font-medium">
            Needs an answer
          </h2>
          <MovementNotice
            tone={unresolved.tone}
            title={unresolved.title}
            description={unresolved.description}
          >
            {unresolved.safeNextStep === "retry" ? (
              <Button variant="secondary" className="h-11" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </MovementNotice>
        </section>
      ) : null}

      <section aria-labelledby="money-map-history">
        <h2 id="money-map-history" className="mb-2 text-sm font-medium">
          What happened
        </h2>
        <Card>
          <CardContent inset="list">
            {activity.entries.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                No transfers or deposits yet. New activity appears here as it happens.
              </p>
            ) : (
              <ul className="grid list-none gap-1 p-0">
                {activity.entries.map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MoneyMapExplore({ onIntent }: { onIntent: (label: string) => void }) {
  return (
    <div className="grid gap-4">
      <section aria-labelledby="money-map-explore">
        <h2 id="money-map-explore" className="mb-2 text-sm font-medium">
          Other products
        </h2>
        <Card>
          <CardContent inset="list">
            <ul className="grid list-none gap-1 p-0">
              {["Add money", "Send or receive", "Borrow", "Invest"].map((label) => (
                <li key={label}>
                  <Item
                    render={<Button variant="ghost" />}
                    className="min-h-14 flex-nowrap justify-start text-left"
                    onClick={() => onIntent(label)}
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle truncate={false}>{label}</ItemTitle>
                    </ItemContent>
                    <ItemActions aria-hidden="true" className="shrink-0">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </Item>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

