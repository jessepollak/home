"use client";

import { Banknote, CircleCheck, Clock, Menu, PiggyBank, X } from "lucide-react";
import type { ReactNode } from "react";
import { GlyphMark } from "@/components/currency-mark";
import { ActivityRow } from "@/components/finance-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { SupportMessageBubble } from "@/components/ui/support-message";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BRAND_DEFAULTS } from "@/shared/operator-branding/schema";
import { brandCopyName } from "@/shared/operator-branding/theme";
import { DemoFrame } from "../features/demo-frame";
import { useStoryboard } from "../features/use-storyboard";

const noop = () => undefined;
const cashOutHolds = [1400, 1400] as const;
const activityHolds = [1800] as const;
const supportHolds = [1400, 1200, 800] as const;

const mayaAddress = "0x1111…111111";
const operatorLabel = "Operator 0x3C44…93BC";
const operatorReply = "I'll check this for you";

function DetailBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <Badge variant="secondary">
      {confirmed ? <CircleCheck aria-hidden="true" /> : <Clock aria-hidden="true" />}
      {confirmed ? "Confirmed" : "Pending"}
    </Badge>
  );
}

function SheetFacts({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <Card variant="flush">
      <CardContent inset="list">
        <dl>
          {rows.map(([label, value]) => (
            <div key={label} className="grid min-h-11 grid-cols-[minmax(6rem,0.65fr)_minmax(0,1.35fr)] items-center gap-3 px-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-end wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function cashOutFacts(paid: boolean): [string, ReactNode][] {
  return [
    ["Date", "Sep 28, 2026, 11:16 AM"],
    ["Network", "Base"],
    ["Provider", "Peer"],
    ["Payout app", "Cash App"],
    ["Payout handle", "maya"],
    [paid ? "Quoted receive" : "You receive", "≈ $50.00 to Cash App"],
    ...(paid ? [] : [["Arrives", "Usually within 1 hour"] as [string, ReactNode]]),
    ["Transaction", <span key="transaction" className="font-mono">0x8f3c2a1b…4d7e9c21</span>],
  ];
}

function CashOutHeadline({ confirmed }: { confirmed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <p className="text-4xl leading-none font-semibold tabular-nums">−$50.00</p>
      <DetailBadge confirmed={confirmed} />
    </div>
  );
}

export function StoryCashOutDemo() {
  const board = useStoryboard(cashOutHolds);
  const paid = board.step === 2;
  return (
    <DemoFrame {...board} label="Cash out">
      <Card className="gap-2 px-4 pt-2">
        <div className="grid h-11 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center">
          <span />
          <p className="truncate text-center text-base font-semibold">Cash out to Cash App</p>
          <span className="flex justify-end pe-3.5"><X className="size-4" aria-hidden="true" /></span>
        </div>
        <div className="grid">
          <div className={cn("col-start-1 row-start-1 flex flex-col gap-4 transition-opacity duration-base ease-exit", paid && "opacity-0")}>
            <CashOutHeadline confirmed={false} />
            <div className="grid">
              {["Waiting for a buyer", "Buyer paying you"].map((title, index) => (
                <div key={title} className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", board.step !== index && "opacity-0")}>
                  <StatusSteps>
                    <StatusStep status="current" title={title} showConnector={false} />
                  </StatusSteps>
                </div>
              ))}
            </div>
            <SheetFacts rows={cashOutFacts(false)} />
            <p className="self-end text-sm font-medium text-muted-foreground">View on explorer<span aria-hidden="true"> ↗</span></p>
          </div>
          <div className={cn("col-start-1 row-start-1 flex flex-col gap-4 transition-[opacity,scale] duration-base ease-enter", paid ? "opacity-100" : "scale-[0.98] opacity-0")}>
            <div className="flex flex-1 flex-col justify-center">
              <CashOutHeadline confirmed />
            </div>
            <SheetFacts rows={cashOutFacts(true)} />
            <p className="self-end text-sm font-medium text-muted-foreground">View on explorer<span aria-hidden="true"> ↗</span></p>
          </div>
        </div>
      </Card>
    </DemoFrame>
  );
}

export function StoryActivityDemo() {
  const board = useStoryboard(activityHolds);
  const complete = board.step === 1;
  return (
    <DemoFrame {...board} label="Activity">
      <Card className="gap-3">
        <CardHeader><p className="text-base leading-6 font-semibold">Activity</p></CardHeader>
        <CardContent inset="list" className="relative">
          <div className="grid h-8 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            <span className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", complete && "opacity-0")}>Pending</span>
            <span className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", !complete && "opacity-0")}>Recent</span>
          </div>
          <ul className="list-none p-0">
            <ActivityRow
              icon={<GlyphMark size="sm"><Banknote className="size-4" /></GlyphMark>}
              iconTone="mark"
              label="Cash out to Cash App"
              context={complete ? "Sep 28, 11:16 AM" : "Pending · Sep 28, 11:16 AM"}
              value="−$50.00"
              onActivate={noop}
              activateLabel="View Cash out details"
            />
          </ul>
          <div className={cn("transition-[translate] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)", complete && "-translate-y-8")}>
            <p className={cn("h-8 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase transition-opacity duration-fast ease-exit", complete && "opacity-0")}>Recent</p>
            <ul className="list-none p-0">
              <ActivityRow icon="↑" iconTone="outgoing" label="Sent" context="Sep 28, 10:32 AM" value="−$25.00" onActivate={noop} activateLabel="View Sent details" />
              <ActivityRow icon={<GlyphMark size="sm"><PiggyBank className="size-4" /></GlyphMark>} iconTone="mark" label="Deposit to Save" context="Sep 28, 9:14 AM" value="$100.00" onActivate={noop} activateLabel="View Deposit to Save details" />
              <ActivityRow icon={<GlyphMark size="sm"><Banknote className="size-4" /></GlyphMark>} iconTone="mark" label="Add money" context="Sep 28, 9:02 AM" value="+$200.00" valueTone="success" onActivate={noop} activateLabel="View Add money details" />
            </ul>
          </div>
          <p className={cn("absolute inset-x-0 bottom-1 flex h-8 items-center justify-center text-xs text-muted-foreground transition-opacity duration-base ease-enter", complete ? "opacity-100 delay-150" : "opacity-0")}>End of activity</p>
        </CardContent>
      </Card>
    </DemoFrame>
  );
}

function Swap({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", !show && "translate-y-1 opacity-0")}>
      {children}
    </div>
  );
}

export function StoryManagementDemo() {
  const board = useStoryboard(supportHolds);
  const typed = board.step === 1 || board.step === 2;
  const sending = board.step === 2;
  const replied = board.step === 3;
  return (
    <DemoFrame {...board} label="Support inbox">
      <div className="overflow-hidden rounded-xl bg-background text-foreground shadow-raised">
        <div className="flex h-14 items-center justify-between border-b ps-4 pe-2">
          <span className="text-base font-semibold">{brandCopyName(BRAND_DEFAULTS.displayName)}</span>
          <Button variant="ghost" size="icon-lg" className="size-11">
            <Menu aria-hidden="true" />
          </Button>
        </div>
        <div className="grid gap-4 p-4">
          <p className="text-xl font-semibold tracking-tight">Support</p>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-base font-semibold">{mayaAddress}</p>
            <Button variant="outline" size="touch">Resolve</Button>
          </div>
          <div className="grid">
            <Swap show={!replied}>
              <Item variant="outline" size="sm" className="h-full">
                <ItemContent><ItemTitle truncate="wrap">Assistant is handling this</ItemTitle></ItemContent>
                <ItemActions><Button variant="outline" size="touch">Take over</Button></ItemActions>
              </Item>
            </Swap>
            <Swap show={replied}>
              <Item variant="outline" size="sm" className="h-full">
                <ItemContent><ItemTitle truncate="wrap">An operator is handling this</ItemTitle></ItemContent>
                <ItemActions><Button variant="outline" size="touch">Hand back to assistant</Button></ItemActions>
              </Item>
            </Swap>
          </div>
          <div className="grid content-start gap-3 py-1">
            <div className="grid">
              <span className="text-xs text-muted-foreground">Customer</span>
              <SupportMessageBubble author="customer" side="operator">My funding order needs help</SupportMessageBubble>
            </div>
            <SupportMessageBubble author="assistant" side="operator">Your deposit is pending with the provider. It usually settles within an hour.</SupportMessageBubble>
            <div className={cn("grid transition-[opacity,translate] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)", !replied && "translate-y-2 opacity-0")}>
              <span className="ms-auto text-xs text-muted-foreground">{operatorLabel}</span>
              <SupportMessageBubble author="operator" side="operator" speaker={operatorLabel}>{operatorReply}</SupportMessageBubble>
            </div>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Reply</p>
            <Textarea readOnly tabIndex={-1} value={typed ? operatorReply : ""} className="min-h-11" />
            <Button size="touch" loading={sending} disabled={!typed}>Send</Button>
          </div>
        </div>
      </div>
    </DemoFrame>
  );
}
