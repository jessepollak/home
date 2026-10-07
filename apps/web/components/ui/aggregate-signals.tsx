"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react";
import { AccordionDisclosure } from "@/components/ui/accordion";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";

export type AggregateSignal = {
  id: string;
  label: string;
  detail?: string;
  tone: "danger" | "caution" | "positive" | "neutral";
};

function SignalIcon({ tone }: { tone: AggregateSignal["tone"] }) {
  const Icon = tone === "danger" ? CircleX : tone === "caution" ? TriangleAlert
    : tone === "positive" ? CircleCheck : CircleHelp;
  return <Icon aria-hidden="true" className={`size-4 shrink-0 ${tone === "danger" ? "text-destructive" : tone === "caution" ? "text-warning" : tone === "positive" ? "text-market-gain" : "text-muted-foreground"}`} />;
}

export function AggregateSignals({ title, source, summary, signals = [], metadata, headingLevel = 3, children }: {
  title: string;
  source: string;
  summary: AggregateSignal[];
  signals?: AggregateSignal[];
  metadata?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  return <AccordionDisclosure title={title} attribution={source} headingLevel={headingLevel}
    summary={<span className="flex flex-col gap-1.5">{summary.map((signal) => <span key={signal.id} className="flex items-center gap-2">
      <SignalIcon tone={signal.tone} /><span>{signal.label}</span>
    </span>)}</span>}>
    {metadata ? <ItemDescription size="xs" tone="foreground" lines="wrap" className="px-3 py-1">{metadata}</ItemDescription> : null}
    {signals.length ? <div role="list" aria-label={`${title} signals`} className="divide-y divide-border">
      {signals.map((signal) => <Item key={signal.id} role="listitem" variant="flush" size="sm">
        <SignalIcon tone={signal.tone} />
        <ItemContent className="min-w-0">
          <ItemTitle truncate="wrap">{signal.label}</ItemTitle>
          {signal.detail ? <ItemDescription tone="foreground" size="xs" lines="wrap">{signal.detail}</ItemDescription> : null}
        </ItemContent>
      </Item>)}
    </div> : null}
    {children}
  </AccordionDisclosure>;
}
