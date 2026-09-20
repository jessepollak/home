import type { ReactNode } from "react";
import { reimaginedFundedState } from "./fixtures";
import { MoneyMap } from "./money-map";
import { ReferenceHome } from "./reference-home";
import styles from "./reference-home.module.css";

const revision = "11c8ee815d9e71caed1016370a76430cd9bd21ae";
const sourceUrl = `https://github.com/jessepollak/home/blob/${revision}/apps/web/client/home/home-panel.tsx`;

function Board({ title, provenance, children }: { title: string; provenance: string; children: ReactNode }) {
  return (
    <section className="w-fit shrink-0">
      <header className="mb-4 h-32 max-w-sm space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="min-h-16 text-xs leading-relaxed text-muted-foreground">{provenance}</p>
      </header>
      <div className={`${styles.board} border bg-background`}>{children}</div>
    </section>
  );
}

/** Review evidence only. External reference imagery never enters ReferenceHome. */
export function ReferenceComparison() {
  return (
    <main className="min-h-svh bg-muted p-6 text-foreground">
      <header className="mb-6 max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold">Astra · reference-led Home</h1>
        <p className="text-sm">Unscaled 390×844 frames. Scroll horizontally to compare; open Funded Home for the interactive composition.</p>
        <p className="text-xs text-muted-foreground">Both proposals use fixtures.ts: cash $250 · Save $1,000 · net $1,250 · combined 4.04% APY · no debt. Fixed Sep 19, 2026, 12:04 UTC. History: received 250 USDC, sent 1,000 USDC, received 1,000 USDC; the outgoing transfer is not attributed to a vault.</p>
      </header>
      <div className="flex gap-6 overflow-x-auto pb-6">
        <Board title="Current production · source reference" provenance={`HomePanel at ${revision.slice(0, 7)}. This is a source inventory, NOT a screenshot or a simulated production render. No fixture balances are substituted.`}>
          <article className="space-y-6 p-6">
            <h3 className="text-lg font-semibold">Production source, not pixels</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">HomePanel’s children require account-wallet context and live savings / borrow queries. There is no deterministic funded Home story. Rather than reproduce it inaccurately, this panel links to the exact current source.</p>
            <a className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4" href={sourceUrl} target="_blank" rel="noreferrer">Inspect pinned HomePanel source ↗</a>
            <ol className="space-y-5 border-t pt-5 text-sm">
              <li><strong>Total balance</strong><p className="mt-1 text-muted-foreground">Card, text-4xl MoneyTicker, allocation bar and category amounts.</p></li>
              <li><strong>Money actions</strong><p className="mt-1 text-muted-foreground">FundingActions + TransferActions, two-column grid.</p></li>
              <li><strong>Your money</strong><p className="mt-1 text-muted-foreground">HomeMoneyGroups inside a Card.</p></li>
              <li><strong>Save + Borrow</strong><p className="mt-1 text-muted-foreground">Two square teaser Cards; connected account data.</p></li>
              <li><strong>Activity</strong><p className="mt-1 text-muted-foreground">ConnectedActivityPanel, teaser density.</p></li>
            </ol>
            <p className="border-t pt-5 text-xs leading-relaxed text-muted-foreground">Limitation: this column supports structural review only, not a pixel comparison with production. A genuine deterministic production capture remains a follow-up evidence requirement.</p>
          </article>
        </Board>
        <Board title="Previous proposal · #675 Money Map" provenance="Live archived exploration with the same funded fixture. Not production and not PR #661. PR #661’s actual Overview screenshot was separately inspected before this pass.">
          <div inert><MoneyMap initialState={reimaginedFundedState()} /></div>
        </Board>
        <Board title="New proposal · Astra" provenance="Live funded fixture, exact 390px composition. Unboxed hierarchy; Fund → Save → Invest (Buy + Sell) → Borrow. Open the dedicated story for accessible interaction.">
          <div inert><ReferenceHome initialState={reimaginedFundedState()} /></div>
        </Board>
        <Board title="Mercury · official promotional reference" provenance="Actual supplied Mercury promotional image, 600×1067, shown at 390px on a dark backing for its transparency. © Mercury. External reference only; not Home UI, Home data, or an endorsement.">
          {/* This Storybook-only static reference is deliberately a plain image, not an app asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/references/mercury-official-promotional.png" width={390} height={694} className="block h-auto w-full bg-foreground" alt="Official Mercury promotional mobile screenshot: dark canvas, an unboxed balance, balance chart and restrained section dividers. External reference, not Home." />
        </Board>
      </div>
    </main>
  );
}
