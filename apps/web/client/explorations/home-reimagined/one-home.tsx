"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { HomeMark } from "@/components/home-mark";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
  ChapterHeading,
  FactList,
  LoadingFacts,
  MoneyValue,
  MovementNotice,
} from "./parts";

/**
 * One Home — direction 4 of the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * A single scroll of financial chapters with a Jump-to index, and no persistent product
 * tabs. Each chapter carries its own contextual action, Activity is a chapter rather than a
 * destination, and moving money is a deliberate takeover of the page.
 */

export type OneHomeView = "chapters" | "move";

export type OneHomeProps = {
  initialState: ExplorationMoneyState;
  initialView?: OneHomeView;
  /**
   * Review affordance for the single-scroll page: starts the page on the named chapter
   * without changing document order. Jump links do the same thing, natively.
   */
  initialChapterId?: string;
  initialFlow?: MoveMoneyStart;
  executeMove?: MoveMoneyExecutor;
};

const oneHomeChapters: readonly { id: string; label: string }[] = [
  { id: "one-home-position", label: "Position" },
  { id: "one-home-move", label: "Move" },
  { id: "one-home-saved", label: "Saved" },
  { id: "one-home-activity", label: "Activity" },
  { id: "one-home-more", label: "More" },
];

const oneHomeGrammar: MoveMoneyGrammar = {
  destination: {
    title: "Where should this go?",
    description: "You choose the vault. Nothing is picked for you.",
    continueLabel: "Continue",
  },
  amount: {
    title: "How much?",
    description: "This comes out of available cash.",
    label: "Amount",
    continueLabel: "Review",
  },
  review: {
    title: "Review",
    description: "Exact facts for this deposit.",
    submitLabel: (amountLabel) => `Deposit ${amountLabel}`,
  },
  pending: {
    title: "Deposit submitted",
    description: "Waiting for Base to confirm. Nothing has moved yet.",
  },
  result: {
    confirmedTitle: (amountLabel) => `Deposited ${amountLabel}`,
    confirmedDescription: (destinationName) => `Saved in ${destinationName}.`,
    failedTitle: "The deposit didn't go through",
    failedDescription: "No money moved. Nothing retries on its own.",
    unknownTitle: "We couldn't confirm this deposit",
    unknownDescription: "Check the Activity chapter before sending anything again.",
  },
  showStepRail: false,
  stepRailLabels: ["Amount", "Review", "Result"],
  receipt: "panel",
  headingTag: "h2",
  backLabel: "Back",
  cancelLabel: "Cancel",
  doneLabel: "Back to home",
  activityLabel: "Go to Activity",
};

export function OneHome({
  initialState,
  initialView = "chapters",
  initialChapterId,
  initialFlow,
  executeMove = reimaginedMoveExecutor("confirmed"),
}: OneHomeProps) {
  const money = useExplorationMoney(initialState);
  const { position, activity } = money;
  const [view, setView] = useState<OneHomeView>(initialView);
  const [flowStart, setFlowStart] = useState<MoveMoneyStart>(initialFlow ?? { step: "destination" });
  const [flowKey, setFlowKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const unresolved = presentUnresolvedMovement(money.state);
  const returningFocus = useRef(false);

  const openFlow = useCallback((start: MoveMoneyStart) => {
    setFlowStart(start);
    setFlowKey((current) => current + 1);
    setView("move");
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!initialChapterId) return;
    const chapter = document.getElementById(initialChapterId);
    if (chapter && typeof chapter.scrollIntoView === "function") {
      chapter.scrollIntoView({ block: "start" });
    }
  }, [initialChapterId]);

  // Returning from the takeover puts focus back on the chapter the person left from.
  useEffect(() => {
    if (view !== "chapters" || !returningFocus.current) return;
    returningFocus.current = false;
    document.getElementById("one-home-move-title")?.focus();
  }, [view]);

  const startMove = useCallback((vaultAddress?: string) => {
    openFlow(vaultAddress ? { step: "amount", destinationId: vaultAddress } : { step: "destination" });
  }, [openFlow]);

  return (
    <div
      // `100svh` for a full-screen story; a comparison frame supplies its own height so a
      // scaled board still ends exactly at its bottom navigation.
      style={{ minHeight: "var(--home-reimagined-frame-height, 100svh)" }}
      className="flex min-h-svh flex-col bg-muted"
    >
      <header className="w-full shrink-0 border-b bg-background">
        <div className={`${shellContentFrameClassName} flex min-h-14 items-center gap-2 py-2`}>
          {view === "move" ? (
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11"
              aria-label="Back to home chapters"
              onClick={() => {
                returningFocus.current = true;
                setView("chapters");
              }}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <HomeMark onClick={() => setView("chapters")} />
          )}
          <h1 className="min-w-0 text-base font-semibold">
            {view === "move" ? "Move money" : "Home"}
          </h1>
        </div>
      </header>

      <main className="min-h-0 flex-1 bg-muted pb-4">
        <div className={`${shellContentFrameClassName} py-4`}>
          {notice ? (
            <MovementNotice title="Not part of this exploration" description={notice} />
          ) : null}

          {view === "move" ? (
            <MoveMoneyWorkspace
              key={flowKey}
              money={money}
              start={flowStart}
              execute={executeMove}
              onExit={() => setView("chapters")}
            />
          ) : (
            <div className="grid gap-4">
              <nav aria-label="Jump to chapter" className="flex flex-wrap gap-2">
                {oneHomeChapters.map((chapter) => (
                  <a
                    key={chapter.id}
                    href={`#${chapter.id}`}
                    className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {chapter.label}
                  </a>
                ))}
              </nav>

              {unresolved ? (
                <MovementNotice
                  tone={unresolved.tone}
                  title={unresolved.title}
                  description={unresolved.description}
                >
                  {unresolved.safeNextStep === "retry" && unresolved.vaultAddress ? (
                    <Button
                      variant="secondary"
                      className="h-11"
                      onClick={() =>
                        openFlow({
                          step: "amount",
                          destinationId: unresolved.vaultAddress ?? "",
                          amountText: unresolved.amountBaseUnits
                            ? amountTextFromBaseUnits(unresolved.amountBaseUnits)
                            : "",
                        })
                      }
                    >
                      Do it again
                    </Button>
                  ) : (
                    <a
                      href="#one-home-activity"
                      className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      Go to Activity
                    </a>
                  )}
                </MovementNotice>
              ) : null}

              <section
                id="one-home-position"
                aria-labelledby="one-home-position-title"
                className="scroll-mt-4"
              >
                <Card>
                  <CardContent inset="hero">
                    <div className="grid gap-4">
                      <ChapterHeading id="one-home-position-title">Position</ChapterHeading>
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
                      </div>
                      {position.status === "loading" ? (
                        <LoadingFacts rows={3} />
                      ) : (
                        <FactList
                          label="Position facts"
                          facts={[
                            { label: "Available to use", value: position.availableLabel ?? "Unavailable" },
                            { label: "Saved", value: position.savedLabel ?? "Unavailable" },
                            ...(position.apyLabel
                              ? [{ label: "Weighted rate", value: position.apyLabel }]
                              : []),
                            ...(position.debtLabel
                              ? [{ label: "Debt", value: position.debtLabel }]
                              : []),
                          ]}
                        />
                      )}
                      <Button className="h-11 w-full" onClick={() => startMove()}>
                        Move money
                      </Button>
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

              <section
                id="one-home-move"
                aria-labelledby="one-home-move-title"
                className="scroll-mt-4"
              >
                <Card>
                  <CardContent inset="hero">
                    <div className="grid gap-3">
                      <ChapterHeading id="one-home-move-title" tabIndex={-1}>
                        Move
                      </ChapterHeading>
                      <p className="text-sm text-muted-foreground">
                        {position.status === "loading"
                          ? "Loading available to use and saved balances."
                          : position.availableLabel
                            ? `${position.availableLabel} is available to use. It moves out of cash and into the vault you choose.`
                            : "Available to use is unavailable right now, so a deposit cannot be priced."}
                      </p>
                      <Button
                        className="h-11 w-full"
                        onClick={() => startMove()}
                        disabled={position.status === "loading"}
                      >
                        Start a deposit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section
                id="one-home-saved"
                aria-labelledby="one-home-saved-title"
                className="scroll-mt-4"
              >
                <Card>
                  <CardContent inset="hero">
                    <div className="grid gap-3">
                      <ChapterHeading id="one-home-saved-title">Saved</ChapterHeading>
                      {position.status === "loading" ? (
                        <LoadingFacts rows={2} />
                      ) : (
                        <FactList
                          label="Saved facts"
                          facts={[
                            { label: "Saved", value: position.savedLabel ?? "Unavailable" },
                            { label: "Weighted rate", value: position.apyLabel ?? "Unavailable" },
                          ]}
                        />
                      )}
                      <Separator />
                      <ul className="grid list-none gap-1 p-0">
                        {position.status === "loading" ? (
                          <li>
                            <LoadingFacts rows={2} />
                          </li>
                        ) : position.vaults.length === 0 ? (
                          <li className="text-sm text-muted-foreground">
                            Vault balances are unavailable right now.
                          </li>
                        ) : (
                          position.vaults.map((vault) => (
                            <li key={vault.vaultAddress}>
                              <Item size="sm">
                                <ItemContent className="min-w-0">
                                  <ItemTitle truncate={false}>{vault.name}</ItemTitle>
                                  <p className="text-sm text-muted-foreground">
                                    {vault.apyLabel ?? "Rate unavailable"} ·{" "}
                                    {vault.funded ? `${vault.amountLabel} saved` : "Nothing saved yet"}
                                  </p>
                                </ItemContent>
                                <ItemActions className="shrink-0">
                                  <Button
                                    variant="outline"
                                    size="lg"
                                    className="h-11"
                                    onClick={() => startMove(vault.vaultAddress)}
                                  >
                                    Move here
                                  </Button>
                                </ItemActions>
                              </Item>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section
                id="one-home-activity"
                aria-labelledby="one-home-activity-title"
                className="scroll-mt-4"
              >
                <Card>
                  <CardContent inset="hero">
                    <div className="grid gap-3">
                      <ChapterHeading id="one-home-activity-title">Activity</ChapterHeading>
                      {activity.entries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nothing has happened yet. Transfers and deposits appear here.
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
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section
                id="one-home-more"
                aria-labelledby="one-home-more-title"
                className="scroll-mt-4"
              >
                <Card>
                  <CardContent inset="hero">
                    <div className="grid gap-2">
                      <ChapterHeading id="one-home-more-title">More</ChapterHeading>
                      <ul className="grid list-none gap-1 p-0">
                        {["Add money", "Send or receive", "Borrow", "Invest"].map((label) => (
                          <li key={label}>
                            <Item
                              render={<Button variant="ghost" />}
                              className="min-h-14 flex-nowrap justify-start text-left"
                              onClick={() =>
                                setNotice(`${label} keeps its existing Home flow in this exploration.`)
                              }
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
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          )}
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
}: {
  money: ExplorationMoneyController;
  start: MoveMoneyStart;
  execute: MoveMoneyExecutor;
  onExit: () => void;
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
      grammar={oneHomeGrammar}
      onExit={onExit}
      onOpenActivity={onExit}
    />
  );
}
