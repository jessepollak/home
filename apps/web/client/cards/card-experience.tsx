"use client";

import { useId, useState } from "react";
import { Banknote, CircleAlert, CreditCard, Eye, Lock } from "lucide-react";
import { useAccountWallet } from "@/client/account/cdp-client";
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
import { useCards, type CardCommands } from "./use-cards";

type IssuedCard = CardsResponse["cards"][number];
type Pending = "enroll" | "issue" | "lock" | null;
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
};

function CardArt({ last4, locked }: { last4: string; locked: boolean }) {
  return (
    <div
      role="img"
      aria-label={`Virtual card ending ${last4}${locked ? ", locked" : ""}`}
      className={`flex h-44 w-70 max-w-full shrink-0 flex-col justify-between rounded-lg border p-4 ${
        locked ? "border-border bg-muted text-foreground/75" : "border-foreground bg-foreground text-background"}`}
    >
      <div className="flex items-start justify-between gap-2">
        {locked ? <Badge variant="secondary"><Lock aria-hidden="true" />Locked</Badge> : <span className="size-3 rounded-sm bg-primary" />}
        <span className="text-xs">Virtual</span>
      </div>
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

function LockRow({ card, restricted, pending, onChange }: {
  card: IssuedCard;
  restricted: boolean;
  pending: boolean;
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
          aria-label="Lock card"
          checked={locked}
          disabled={pending || unlockBlocked}
          onCheckedChange={onChange}
        />
      </ItemActions>
    </Item>
  );
}

function IssuedCardOverview({ card, restricted, pending, onLock, reveal }: {
  card: IssuedCard;
  restricted: boolean;
  pending: boolean;
  onLock: (locked: boolean) => void;
  reveal?: CardReveal;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const locked = card.status !== "active";
  const titleId = useId();
  const canReveal = reveal !== undefined && !restricted && (card.status === "active" || card.status === "frozen");
  return (
    <>
      <Card variant="flush">
        <CardContent inset="hero">
          <div className="flex justify-center"><CardArt last4={card.last4} locked={locked} /></div>
        </CardContent>
      </Card>
      {restricted ? (
        <Alert>
          <AlertIcon><CircleAlert /></AlertIcon>
          <AlertTitle>Your card is on hold</AlertTitle>
          <AlertDescription>New purchases are declined.</AlertDescription>
        </Alert>
      ) : null}
      {canReveal ? (
        <Button size="touch" variant="outline" className="w-full" onClick={() => { setRevealed(true); setDetailsOpen(true); }}>
          <Eye data-icon="inline-start" aria-hidden="true" />Card details
        </Button>
      ) : null}
      <section aria-labelledby="your-card-title">
        <Card className="gap-3">
          <CardHeader><HomeSectionHeading id="your-card-title">Your card</HomeSectionHeading></CardHeader>
          <CardContent inset="list">
            <LockRow card={card} restricted={restricted} pending={pending} onChange={onLock} />
          </CardContent>
        </Card>
      </section>
      {reveal && canReveal ? (
        <MoneyModal open={detailsOpen} labelledBy={titleId} onCancel={() => setDetailsOpen(false)} onClose={() => setRevealed(false)}>
          <MoneyModalStep step="details">
            <MoneyModalHeader title="Card details" titleId={titleId} closeLabel="Close card details" />
            <MoneyModalBody className="gap-3 pt-4">
              {revealed ? <CardDetailsReveal cardId={card.id} publishableKey={reveal.publishableKey} revealKey={reveal.revealKey} /> : null}
            </MoneyModalBody>
          </MoneyModalStep>
        </MoneyModal>
      ) : null}
    </>
  );
}

export function CardScreen({ cards, commands, onRetry, onOpenVerification, reveal, ownerBoundary = null }: CardScreenProps) {
  const [pending, setPending] = useState<Pending>(null);
  const { add } = useHomeToast(ownerBoundary);

  async function run(kind: Exclude<Pending, null>, work: () => Promise<void>, failure: string) {
    if (pending) return;
    setPending(kind);
    try {
      await work();
    } catch (error) {
      add({ message: failure, tone: "error", role: "alert" });
      void reportClientError({
        name: error instanceof Error ? error.name : "Error",
        message: `Card ${kind} failed`,
        route: window.location.pathname,
      });
    } finally {
      setPending(null);
    }
  }

  const enroll = () => void run("enroll", async () => onOpenVerification(await commands.enroll()), "Couldn't start verification. Try again.");
  const issue = (failure: string) => void run("issue", commands.issue, failure);

  if (cards.status === "loading") {
    return (
      <section className="space-y-4" aria-busy="true" aria-label="Loading card">
        <Card variant="flush"><CardContent inset="hero"><ShimmerRows variant="hero" /></CardContent></Card>
        <ShimmerRows count={2} />
      </section>
    );
  }
  if (cards.status === "failed" || cards.response.state === "unavailable") {
    return <LoadErrorCard title="Card is unavailable right now" onRetry={onRetry} />;
  }
  const { state } = cards.response;
  const card = cards.response.cards.find((item) => item.status !== "canceled") ?? null;
  return (
    <div className="space-y-4">
      {state === "not-enrolled" ? (
        <FeatureIntro
          headline="Spend your Cash with a card"
          illustration="card"
          benefits={[
            { icon: CreditCard, text: "Spend online anywhere cards work" },
            { icon: Lock, text: "Lock it anytime" },
            { icon: Banknote, text: "Spend straight from your Cash" },
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
      {(state === "active" || state === "frozen" || state === "restricted") && card ? (
        <IssuedCardOverview
          card={card}
          restricted={state === "restricted"}
          pending={pending === "lock"}
          reveal={reveal}
          onLock={(locked) => void run("lock", async () => {
            await commands.setFrozen(card.id, locked);
            add({ message: locked ? "Card locked" : "Card unlocked", tone: "success" });
          }, locked ? "Couldn't lock your card. Try again." : "Couldn't unlock your card. Try again.")}
        />
      ) : null}
      {(state === "active" || state === "frozen" || state === "restricted") && !card ? (
        <LoadErrorCard title="Card is unavailable right now" onRetry={onRetry} />
      ) : null}
    </div>
  );
}

export function AuthenticatedCardExperience() {
  const account = useAccountWallet();
  const verified = account.status === "verified" && account.verification === "server" && Boolean(account.session?.smartAccount);
  const ownerKey = verified ? account.ownerKey : null;
  const { query, refresh, commands } = useCards({ ownerKey, fetchAccountResource: account.fetchAccountResource });
  const publishableKey = stripePublishableKey();
  const cards: CardScreenData = query.data
    ? { status: "ready", response: query.data }
    : query.isError ? { status: "failed" } : { status: "loading" };
  return (
    <CardScreen
      cards={cards}
      commands={commands}
      onRetry={() => void refresh()}
      onOpenVerification={(url) => window.location.assign(url)}
      ownerBoundary={ownerKey}
      reveal={publishableKey ? { publishableKey, revealKey: commands.revealKey } : undefined}
    />
  );
}
