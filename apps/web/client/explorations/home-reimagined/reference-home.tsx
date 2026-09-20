"use client";

import { useId, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, House, List, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { reimaginedFundedState } from "./fixtures";
import { presentExplorationActivity, presentExplorationPosition, type ExplorationMoneyState } from "./money-state";
import styles from "./reference-home.module.css";

type Entry = "Fund" | "Save" | "Buy" | "Sell" | "Borrow" | "Account";

const handoff: Record<Entry, string> = {
  Fund: "This entry would open Home’s existing funding modal. Funding methods and live money movement are not connected in this composition.",
  Save: "This entry would open Home’s existing Save experience. This pass explores Home only, not a new Save screen.",
  Buy: "This entry would open Home’s existing Buy modal. No quote, order, or trade is created here.",
  Sell: "This entry would open Home’s existing Sell modal. No quote, order, or trade is created here.",
  Borrow: "This entry would open Home’s existing Borrow experience. The fixture has no debt; no borrowing eligibility is implied.",
  Account: "Account settings are not connected in this fixture-only Home composition.",
};

/** Astra: one funded Home composition, isolated from wallet/provider and production routes. */
export function ReferenceHome({ initialState = reimaginedFundedState() }: { initialState?: ExplorationMoneyState }) {
  const position = presentExplorationPosition(initialState);
  const activity = presentExplorationActivity(initialState);
  const [entry, setEntry] = useState<Entry>("Fund");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activitySelected, setActivitySelected] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const net = position.netPositionLabel ?? "Unavailable";

  function openEntry(next: Entry) {
    setEntry(next);
    setPreviewOpen(true);
  }

  function goHome() {
    setActivitySelected(false);
    root.current?.scrollIntoView({ block: "start" });
  }

  function goActivity() {
    setActivitySelected(true);
    activityHeading.current?.focus({ preventScroll: true });
    activityHeading.current?.scrollIntoView({ block: "center" });
  }

  return (
    <div ref={root} className={`${styles.home} bg-background text-foreground`}>
      <header className="flex h-16 shrink-0 items-center justify-between pl-6 pr-4">
        <h1 className="text-base font-semibold">Home</h1>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Account" onClick={() => openEntry("Account")}>
          <UserRound className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <main className="flex-1 px-6">
        <section aria-labelledby={`${id}-net`} className="pb-6 pt-6">
          <h2 id={`${id}-net`} className="text-sm text-muted-foreground">Net position</h2>
          <p className={`${net.length > 12 ? styles.largeAmount : styles.balance} mt-2 font-medium tracking-tight tabular-nums`}>
            {net}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Cash + savings · {position.debtSettled ? "No debt" : position.debtLabel ? `${position.debtLabel} owed` : "Debt unavailable"}</p>
        </section>

        <section aria-label="Available cash and funding" className="flex items-center justify-between gap-3 pb-6">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Available cash</h2>
            <p className={`${styles.secondaryAmount} mt-1 text-2xl font-medium tabular-nums`}>{position.availableLabel}</p>
          </div>
          <Button className="h-12 min-w-28" onClick={() => openEntry("Fund")}>
            <Plus className="size-4" aria-hidden="true" /> Fund
          </Button>
        </section>

        <section aria-label="Save" className="border-y">
          <Button variant="ghost" size="inline" className="h-auto w-full text-left" onClick={() => openEntry("Save")}>
            <span className="flex w-full items-center justify-between gap-3 py-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Save</span>
                <span className={`${styles.secondaryAmount} mt-1 block text-2xl font-medium tabular-nums`}>{position.savedLabel}</span>
                <span className="mt-1 block text-sm text-muted-foreground">Combined {position.apyLabel}</span>
              </span>
              <span className="flex size-11 shrink-0 items-center justify-center">
                <ChevronRight className="size-5" aria-hidden="true" />
              </span>
            </span>
          </Button>
        </section>

        <section aria-labelledby={`${id}-invest`} className="flex min-h-16 items-center justify-between gap-3">
          <h2 id={`${id}-invest`} className="text-sm font-medium">Invest</h2>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-11 min-w-16" onClick={() => openEntry("Buy")}>Buy</Button>
            <Button variant="secondary" className="h-11 min-w-16" onClick={() => openEntry("Sell")}>Sell</Button>
          </div>
        </section>
        <section aria-label="Borrow" className="border-b pb-2">
          <Button variant="ghost" size="inline" className="h-auto w-full text-left" onClick={() => openEntry("Borrow")}>
            <span className="flex w-full items-center justify-between gap-3">
              <span className="text-sm font-medium">Borrow</span>
              <span className="flex size-11 shrink-0 items-center justify-center">
                <ChevronRight className="size-5" aria-hidden="true" />
              </span>
            </span>
          </Button>
        </section>

        <section aria-labelledby={`${id}-activity`} className="pb-3 pt-6">
          <h2 ref={activityHeading} tabIndex={-1} id={`${id}-activity`} className="w-fit text-sm font-semibold outline-offset-4">Activity</h2>
          <ol className="mt-2">
            {activity.entries.map((item) => (
              <li key={item.id} className="flex min-h-14 items-center gap-3 py-2" aria-label={`${item.title}, ${item.amountLabel}, ${item.dateLabel}, ${item.detail}`}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                  {item.title.startsWith("Received") ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.groupLabel}</p>
                </div>
                <p className={`${styles.activityAmount} text-right text-sm tabular-nums`}>{item.amountLabel}</p>
              </li>
            ))}
          </ol>
        </section>
        {position.notes.length > 0 && <ul className="mb-6 space-y-2 text-xs text-muted-foreground">{position.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      </main>

      <nav aria-label="Home navigation" className="sticky bottom-0 grid shrink-0 grid-cols-2 border-t bg-background px-6 pb-2 pt-1">
        <Button variant="navigation" className="h-14 flex-col" aria-current={!activitySelected ? "page" : undefined} onClick={goHome}>
          <House className="size-5" aria-hidden="true" /><span className="text-xs">Home</span>
        </Button>
        <Button variant="navigation" className="h-14 flex-col" aria-current={activitySelected ? "page" : undefined} onClick={goActivity}>
          <List className="size-5" aria-hidden="true" /><span className="text-xs">Activity</span>
        </Button>
      </nav>

      <Drawer open={previewOpen} onOpenChange={setPreviewOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{entry} · composition preview</DrawerTitle>
            <DrawerDescription>{handoff[entry]} Fixture only. No money moves.</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button className="h-12" onClick={() => setPreviewOpen(false)}>Back to Home</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
