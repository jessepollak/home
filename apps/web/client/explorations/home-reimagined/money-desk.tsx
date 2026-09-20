"use client";

import { useCallback, useState } from "react";
import { HomeMark } from "@/components/home-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { reimaginedMoveExecutor } from "./fixtures";
import {
  presentUnresolvedMovement,
  type ExplorationMoneyState,
  type ExplorationMovement,
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
  LoadingFacts,
  MoneyValue,
  MovementNotice,
  type ExplorationFact,
} from "./parts";

/**
 * Money Desk — direction 3 of the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * A task-first workspace: Move is the first tab, the deposit is one explicit
 * amount → review → result workspace with a visible step rail, and money is a facts ledger
 * with vault rates shown as reported facts rather than advice.
 *
 * Navigation: Move · Money · Activity.
 */

export type MoneyDeskTab = "move" | "money" | "activity";

export type MoneyDeskProps = {
  initialState: ExplorationMoneyState;
  initialTab?: MoneyDeskTab;
  initialFlow?: MoveMoneyStart;
  executeMove?: MoveMoneyExecutor;
};

const deskTabs: readonly { id: MoneyDeskTab; label: string }[] = [
  { id: "move", label: "Move" },
  { id: "money", label: "Money" },
  { id: "activity", label: "Activity" },
];

const deskGrammar: MoveMoneyGrammar = {
  destination: null,
  amount: {
    title: "Deposit amount",
    description: "You choose the vault. Nothing is selected for you, and no rate is recommended.",
    label: "Amount to deposit",
    continueLabel: "Review",
  },
  review: {
    title: "Review the deposit",
    description: "Exact facts. Nothing moves until you confirm.",
    submitLabel: (amountLabel) => `Confirm deposit ${amountLabel}`,
  },
  pending: {
    title: "Deposit submitted",
    description: "Waiting for confirmation on Base. Balances are unchanged.",
  },
  result: {
    confirmedTitle: (amountLabel) => `Deposited ${amountLabel}`,
    confirmedDescription: (destinationName) => `The money is saved in ${destinationName} now.`,
    failedTitle: "The deposit didn't go through",
    failedDescription: "No money moved. Nothing retries on its own.",
    unknownTitle: "We couldn't confirm this deposit",
    unknownDescription: "Check the log before depositing again.",
  },
  showStepRail: true,
  stepRailLabels: ["Amount", "Review", "Result"],
  receipt: "panel",
  headingTag: "h2",
  backLabel: "Back",
  cancelLabel: "Cancel",
  doneLabel: "Back to desk",
  activityLabel: "Open log",
};

export function MoneyDesk({
  initialState,
  initialTab = "move",
  initialFlow,
  executeMove = reimaginedMoveExecutor("confirmed"),
}: MoneyDeskProps) {
  const money = useExplorationMoney(initialState);
  const [tab, setTab] = useState<MoneyDeskTab>(initialTab);
  const [flowStart, setFlowStart] = useState<MoveMoneyStart>(initialFlow ?? { step: "amount" });
  const [flowKey, setFlowKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const unresolved = presentUnresolvedMovement(money.state);

  const openFlow = useCallback((start: MoveMoneyStart) => {
    setFlowStart(start);
    setFlowKey((current) => current + 1);
    setTab("move");
    setNotice(null);
  }, []);

  return (
    <div
      // `100svh` for a full-screen story; a comparison frame supplies its own height so a
      // scaled board still ends exactly at its bottom navigation.
      style={{ minHeight: "var(--home-reimagined-frame-height, 100svh)" }}
      className="flex min-h-svh flex-col bg-muted"
    >
      <header className="w-full shrink-0 border-b bg-background">
        <div className={`${shellContentFrameClassName} flex min-h-14 items-center gap-2 py-2`}>
          <HomeMark onClick={() => setTab("move")} />
          <h1 className="min-w-0 text-base font-semibold">
            {tab === "money" ? "Money" : tab === "activity" ? "Activity" : "Move"}
          </h1>
        </div>
        <div className={`${shellContentFrameClassName} flex`}>
          {deskTabs.map((entry) => (
            <Button
              key={entry.id}
              variant="navigation"
              size="lg"
              className="min-h-12 flex-1"
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => {
                setTab(entry.id);
                setNotice(null);
              }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 bg-muted pb-4">
        <div className={`${shellContentFrameClassName} py-4`}>
          {notice ? (
            <MovementNotice title="Not part of this exploration" description={notice} />
          ) : null}

          {tab === "move" && unresolved ? (
            <MovementNotice
              tone={unresolved.tone}
              title={unresolved.title}
              description={unresolved.description}
            />
          ) : null}

          {tab === "move" ? (
            <MoneyDeskMove
              key={flowKey}
              money={money}
              start={flowStart}
              execute={executeMove}
              onExit={() => setTab("money")}
              onOpenActivity={() => setTab("activity")}
            />
          ) : null}

          {tab === "money" ? (
            <MoneyDeskMoney
              money={money}
              onMove={() => openFlow({ step: "amount" })}
              onDepositInto={(vaultAddress) =>
                openFlow({ step: "amount", destinationId: vaultAddress })
              }
              onIntent={(label) => setNotice(`${label} keeps its existing Home flow in this exploration.`)}
            />
          ) : null}

          {tab === "activity" ? (
            <MoneyDeskActivity
              money={money}
              onRetry={(movement) =>
                openFlow({
                  step: "amount",
                  destinationId: movement.vaultAddress,
                  amountText: amountTextFromBaseUnits(movement.amountBaseUnits),
                })
              }
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function MoneyDeskMove({
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
    destinationScreen: false,
    execute,
    record: money.record,
    settle: money.settle,
  });
  return (
    <MoveMoneyFlow
      flow={flow}
      position={money.position}
      grammar={deskGrammar}
      onExit={onExit}
      onOpenActivity={onOpenActivity}
    />
  );
}

function MoneyDeskMoney({
  money,
  onMove,
  onDepositInto,
  onIntent,
}: {
  money: ExplorationMoneyController;
  onMove: () => void;
  onDepositInto: (vaultAddress: string) => void;
  onIntent: (label: string) => void;
}) {
  const { position } = money;
  const facts: ExplorationFact[] = [
    { label: "Available to use", value: position.availableLabel ?? "Unavailable" },
    { label: "Saved", value: position.savedLabel ?? "Unavailable" },
    { label: "Weighted rate", value: position.apyLabel ?? "Unavailable" },
    { label: "Debt", value: position.debtSettled ? "Nothing owed" : position.debtLabel ?? "Unavailable" },
  ];

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent inset="hero">
          <div className="grid gap-4">
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">Net position</p>
              {position.status === "loading" ? (
                <Skeleton className="h-9 w-40" />
              ) : position.netPositionLabel ? (
                <MoneyValue
                  value={position.netPositionLabel}
                  emphasis="lg"
                  label={`Net position ${position.netPositionLabel}`}
                />
              ) : (
                <p className="text-2xl font-semibold text-muted-foreground">Incomplete</p>
              )}
              {position.reconciliationLabel ? (
                <p className="text-xs">{position.reconciliationLabel}</p>
              ) : null}
            </div>
            <Separator />
            {position.status === "loading" ? (
              <LoadingFacts rows={4} />
            ) : (
              <FactList facts={facts} label="Position facts" />
            )}
            <Button className="h-11 w-full" onClick={onMove}>
              Deposit into a vault
            </Button>
          </div>
        </CardContent>
      </Card>

      {position.notes.length > 0 ? (
        <MovementNotice
          title="Some balances are not counted yet"
          description={position.notes.join(" ")}
        />
      ) : null}

      <section aria-labelledby="desk-vaults">
        <h2 id="desk-vaults" className="mb-2 text-sm font-medium">
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
                          onClick={() => onDepositInto(vault.vaultAddress)}
                        >
                          Deposit here
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

      <section aria-labelledby="desk-provenance">
        <h2 id="desk-provenance" className="mb-2 text-sm font-medium">
          Where these numbers come from
        </h2>
        <Card>
          <CardContent>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>Vault rates come from the vault data read at 12:03 on Sep 19, 2026.</p>
              <p>Cash and history come from your wallet on Base (8453).</p>
              <Button variant="outline" size="lg" className="h-11" onClick={() => onIntent("Add money")}>
                Add money
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MoneyDeskActivity({
  money,
  onRetry,
}: {
  money: ExplorationMoneyController;
  onRetry: (movement: ExplorationMovement) => void;
}) {
  const { activity } = money;
  const needsAttention = activity.unresolved.filter(
    (entry) => entry.status === "failed" || entry.status === "unknown",
  );
  const inProgress = activity.unresolved.filter((entry) => entry.status === "pending");

  return (
    <div className="grid gap-4">
      <section aria-labelledby="desk-log-attention">
        <h2 id="desk-log-attention" className="mb-2 text-sm font-medium">
          Needs attention
        </h2>
        {needsAttention.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Nothing needs an answer. Failed deposits appear here instead of retrying quietly.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {needsAttention.map((entry) => {
              const movement = money.state.movements.find(
                (candidate) => candidate.id === entry.movementId,
              );
              return (
                <Card key={entry.id}>
                  <CardContent>
                    <div className="grid gap-3">
                      <ActivityEntryRow entry={entry} />
                      {entry.status === "unknown" ? (
                        <p className="text-sm text-muted-foreground">
                          An unknown outcome cannot be retried here: sending it again could move
                          the money twice.
                        </p>
                      ) : movement ? (
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => onRetry(movement)}
                        >
                          Deposit again
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="desk-log-progress">
        <h2 id="desk-log-progress" className="mb-2 text-sm font-medium">
          In progress
        </h2>
        <Card>
          <CardContent inset="list">
            {inProgress.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                No deposit is waiting on the network.
              </p>
            ) : (
              <ul className="grid list-none gap-1 p-0">
                {inProgress.map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="desk-log-settled">
        <h2 id="desk-log-settled" className="mb-2 text-sm font-medium">
          Settled
        </h2>
        <Card>
          <CardContent inset="list">
            {activity.settled.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Nothing has settled yet.
              </p>
            ) : (
              <ul className="grid list-none gap-1 p-0">
                {activity.settled.map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} showStatus={false} />
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
