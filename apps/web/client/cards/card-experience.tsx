"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, CreditCard, Eye, Lock } from "lucide-react";
import { useAccountWallet } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { ShimmerRows } from "@/client/home/panel-shared";
import { useHomeToast } from "@/client/home/use-home-toast";
import { MoneyModal, MoneyModalBody, MoneyModalHeader, MoneyModalStep } from "@/client/money-modal";
import { reportClientError } from "@/client/observability/client-reporter";
import { LoadErrorCard } from "@/components/load-error";
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { StatusStep, StatusSteps, type StepStatus } from "@/components/ui/status-step";
import { Switch } from "@/components/ui/switch";
import type { CardsResponse } from "@/shared/cards/contract";
import { CardDetailsReveal, stripePublishableKey } from "./card-reveal";
import { CardRefreshError, useCards, type CardCommands } from "./use-cards";
import { CardSpending, cardSpendingData, type CardSpendingCommands, type CardSpendingData } from "./card-spending";
import { useCardSpending } from "./use-card-spending";

type IssuedCard = CardsResponse["cards"][number];
type Pending = "enroll" | "issue" | "lock" | null;
type PendingRun = { kind: Exclude<Pending, null>; generation: number };
type Settled = (() => void) | void;
type CardReveal = { publishableKey: string; revealKey: CardCommands["revealKey"] };

export type CardScreenData =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; response: CardsResponse };

export type CardScreenProps = {
  cards: CardScreenData;
  commands: Pick<CardCommands, "enroll" | "issue" | "setFrozen">;
  onRetry: () => void;
  onOpenVerification: (url: string) => void;
  reveal?: CardReveal;
  ownerBoundary?: string | null;
  spending?: CardSpendingData;
  spendingCommands?: CardSpendingCommands;
  onSpendingRetry?: () => void;
};

function CardArt({ last4, locked, position }: { last4: string; locked: boolean; position?: number }) {
  return (
    <div
      role="img"
      aria-label={`Virtual card${position ? ` ${position}` : ""} ending ${last4}${locked ? ", locked" : ""}`}
      className={`relative flex h-44 w-70 max-w-full shrink-0 flex-col justify-between rounded-lg border p-4 ${
        locked ? "border-border bg-muted text-foreground/75" : "border-foreground bg-foreground text-background"}`}
    >
      <div className="flex items-start justify-between gap-2">
        {locked ? null : <span className="size-3 rounded-sm bg-primary" />}
        <span className="ml-auto text-xs">Virtual</span>
      </div>
      {locked ? (
        <Badge variant="secondary" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Lock aria-hidden="true" />Locked
        </Badge>
      ) : null}
      <span className="font-mono text-sm">•••• {last4}</span>
    </div>
  );
}

const verificationSteps: Record<"verification-required" | "verification-pending" | "ready-to-issue", readonly StepStatus[]> = {
  "verification-required": ["complete", "current", "upcoming", "upcoming"],
  "verification-pending": ["complete", "complete", "current", "upcoming"],
  "ready-to-issue": ["complete", "complete", "complete", "current"],
};

function CardProgress({ state, action }: {
  state: keyof typeof verificationSteps;
  action?: { label: string; pending: boolean; onClick: () => void };
}) {
  const steps = verificationSteps[state];
  return (
    <section className="space-y-4" aria-labelledby="card-progress-title">
      <div className="px-4"><HomeSectionHeading id="card-progress-title">Getting your card</HomeSectionHeading></div>
      <StatusSteps>
        {(["Card requested", "Verify your identity", "Checking your details", "Card ready"] as const).map((title, index) => (
          <StatusStep key={title} title={title} status={steps[index] ?? "upcoming"} />
        ))}
      </StatusSteps>
      {action ? (
        <Button size="touch" className="w-full" loading={action.pending} disabled={action.pending} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}

function CardNotice({ title, action }: { title: string; action?: { label: string; pending: boolean; onClick: () => void } }) {
  return (
    <Card>
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><CreditCard aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
          </EmptyHeader>
          {action ? (
            <EmptyContent>
              <Button size="touch" loading={action.pending} disabled={action.pending} onClick={action.onClick}>{action.label}</Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </CardContent>
    </Card>
  );
}

function LockRow({ card, restricted, pending, switchLabel, onChange }: {
  card: IssuedCard;
  restricted: boolean;
  pending: boolean;
  switchLabel: string;
  onChange: (locked: boolean) => void;
}) {
  const locked = card.status !== "active";
  const unlockBlocked = locked && (restricted || card.status === "restricted");
  return (
    <Item className="min-w-0 flex-nowrap items-center">
      <ItemMedia variant="avatar" aria-hidden="true"><Lock /></ItemMedia>
      <ItemContent className="min-w-0 flex-1">
        <ItemTitle>Lock card</ItemTitle>
        <ItemDescription lines={1}>
          {unlockBlocked ? "Can't unlock while on hold" : locked ? "New purchases are declined" : "Pause new purchases"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={switchLabel}
          checked={locked}
          disabled={pending || unlockBlocked}
          onCheckedChange={onChange}
        />
      </ItemActions>
    </Item>
  );
}

function HoldAlert({ description }: { description: string }) {
  return (
    <Alert>
      <AlertIcon><CircleAlert /></AlertIcon>
      <AlertTitle>Your card is on hold</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

function IssuedCardOverview({ card, position, restricted, showHold, single, pending, onLock, reveal }: {
  card: IssuedCard;
  restricted: boolean;
  showHold: boolean;
  position?: number;
  single: boolean;
  pending: boolean;
  onLock: (locked: boolean) => void;
  reveal?: CardReveal;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOpener, setDetailsOpener] = useState<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const locked = card.status !== "active";
  const titleId = useId();
  const headingId = useId();
  const suffix = single ? "" : `${position ? ` ${position}` : ""} ending ${card.last4}`;
  const detailsSuffix = single ? "" : position ? ` for card ${position} ending ${card.last4}` : suffix;
  const canReveal = reveal !== undefined && !restricted && (card.status === "active" || card.status === "frozen");
  return (
    <>
      <Card variant="flush">
        <CardContent inset="hero">
          <div className="flex justify-center"><CardArt last4={card.last4} locked={locked} position={position} /></div>
        </CardContent>
      </Card>
      {showHold ? <HoldAlert description="New purchases are declined." /> : null}
      {canReveal ? (
        <Button size="touch" variant="outline" className="w-full" aria-label={single ? undefined : `Card details${detailsSuffix}`}
          onClick={(event) => { setDetailsOpener(event.currentTarget); setRevealed(true); setDetailsOpen(true); }}>
          <Eye data-icon="inline-start" aria-hidden="true" />Card details
        </Button>
      ) : null}
      <section aria-labelledby={headingId}>
        <Card className="gap-3">
          <CardHeader><HomeSectionHeading id={headingId}>{single ? "Your card" : `Card${suffix}`}</HomeSectionHeading></CardHeader>
          <CardContent inset="list">
            <LockRow card={card} restricted={restricted} pending={pending} switchLabel={`Lock card${suffix}`} onChange={onLock} />
          </CardContent>
        </Card>
      </section>
      {reveal && canReveal ? (
        <MoneyModal open={detailsOpen} opener={detailsOpener} labelledBy={titleId} onCancel={() => setDetailsOpen(false)} onClose={() => setRevealed(false)}>
          <MoneyModalStep step="details">
            <MoneyModalHeader title={`Card details${detailsSuffix}`} titleId={titleId} closeLabel="Close card details" />
            <MoneyModalBody className="gap-3 pt-4">
              {revealed ? <CardDetailsReveal cardId={card.id} publishableKey={reveal.publishableKey} revealKey={reveal.revealKey} /> : null}
            </MoneyModalBody>
          </MoneyModalStep>
        </MoneyModal>
      ) : null}
    </>
  );
}

export function CardScreen({ cards, commands, onRetry, onOpenVerification, reveal, ownerBoundary = null, spending, spendingCommands, onSpendingRetry }: CardScreenProps) {
  const [session, setSession] = useState({ boundary: ownerBoundary, generation: 0 });
  if (session.boundary !== ownerBoundary) setSession({ boundary: ownerBoundary, generation: session.generation + 1 });
  const { generation } = session;
  const [running, setRunning] = useState<PendingRun | null>(null);
  const pending: Pending = running && running.generation === generation ? running.kind : null;
  const currentGeneration = useRef(generation);
  useLayoutEffect(() => { currentGeneration.current = generation; }, [generation]);
  const { add } = useHomeToast(ownerBoundary);

  async function run(kind: Exclude<Pending, null>, work: () => Promise<Settled>, failure: string) {
    if (pending) return;
    const started: PendingRun = { kind, generation };
    const sameSession = () => currentGeneration.current === started.generation;
    setRunning(started);
    try {
      const settled = await work();
      if (sameSession()) settled?.();
    } catch (error) {
      if (sameSession()) add({ message: error instanceof CardRefreshError ? "Couldn't refresh your card. Try again." : failure, tone: "error", role: "alert" });
      void reportClientError({
        name: error instanceof Error ? error.name : "Error",
        message: `Card ${kind} failed`,
        route: window.location.pathname,
      });
    } finally {
      setRunning((value) => value === started ? null : value);
    }
  }

  const enroll = () => void run("enroll", async () => {
    const url = await commands.enroll();
    return () => onOpenVerification(url);
  }, "Couldn't start verification. Try again.");
  const issue = (failure: string) => void run("issue", commands.issue, failure);

  const state = cards.status === "ready" ? cards.response.state : null;
  const issued = state === "active" || state === "frozen" || state === "restricted";
  const live = cards.status === "ready" ? cards.response.cards.filter((item) => item.status !== "canceled").reverse() : [];
  const spendingSection = <CardSpending key={generation} spending={spending ?? { status: "loading" }}
    visible={Boolean(spending) && state !== null && state !== "unavailable"} variant={issued && live.length > 0 ? "full" : "revoke-only"}
    canSet={state === "active" || state === "frozen"} commands={spendingCommands} onRefresh={onSpendingRetry} />;

  if (cards.status === "loading") {
    return (
      <div className="space-y-4">
        <section className="space-y-4" aria-busy="true" aria-label="Loading card">
          <Card variant="flush"><CardContent inset="hero"><ShimmerRows variant="hero" /></CardContent></Card>
          <ShimmerRows count={2} />
        </section>
        {spendingSection}
      </div>
    );
  }
  if (cards.status === "failed" || cards.response.state === "unavailable") {
    return <div className="space-y-4"><LoadErrorCard title="Card is unavailable right now" onRetry={onRetry} />{spendingSection}</div>;
  }
  const single = live.length === 1;
  const sharesLast4 = (last4: string) => live.filter((item) => item.last4 === last4).length > 1;
  return (
    <div className="space-y-4">
      {state === "not-enrolled" ? (
        <FeatureIntro
          headline="Spend your Cash with a card"
          illustration="card"
          benefits={[
            { icon: CreditCard, text: "Spend online anywhere cards work" },
            { icon: Lock, text: "Lock it anytime" },
          ]}
          primary={{ label: "Get your card", pending: pending === "enroll", disabled: pending !== null, onClick: enroll }}
        />
      ) : null}
      {state === "verification-required" ? (
        <CardProgress state={state} action={{ label: "Verify", pending: pending === "enroll", onClick: enroll }} />
      ) : null}
      {state === "verification-pending" ? <CardProgress state={state} /> : null}
      {state === "ready-to-issue" ? (
        <CardProgress state={state} action={{
          label: "Create your card", pending: pending === "issue", onClick: () => issue("Couldn't create your card. Try again."),
        }} />
      ) : null}
      {state === "ineligible" ? <CardNotice title="Card isn't available for your account" /> : null}
      {state === "canceled" ? (
        <CardNotice title="Your card was canceled" action={{
          label: "Get a new card", pending: pending === "issue", onClick: () => issue("Couldn't create a new card. Try again."),
        }} />
      ) : null}
      {state === "restricted" && !live.length ? <HoldAlert description="You can't create a card right now." /> : null}
      {state === "restricted" && live.length > 1 ? <HoldAlert description="New purchases are declined." /> : null}
      {issued ? live.map((card, index) => (
        <IssuedCardOverview
          key={card.id}
          card={card}
          position={sharesLast4(card.last4) ? index + 1 : undefined}
          restricted={state === "restricted"}
          showHold={state === "restricted" && single}
          single={single}
          pending={pending === "lock"}
          reveal={reveal}
          onLock={(locked) => void run("lock", async () => {
            await commands.setFrozen(card.id, locked);
            return () => add({ message: locked ? "Card locked" : "Card unlocked", tone: "success" });
          }, locked ? "Couldn't lock your card. Try again." : "Couldn't unlock your card. Try again.")}
        />
      )) : null}
      {spendingSection}
      {(state === "active" || state === "frozen") && !live.length ? (
        <LoadErrorCard title="Card is unavailable right now" onRetry={onRetry} />
      ) : null}
    </div>
  );
}

export function cardScreenData(query: { data?: CardsResponse; isError: boolean }): CardScreenData {
  if (query.isError) return { status: "failed" };
  return query.data ? { status: "ready", response: query.data } : { status: "loading" };
}

export function AuthenticatedCardExperience() {
  const account = useAccountWallet();
  const verified = account.status === "verified" && account.verification === "server" && Boolean(account.session?.smartAccount);
  const ownerKey = verified ? account.ownerKey : null;
  const { query, refresh, commands } = useCards({ ownerKey, fetchAccountResource: account.fetchAccountResource });
  const spending = useCardSpending({ ownerKey: verified && account.session?.smartAccount ? dataOwnerKey(account.session) : null, fetchAccountResource: account.fetchAccountResource });
  const publishableKey = stripePublishableKey();
  const cards = cardScreenData(query);
  return (
    <CardScreen
      cards={cards}
      commands={commands}
      onRetry={() => void refresh()}
      onOpenVerification={(url) => window.location.assign(url)}
      ownerBoundary={ownerKey}
      reveal={publishableKey ? { publishableKey, revealKey: commands.revealKey } : undefined}
      spending={cardSpendingData(spending.query)}
      onSpendingRetry={() => void spending.refresh()}
      spendingCommands={{ prepare: (params) => account.prepareMoneyAction("card-allowance", params), execute: account.executeMoneyAction, fetchOperations: account.fetchOperations }}
    />
  );
}
