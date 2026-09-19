"use client";

import { useId, type ReactNode } from "react";
import {
  Check,
  CircleAlert,
  Clock3,
  LogIn,
  MapPinOff,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

export const capabilityStateKinds = [
  "available",
  "sign-in-required",
  "verification-start",
  "verification-pending",
  "verification-rejected",
  "unavailable-in-country",
  "not-yet-in-home",
  "temporarily-unavailable",
  "configuration-unavailable",
] as const;

export type CapabilityStateKind = (typeof capabilityStateKinds)[number];

export const capabilityActionKinds = [
  "open",
  "sign-in",
  "start-verification",
  "resume-verification",
  "retry-verification",
  "retry",
] as const;

export type CapabilityActionKind = (typeof capabilityActionKinds)[number];

export const capabilityStateAllowedActions = {
  available: ["open"],
  "sign-in-required": ["sign-in"],
  "verification-start": ["start-verification"],
  "verification-pending": ["resume-verification"],
  "verification-rejected": ["retry-verification", "resume-verification"],
  "unavailable-in-country": [],
  "not-yet-in-home": [],
  "temporarily-unavailable": ["retry"],
  "configuration-unavailable": [],
} as const satisfies Record<CapabilityStateKind, readonly CapabilityActionKind[]>;

export const capabilityStateMessageIds = {
  available: {
    title: "capability.state.available.title",
    description: "capability.state.available.description",
    actions: ["capability.state.available.action.open"],
  },
  "sign-in-required": {
    title: "capability.state.sign_in_required.title",
    description: "capability.state.sign_in_required.description",
    actions: ["capability.state.sign_in_required.action.sign_in"],
  },
  "verification-start": {
    title: "capability.state.verification_start.title",
    description: "capability.state.verification_start.description",
    actions: ["capability.state.verification_start.action.start"],
  },
  "verification-pending": {
    title: "capability.state.verification_pending.title",
    description: "capability.state.verification_pending.description",
    actions: ["capability.state.verification_pending.action.resume"],
  },
  "verification-rejected": {
    title: "capability.state.verification_rejected.title",
    description: "capability.state.verification_rejected.description",
    actions: [
      "capability.state.verification_rejected.action.retry",
      "capability.state.verification_rejected.action.resume",
    ],
  },
  "unavailable-in-country": {
    title: "capability.state.unavailable_in_country.title",
    description: "capability.state.unavailable_in_country.description",
    actions: [],
  },
  "not-yet-in-home": {
    title: "capability.state.not_yet_in_home.title",
    description: "capability.state.not_yet_in_home.description",
    actions: [],
  },
  "temporarily-unavailable": {
    title: "capability.state.temporarily_unavailable.title",
    description: "capability.state.temporarily_unavailable.description",
    actions: ["capability.state.temporarily_unavailable.action.retry"],
  },
  "configuration-unavailable": {
    title: "capability.state.configuration_unavailable.title",
    description: "capability.state.configuration_unavailable.description",
    actions: [],
  },
} as const satisfies Record<CapabilityStateKind, {
  title: string;
  description: string;
  actions: readonly string[];
}>;

type CapabilityStateCopy = {
  statusLabel: string;
  title: string;
  description: string;
  actionLabel?: string;
};

const defaultCopy = {
  available: {
    statusLabel: "Available",
    title: "Ready to use",
    description: "This feature is available now.",
  },
  "sign-in-required": {
    statusLabel: "Sign-in required",
    title: "Sign in to continue",
    description: "Sign in to check your access and continue.",
  },
  "verification-start": {
    statusLabel: "Verification required",
    title: "Verify your identity",
    description: "Complete identity verification to use this feature.",
  },
  "verification-pending": {
    statusLabel: "In review",
    title: "Verification in review",
    description: "Your information was submitted. You can return here to check progress.",
  },
  "verification-rejected": {
    statusLabel: "Needs attention",
    title: "Verification needs attention",
    description: "Review the verification request and provide the requested information.",
  },
  "unavailable-in-country": {
    statusLabel: "Country unavailable",
    title: "Not available in your country",
    description: "This feature is not offered for your selected country.",
  },
  "not-yet-in-home": {
    statusLabel: "Not offered",
    title: "Not yet in Home",
    description: "Home does not offer this feature yet.",
  },
  "temporarily-unavailable": {
    statusLabel: "Try later",
    title: "Temporarily unavailable",
    description: "Home could not load this feature. Try again.",
  },
  "configuration-unavailable": {
    statusLabel: "Not configured",
    title: "This feature is not set up",
    description: "This Home has not configured this feature.",
  },
} as const satisfies Record<CapabilityStateKind, CapabilityStateCopy>;

const defaultActionLabels = {
  open: "Open",
  "sign-in": "Sign in",
  "start-verification": "Start verification",
  "resume-verification": "Resume verification",
  "retry-verification": "Try verification again",
  retry: "Retry",
} as const satisfies Record<CapabilityActionKind, string>;

export type CapabilityStateAction = {
  kind: CapabilityActionKind;
  label?: string;
  onSelect: () => void;
};

export type CapabilityStatePlacement = "tile" | "row" | "detail" | "account";

export type CapabilityStateProps = {
  capability: string;
  state: CapabilityStateKind;
  placement: CapabilityStatePlacement;
  action?: CapabilityStateAction;
  copy?: Partial<CapabilityStateCopy>;
  icon?: ReactNode;
  announce?: boolean;
};

export function isCapabilityActionAllowed(
  state: CapabilityStateKind,
  action: CapabilityActionKind,
): boolean {
  return (capabilityStateAllowedActions[state] as readonly CapabilityActionKind[]).includes(action);
}

export function CapabilityState({
  capability,
  state,
  placement,
  action,
  copy,
  icon,
  announce = false,
}: CapabilityStateProps) {
  const allowedAction = action && isCapabilityActionAllowed(state, action.kind)
    ? action
    : undefined;
  const headingId = useId();
  const resolvedCopy = { ...defaultCopy[state], ...copy };
  const actionLabel = allowedAction
    ? allowedAction.label ?? copy?.actionLabel ?? defaultActionLabels[allowedAction.kind]
    : undefined;
  const statusIcon = icon ?? <StateIcon state={state} />;
  const actionControl = allowedAction && actionLabel ? (
    <Button
      type="button"
      variant={state === "available" ? "default" : "secondary"}
      onClick={allowedAction.onSelect}
    >
      {actionLabel}
    </Button>
  ) : null;
  const semanticProps = announce
    ? { role: "status" as const, "aria-live": "polite" as const }
    : { role: "group" as const };

  if (placement === "tile") {
    return (
      <Card {...semanticProps} aria-labelledby={headingId} data-capability-state={state}>
        <CardHeader>
          <CardTitle id={headingId}>{capability}</CardTitle>
          <Badge variant={badgeVariant(state)}>{resolvedCopy.statusLabel}</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-32 flex-col gap-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
              {statusIcon}
            </span>
            <div className="mt-auto space-y-1">
              <p className="font-medium">{resolvedCopy.title}</p>
              <p className="text-sm text-muted-foreground">{resolvedCopy.description}</p>
            </div>
            {actionControl}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (placement === "row" || placement === "account") {
    return (
      <Item
        {...semanticProps}
        aria-labelledby={headingId}
        data-capability-state={state}
        variant={placement === "account" ? "default" : "outline"}
      >
        <ItemMedia variant="avatar" aria-hidden="true">{statusIcon}</ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle id={headingId} truncate={false}>
            <span className="wrap-anywhere whitespace-normal">{capability}</span>
          </ItemTitle>
          <ItemDescription lines="none">
            {resolvedCopy.title}. {resolvedCopy.description}
          </ItemDescription>
          {placement === "row" ? <Badge variant={badgeVariant(state)}>{resolvedCopy.statusLabel}</Badge> : null}
        </ItemContent>
        {actionControl ? <ItemActions className="basis-full justify-end sm:basis-auto">{actionControl}</ItemActions> : null}
      </Item>
    );
  }

  return (
    <Card {...semanticProps} aria-labelledby={headingId} data-capability-state={state}>
      <CardHeader>
        <CardTitle id={headingId}>{resolvedCopy.title}</CardTitle>
        <CardDescription>{capability}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Alert variant="default" role="presentation">
            {statusIcon}
            <AlertTitle>{resolvedCopy.statusLabel}</AlertTitle>
            <AlertDescription>{resolvedCopy.description}</AlertDescription>
          </Alert>
          {actionControl}
        </div>
      </CardContent>
    </Card>
  );
}

function StateIcon({ state }: { state: CapabilityStateKind }) {
  const Icon = state === "available"
    ? Check
    : state === "sign-in-required"
      ? LogIn
      : state === "verification-start"
        ? ShieldCheck
        : state === "verification-pending"
          ? Clock3
          : state === "verification-rejected"
            ? CircleAlert
            : state === "unavailable-in-country"
              ? MapPinOff
              : state === "not-yet-in-home"
                ? Sparkles
                : state === "temporarily-unavailable"
                  ? RotateCcw
                  : Settings2;
  return <Icon className="size-4" aria-hidden="true" />;
}

function badgeVariant(state: CapabilityStateKind): "default" | "secondary" | "outline" {
  if (state === "available") return "default";
  if (state === "sign-in-required" || state === "verification-start" || state === "verification-pending") return "secondary";
  return "outline";
}
