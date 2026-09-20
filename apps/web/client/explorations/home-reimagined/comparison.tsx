"use client";

import type { CSSProperties, ReactNode } from "react";
import { reimaginedFundedState } from "./fixtures";
import type { ExplorationMoneyState } from "./money-state";
import { MoneyDesk } from "./money-desk";
import { MoneyJournal } from "./money-journal";
import { MoneyMap } from "./money-map";
import { OneHome } from "./one-home";

/**
 * Side-by-side comparison board for the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * All four directions render the same fixture state — the same clock, cash, vaults, rates,
 * debt, and history — so a reviewer compares information architecture, navigation,
 * hierarchy, density, action model, and tone rather than different numbers.
 */

type ComparisonBoard = {
  id: string;
  label: string;
  navigation: string;
  actionModel: string;
  render: () => ReactNode;
};

const BOARD_WIDTH = 390;
const BOARD_HEIGHT = 844;
/**
 * The board shows four complete 390×844 compositions at once. A 0.72 scale keeps two
 * boards per row on narrow screens and all four on one row at 1280, with each frame's
 * height inside an 800px viewport, so no direction is cut off and the bottom navigation of
 * the tab-based homes stays visible. Full-size review happens in each home's own story.
 */
const BOARD_SCALE = 0.72;
const FRAME_HEIGHT_CSS_VARIABLE = "--home-reimagined-frame-height";

export function HomeReimaginedComparison({
  initialState = reimaginedFundedState(),
}: {
  initialState?: ExplorationMoneyState;
}) {
  const boards: readonly ComparisonBoard[] = [
    {
      id: "money-map",
      label: "Money Map",
      navigation: "Money · Activity · Explore",
      actionModel: "Position directory, then a detail per position",
      render: () => <MoneyMap initialState={initialState} />,
    },
    {
      id: "money-journal",
      label: "Money Journal",
      navigation: "Today · Money · Explore",
      actionModel: "Dated receipts; the ledger is one step away",
      render: () => <MoneyJournal initialState={initialState} />,
    },
    {
      id: "money-desk",
      label: "Money Desk",
      navigation: "Move · Money · Activity",
      actionModel: "Task-first workspace with a visible step rail",
      render: () => <MoneyDesk initialState={initialState} />,
    },
    {
      id: "one-home",
      label: "One Home",
      navigation: "Jump-to chapter index, no persistent tabs",
      actionModel: "One scroll; each chapter carries its own action",
      render: () => <OneHome initialState={initialState} />,
    },
  ];

  return (
    <main className="min-h-svh bg-muted p-4">
      <header className="mb-4 grid gap-1">
        <h1 id="comparison-title" className="text-lg font-semibold">
          Four homes, one set of facts
        </h1>
        <p className="text-sm">
          Cash $250.00 · Saved $1,000.00 · Net position $1,250.00 · 4.04% weighted rate · no
          debt · received $250.00, received $1,000.00, deposited $1,000.00 · clock Sep 19, 2026
          12:04 UTC.
        </p>
        <p className="text-xs">
          Each board is the full 390×844 composition at 0.72 scale so all four fit together;
          open a home&rsquo;s own story for full-size review.
        </p>
      </header>
      <section aria-labelledby="comparison-title" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {boards.map((board) => (
          <section
            key={board.id}
            aria-labelledby={`comparison-${board.id}-label`}
            className="flex flex-col gap-2"
          >
            <div className="grid gap-0.5">
              <h2 id={`comparison-${board.id}-label`} className="text-sm font-semibold">
                {board.label}
              </h2>
              <p className="text-xs">{board.navigation}</p>
              <p className="text-xs">{board.actionModel}</p>
            </div>
            {/* Inline sizing keeps each board on the real device composition without
                arbitrary classes, and `inert` keeps four complete shells from publishing
                duplicate landmarks and four competing h1 headings to assistive technology.
                Each home has its own reviewable story for the accessible tree. */}
            <div
              inert
              className="overflow-hidden rounded-xl border bg-background"
              style={{ width: BOARD_WIDTH * BOARD_SCALE, height: BOARD_HEIGHT * BOARD_SCALE }}
            >
              <div
                style={{
                  width: BOARD_WIDTH,
                  height: BOARD_HEIGHT,
                  transform: `scale(${BOARD_SCALE})`,
                  transformOrigin: "top left",
                  ...({ [FRAME_HEIGHT_CSS_VARIABLE]: `${BOARD_HEIGHT}px` } as CSSProperties),
                }}
              >
                {board.render()}
              </div>
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
