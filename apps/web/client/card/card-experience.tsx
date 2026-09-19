"use client";

import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Eye,
  Lock,
  RotateCcw,
  ShieldCheck,
  Snowflake,
  Undo2,
  WalletCards,
  X,
} from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type {
  CardActivityStatus,
  CardActivitySummary,
  CardEntryState,
  CardExperienceProps,
  IssuedCardState,
} from "./card-types";

export function CardExperience(props: CardExperienceProps) {
  return (
    <main className="space-y-4" aria-labelledby="card-page-title">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight" id="card-page-title">
          Card
        </h1>
        <p className="text-sm text-muted-foreground">
          {props.state.kind === "issued"
            ? "Spend from a dedicated card allocation."
            : "Set up a card for everyday spending."}
        </p>
      </header>

      {props.state.kind === "not-issued" ? (
        <CardEntry {...props} state={props.state} />
      ) : (
        <IssuedCard {...props} state={props.state} />
      )}
    </main>
  );
}

function CardEntry({
  state,
  onStartIssuance,
  onStartVerification,
  onContactSupport,
}: CardExperienceProps & { state: CardEntryState }) {
  const entry = entryPresentation(state);
  const action = state.eligibility === "eligible"
    ? onStartIssuance
    : state.eligibility === "verification-required"
      ? onStartVerification
      : undefined;

  return (
    <Card>
      <CardContent>
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {state.eligibility === "verification-pending" ? (
                <ShieldCheck aria-hidden="true" />
              ) : state.eligibility === "country-unavailable" ? (
                <AlertCircle aria-hidden="true" />
              ) : (
                <CreditCard aria-hidden="true" />
              )}
            </EmptyMedia>
            <EmptyTitle>{entry.title}</EmptyTitle>
            <EmptyDescription>{entry.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {state.identityRequirement.kind !== "none" ? (
              <p className="text-sm text-muted-foreground">
                {state.identityRequirement.label}
              </p>
            ) : null}
            {action ? (
              <Button className="h-11 w-full" onClick={action}>
                {entry.actionLabel}
              </Button>
            ) : null}
            {state.eligibility === "verification-pending" && onContactSupport ? (
              <Button className="h-11 w-full" variant="secondary" onClick={onContactSupport}>
                Get help
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
}

function IssuedCard({
  state,
  fundingEntry,
  onOpenSecureDetails,
  onFreezeChange,
  onControlChange,
  onRequestWalletProvisioning,
  onOpenActivity,
  onContactSupport,
}: CardExperienceProps & { state: IssuedCardState }) {
  const unavailable = state.serviceStatus === "outage";
  const frozen = state.status === "frozen";

  return (
    <>
      {unavailable ? (
        <Alert variant="destructive">
          <AlertTitle>Card service is temporarily unavailable</AlertTitle>
          <AlertDescription>
            Recent information is kept visible, but card changes are paused. Try again later or contact support.
          </AlertDescription>
          {onContactSupport ? (
            <AlertAction>
              <Button size="sm" variant="secondary" onClick={onContactSupport}>
                Support
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}

      <section aria-labelledby="card-balance-title">
        <Card variant="flush">
          <CardContent inset="hero">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted-foreground" id="card-balance-title">
                  Available to spend
                </p>
                <p className="text-4xl font-semibold tabular-nums">
                  {state.availableToSpend}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                {frozen ? <Snowflake className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                {frozen ? "Frozen" : "Active"}
              </span>
            </div>
            <div className="space-y-0.5 pt-2 text-sm text-muted-foreground">
              <p>{state.fundingSource}</p>
              <p>{state.allocationLabel}</p>
              {state.updatedAt ? <p>Updated {state.updatedAt}</p> : null}
            </div>
          </CardContent>
        </Card>
      </section>

      {state.lowFunds ? (
        <Alert>
          <CircleDollarSign aria-hidden="true" />
          <AlertTitle>Available funds are low</AlertTitle>
          <AlertDescription>
            Add funds before the next purchase to reduce the chance of a decline.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3" aria-label="Card actions">
        {fundingEntry ? <div className="min-w-0">{fundingEntry({ disabled: unavailable })}</div> : null}
        <Button
          className="h-11 w-full"
          variant="secondary"
          disabled={unavailable || !onOpenSecureDetails}
          onClick={onOpenSecureDetails}
        >
          <Eye aria-hidden="true" />
          View details
        </Button>
        <Button
          className="h-11 w-full"
          variant={frozen ? "default" : "secondary"}
          disabled={unavailable || !onFreezeChange}
          onClick={() => onFreezeChange?.(!frozen)}
        >
          {frozen ? <ShieldCheck aria-hidden="true" /> : <Snowflake aria-hidden="true" />}
          {frozen ? "Unfreeze" : "Freeze"}
        </Button>
      </section>

      <section aria-labelledby="card-overview-title">
        <Card>
          <CardHeader>
            <CardTitle id="card-overview-title" role="heading" aria-level={2}>
              Your card
            </CardTitle>
          </CardHeader>
          <CardContent inset="list">
            <div className="space-y-1">
              <Item>
                <ItemMedia variant="avatar">
                  <CreditCard aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{state.form === "virtual" ? "Virtual card" : "Physical card"}</ItemTitle>
                  <ItemDescription lines={2}>
                    Card numbers stay behind the secure details step.
                  </ItemDescription>
                </ItemContent>
              </Item>
              <WalletProvisioningRow
                state={state.walletState}
                disabled={unavailable}
                onRequest={onRequestWalletProvisioning}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <RecentCardActivity activity={state.activity} onOpenActivity={onOpenActivity} />

      <section aria-labelledby="card-controls-title">
        <Card>
          <CardHeader>
            <CardTitle id="card-controls-title" role="heading" aria-level={2}>
              Controls
            </CardTitle>
          </CardHeader>
          <CardContent inset="list">
            <div className="space-y-1">
              {state.controls.map((control) => (
                <Item key={control.id}>
                  <ItemContent>
                    <p className="text-sm font-medium leading-snug">{control.label}</p>
                    <ItemDescription lines={2}>{control.description}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={control.label}
                      checked={control.enabled}
                      disabled={unavailable || control.available === false || !onControlChange}
                      onCheckedChange={(enabled) => onControlChange?.(control.id, enabled)}
                    />
                  </ItemActions>
                </Item>
              ))}
              {state.controls.length > 0 && state.limits.length > 0 ? <Separator /> : null}
              {state.limits.map((limit) => (
                <Item key={limit.label}>
                  <ItemContent>
                    <p className="text-sm font-medium leading-snug">{limit.label}</p>
                    {limit.detail ? <ItemDescription lines={2}>{limit.detail}</ItemDescription> : null}
                  </ItemContent>
                  <ItemContent className="max-w-1/2 items-end text-right">
                    <ItemTitle numeric truncate={false}>{limit.value}</ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="card-support-title">
        <Card>
          <CardContent inset="list">
            <Item>
              <ItemMedia variant="avatar">
                <Lock aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle id="card-support-title">Card support</ItemTitle>
                <ItemDescription lines={2}>
                  Get help with a purchase, decline, refund, or dispute.
                </ItemDescription>
              </ItemContent>
              {onContactSupport ? (
                <ItemActions>
                  <Button size="sm" variant="secondary" onClick={onContactSupport}>
                    Get help
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function WalletProvisioningRow({
  state,
  disabled,
  onRequest,
}: {
  state: IssuedCardState["walletState"];
  disabled: boolean;
  onRequest?: () => void;
}) {
  const description = state === "provisioned"
    ? "Added to a supported mobile wallet."
    : state === "eligible"
      ? "Availability is confirmed before setup begins."
      : "Mobile wallet setup is not offered for this card.";

  return (
    <Item>
      <ItemMedia variant="avatar">
        <WalletCards aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Mobile wallet</ItemTitle>
        <ItemDescription lines={2}>{description}</ItemDescription>
      </ItemContent>
      {state === "eligible" && onRequest ? (
        <ItemActions>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onRequest}>
            Check setup
          </Button>
        </ItemActions>
      ) : state === "provisioned" ? (
        <ItemActions>
          <span className="text-sm font-medium">Added</span>
        </ItemActions>
      ) : null}
    </Item>
  );
}

function RecentCardActivity({
  activity,
  onOpenActivity,
}: {
  activity: readonly CardActivitySummary[];
  onOpenActivity?: (activityId?: string) => void;
}) {
  return (
    <section aria-labelledby="recent-card-activity-title">
      <Card>
        <CardHeader>
          <CardTitle id="recent-card-activity-title" role="heading" aria-level={2}>
            Recent card activity
          </CardTitle>
          {onOpenActivity ? (
            <CardAction>
              <Button size="card-action" variant="ghost" onClick={() => onOpenActivity()}>
                See all
                <ChevronRight aria-hidden="true" />
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent inset="list">
          {activity.length === 0 ? (
            <Empty className="items-start justify-start text-left">
              <EmptyHeader className="items-start">
                <EmptyTitle>No card activity yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="list-none space-y-1 p-0">
              {activity.map((item) => {
                const presentation = activityPresentation(item.status);
                return (
                  <li key={item.id}>
                    <Item
                      className="flex-nowrap"
                      render={onOpenActivity ? (
                        <Button
                          className="justify-start text-left"
                          variant="ghost"
                          aria-label={`View ${item.merchant} in Activity`}
                          onClick={() => onOpenActivity(item.id)}
                        />
                      ) : undefined}
                    >
                      <ItemMedia variant="avatar">
                        {presentation.icon}
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="w-full">{item.merchant}</ItemTitle>
                        <ItemDescription lines={2}>
                          {[presentation.label, item.statusDetail, item.occurredAt].filter(Boolean).join(" · ")}
                        </ItemDescription>
                      </ItemContent>
                      <ItemContent className="min-w-fit flex-none items-end text-right">
                        <ItemTitle
                          numeric
                          truncate={false}
                          tone={presentation.valueTone}
                        >
                          {item.amount}
                        </ItemTitle>
                      </ItemContent>
                      {onOpenActivity ? (
                        <ItemActions aria-hidden="true">
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </ItemActions>
                      ) : null}
                    </Item>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function entryPresentation(state: CardEntryState) {
  switch (state.eligibility) {
    case "eligible":
      return {
        title: "Set up your card",
        description: "Create a card allocation, choose an available card format, and review controls before you start spending.",
        actionLabel: "Get started",
      };
    case "verification-required":
      return {
        title: "Verify to continue",
        description: "The card partner needs identity verification before it can check your eligibility.",
        actionLabel: "Start verification",
      };
    case "verification-pending":
      return {
        title: "Verification in progress",
        description: "The card partner is reviewing your information. Card setup will continue when the review is complete.",
        actionLabel: "",
      };
    case "country-unavailable":
      return {
        title: "Card is not available in your country",
        description: "Home will show Card here when an operator-supported program is available for your country.",
        actionLabel: "",
      };
  }
}

function activityPresentation(status: CardActivityStatus): {
  icon: React.ReactNode;
  label: string;
  valueTone: "default" | "destructive" | "muted" | "primary";
} {
  switch (status) {
    case "settled":
      return { icon: <CreditCard aria-hidden="true" />, label: "Completed", valueTone: "default" };
    case "pending":
      return { icon: <CircleDollarSign aria-hidden="true" />, label: "Pending", valueTone: "muted" };
    case "declined":
      return { icon: <X aria-hidden="true" />, label: "Declined", valueTone: "destructive" };
    case "reversed":
      return { icon: <Undo2 aria-hidden="true" />, label: "Reversed", valueTone: "primary" };
    case "refunded":
      return { icon: <RotateCcw aria-hidden="true" />, label: "Refunded", valueTone: "primary" };
  }
}
