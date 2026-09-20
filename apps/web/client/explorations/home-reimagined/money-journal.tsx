"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { HomeMark } from "@/components/home-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { reimaginedMoveExecutor } from "./fixtures";
import { presentUnresolvedMovement, type ExplorationMoneyState } from "./money-state";
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
 * Money Journal — direction 2 of the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * A dated journal: Today leads with a compact position line, any entry that is not finished
 * yet, and dated receipts. Money is a short statement, and the full ledger of entries is one
 * step away rather than a permanent surface.
 *
 * Navigation: Today · Money · Explore.
 */

export type MoneyJournalTab = "today" | "money" | "explore";
export type MoneyJournalScreen = "list" | "entries" | "move";

export type MoneyJournalProps = {
  initialState: ExplorationMoneyState;
  initialTab?: MoneyJournalTab;
  initialScreen?: MoneyJournalScreen;
  initialFlow?: MoveMoneyStart;
  executeMove?: MoveMoneyExecutor;
};

const journalTabs: readonly { id: MoneyJournalTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "money", label: "Money" },
  { id: "explore", label: "Explore" },
];

const journalGrammar: MoveMoneyGrammar = {
  destination: {
    title: "Which vault is this entry for?",
    description: "Pick the vault. The rate shown is whatever that vault reports.",
    continueLabel: "Continue",
  },
  amount: {
    title: "New deposit entry",
    description: "This entry moves cash you can use into the vault you picked.",
    label: "Entry amount",
    continueLabel: "Draft review",
  },
  review: {
    title: "Draft entry",
    description: "Read the entry before it is submitted. Nothing has moved yet.",
    submitLabel: (amountLabel) => `Submit ${amountLabel} entry`,
  },
  pending: {
    title: "Entry submitted",
    description: "Waiting for Base to confirm. The entry stays open until it does.",
  },
  result: {
    confirmedTitle: (amountLabel) => `Entry recorded: ${amountLabel}`,
    confirmedDescription: (destinationName) => `${destinationName} holds the deposit now.`,
    failedTitle: "The entry didn't go through",
    failedDescription: "Nothing moved, and nothing retries on its own.",
    unknownTitle: "The entry outcome is unconfirmed",
    unknownDescription: "Check Today before submitting this entry again.",
  },
  showStepRail: false,
  stepRailLabels: ["Amount", "Review", "Receipt"],
  receipt: "receipt",
  headingTag: "h2",
  backLabel: "Back",
  cancelLabel: "Cancel",
  doneLabel: "Back to journal",
  activityLabel: "Open entries",
};

export function MoneyJournal({
  initialState,
  initialTab = "today",
  initialScreen = "list",
  initialFlow,
  executeMove = reimaginedMoveExecutor("confirmed"),
}: MoneyJournalProps) {
  const money = useExplorationMoney(initialState);
  const [tab, setTab] = useState<MoneyJournalTab>(initialTab);
  const [screen, setScreen] = useState<MoneyJournalScreen>(initialScreen);
  const [flowStart, setFlowStart] = useState<MoveMoneyStart>(initialFlow ?? { step: "destination" });
  const [flowKey, setFlowKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const unresolved = presentUnresolvedMovement(money.state);

  const openTab = useCallback((next: MoneyJournalTab) => {
    setTab(next);
    setScreen("list");
    setNotice(null);
  }, []);

  const openFlow = useCallback((start: MoveMoneyStart) => {
    setFlowStart(start);
    setFlowKey((current) => current + 1);
    setScreen("move");
    setNotice(null);
  }, []);

  const retryOpenEntry = useCallback(() => {
    if (!unresolved?.vaultAddress || !unresolved.amountBaseUnits) return;
    openFlow({
      step: "amount",
      destinationId: unresolved.vaultAddress,
      amountText: amountTextFromBaseUnits(unresolved.amountBaseUnits),
    });
  }, [openFlow, unresolved]);

  const title = screen === "entries"
    ? "Entries"
    : screen === "move"
      ? "New entry"
      : tab === "money"
        ? "Money"
        : tab === "explore"
          ? "Explore"
          : "Today";

  return (
    <div
      // `100svh` for a full-screen story; a comparison frame supplies its own height so a
      // scaled board still ends exactly at its bottom navigation.
      style={{ minHeight: "var(--home-reimagined-frame-height, 100svh)" }}
      className="flex min-h-svh flex-col bg-muted"
    >
      <header className="w-full shrink-0 border-b bg-background">
        <div className={`${shellContentFrameClassName} flex min-h-14 items-center gap-2 py-2`}>
          {screen === "entries" || screen === "move" ? (
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11"
              aria-label="Back to today"
              onClick={() => {
                setScreen("list");
                setNotice(null);
              }}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <HomeMark onClick={() => openTab("today")} />
          )}
          <h1 className="min-w-0 text-base font-semibold">{title}</h1>
        </div>
        {/* Journal navigation sits directly under the title: the date is the primary surface. */}
        <div className={`${shellContentFrameClassName} flex`}>
          {journalTabs.map((entry) => (
            <Button
              key={entry.id}
              variant="navigation"
              size="lg"
              className="min-h-12 flex-1"
              aria-current={tab === entry.id && screen !== "entries" && screen !== "move" ? "page" : undefined}
              onClick={() => openTab(entry.id)}
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

          {tab === "today" && screen === "list" ? (
            <JournalToday
              money={money}
              unresolved={unresolved}
              onNewEntry={() => openFlow({ step: "destination" })}
              onOpenEntries={() => setScreen("entries")}
              onRetry={retryOpenEntry}
            />
          ) : null}

          {tab === "money" && screen === "list" ? (
            <JournalMoney
              money={money}
              onNewEntry={(vaultAddress) =>
                openFlow(
                  vaultAddress
                    ? { step: "amount", destinationId: vaultAddress }
                    : { step: "destination" },
                )
              }
            />
          ) : null}

          {tab === "explore" && screen === "list" ? (
            <JournalExplore
              onIntent={(label) => setNotice(`${label} keeps its existing Home flow in this exploration.`)}
            />
          ) : null}

          {screen === "entries" ? <JournalEntries money={money} onRetry={retryOpenEntry} /> : null}

          {screen === "move" ? (
            <MoveMoneyWorkspace
              key={flowKey}
              money={money}
              start={flowStart}
              execute={executeMove}
              onExit={() => setScreen("list")}
              onOpenActivity={() => {
                setTab("today");
                setScreen("entries");
              }}
            />
          ) : null}
        </div>
      </main>
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
      grammar={journalGrammar}
      onExit={onExit}
      onOpenActivity={onOpenActivity}
    />
  );
}

function JournalPositionLine({ money }: { money: ExplorationMoneyController }) {
  const { position } = money;
  if (position.status === "loading") {
    return (
      <div aria-busy="true" className="grid gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-36" />
        <span className="sr-only">Loading balances…</span>
      </div>
    );
  }
  const facts: ExplorationFact[] = [
    { label: "Net position", value: position.netPositionLabel ?? "Incomplete" },
    { label: "Available to use", value: position.availableLabel ?? "Unavailable" },
    { label: "Saved", value: position.savedLabel ?? "Unavailable" },
  ];
  if (position.apyLabel) facts.push({ label: "Weighted rate", value: position.apyLabel });
  return <FactList facts={facts} label="Position summary" size="compact" />;
}

function JournalToday({
  money,
  unresolved,
  onNewEntry,
  onOpenEntries,
  onRetry,
}: {
  money: ExplorationMoneyController;
  unresolved: ReturnType<typeof presentUnresolvedMovement>;
  onNewEntry: () => void;
  onOpenEntries: () => void;
  onRetry: () => void;
}) {
  const { position, activity } = money;
  const todayKey = new Date(money.state.nowMs).toISOString().slice(0, 10);
  const today = activity.groups.find((group) => group.key === todayKey);
  const earlier = activity.groups.filter((group) => group.key !== todayKey);

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent>
          <div className="grid gap-3">
            <JournalPositionLine money={money} />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button className="h-11 flex-1" onClick={onNewEntry}>
                New deposit entry
              </Button>
              <Button variant="outline" size="lg" className="h-11" onClick={onOpenEntries}>
                All entries
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {unresolved ? (
        <Card>
          <CardContent>
            <MovementNotice
              tone={unresolved.tone}
              title={`Open entry · ${unresolved.title}`}
              description={unresolved.description}
            >
              {unresolved.safeNextStep === "retry" ? (
                <Button variant="secondary" className="h-11" onClick={onRetry}>
                  Redo this entry
                </Button>
              ) : (
                <Button variant="secondary" className="h-11" onClick={onOpenEntries}>
                  Open entries
                </Button>
              )}
            </MovementNotice>
          </CardContent>
        </Card>
      ) : null}

      {position.notes.length > 0 ? (
        <MovementNotice
          title="Some balances are not counted yet"
          description={position.notes.join(" ")}
        />
      ) : null}

      <section aria-labelledby="journal-today">
        <h2 id="journal-today" className="mb-2 text-sm font-medium">
          Today · {today?.label ?? new Date(money.state.nowMs).toISOString().slice(0, 10)}
        </h2>
        <Card>
          <CardContent inset="list">
            {today && today.entries.length > 0 ? (
              <ul className="grid list-none gap-1 p-0">
                {today.entries.map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Nothing has been recorded today yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="journal-earlier">
          <h2 id="journal-earlier" className="mb-2 text-sm font-medium">
            Earlier
          </h2>
          <Card>
            <CardContent inset="list">
              <ul className="grid list-none gap-1 p-0">
                {earlier.flatMap((group) => group.entries).map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} showStatus={entry.status !== "confirmed"} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function JournalMoney({
  money,
  onNewEntry,
}: {
  money: ExplorationMoneyController;
  onNewEntry: (vaultAddress?: string) => void;
}) {
  const { position } = money;
  const facts: ExplorationFact[] = [
    { label: "Net position", value: position.netPositionLabel ?? "Incomplete" },
    { label: "Available to use", value: position.availableLabel ?? "Unavailable" },
    { label: "Saved", value: position.savedLabel ?? "Unavailable" },
    { label: "Weighted rate", value: position.apyLabel ?? "Unavailable" },
    { label: "Debt", value: position.debtSettled ? "Nothing owed" : position.debtLabel ?? "Unavailable" },
  ];
  if (position.reconciliationLabel) {
    facts.push({ label: "How it is counted", value: position.reconciliationLabel });
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent>
          <div className="grid gap-3">
            {position.status === "loading" ? (
              <LoadingFacts rows={5} />
            ) : (
              <FactList facts={facts} label="Statement facts" />
            )}
            <Button
              className="h-11 w-full"
              onClick={() => onNewEntry()}
              disabled={position.status === "loading"}
            >
              New deposit entry
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="journal-vaults">
        <h2 id="journal-vaults" className="mb-2 text-sm font-medium">
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
                    <Item size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle truncate={false}>{vault.shortName}</ItemTitle>
                        <p className="text-sm text-muted-foreground">
                          {vault.apyLabel ?? "Rate unavailable"} · {vault.funded ? `${vault.amountLabel} saved` : "Nothing saved yet"}
                        </p>
                      </ItemContent>
                      <ItemActions className="shrink-0">
                        <Button
                          variant="outline"
                          size="lg"
                          className="h-11"
                          onClick={() => onNewEntry(vault.vaultAddress)}
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

function JournalEntries({
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
        <section aria-labelledby="journal-unresolved">
          <h2 id="journal-unresolved" className="mb-2 text-sm font-medium">
            Unresolved
          </h2>
          <Card>
            <CardContent>
              <MovementNotice
                tone={unresolved.tone}
                title={unresolved.title}
                description={unresolved.description}
              >
                {unresolved.safeNextStep === "retry" ? (
                  <Button variant="secondary" className="h-11" onClick={onRetry}>
                    Redo this entry
                  </Button>
                ) : null}
              </MovementNotice>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activity.settled.length === 0 && activity.unresolved.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No entries yet. Receipts appear here the moment a transfer or deposit happens.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {activity.groups.map((group) => (
        <section key={group.key} aria-labelledby={`journal-group-${group.key}`}>
          <h2
            id={`journal-group-${group.key}`}
            className="mb-2 text-sm font-medium"
          >
            {group.label}
          </h2>
          <Card>
            <CardContent inset="list">
              <ul className="grid list-none gap-1 p-0">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <ActivityEntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}

function JournalExplore({ onIntent }: { onIntent: (label: string) => void }) {
  return (
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
  );
}

export { MoneyValue };
