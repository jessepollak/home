"use client";

import { Banknote, ChevronDown, CircleCheck, Clock, PiggyBank, Plus, X } from "lucide-react";
import { useContext, type CSSProperties, type ReactNode } from "react";
import { GlyphMark } from "@/components/currency-mark";
import { ActivityRow, BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { MoneyBreakdownLegend, SignedBalanceBar } from "@/components/signed-balance-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ResultHeader } from "@/components/ui/result-header";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { StatusMark } from "@/components/ui/status-texture";
import { cn } from "@/lib/utils";
import { BRAND_DEFAULTS, type BrandSettings } from "@/shared/operator-branding/schema";
import { brandCopyName, deriveBrandTheme } from "@/shared/operator-branding/theme";
import type { MoneyBreakdownItem } from "@/shared/balances/present";
import { DemoFrame } from "./demo-frame";
import { SceneContext, useStoryboard } from "./use-storyboard";

const noop = () => undefined;
const addMoneyHolds = [1000, 140] as const;
const sendHolds = [1600, 900, 1500] as const;
const saveHolds = [1200] as const;
const cashOutHolds = [1400, 1400] as const;
const activityHolds = [1800] as const;
const brandHolds = [1600] as const;

function CardHeading({ children }: { children: string }) {
  return <p className="text-base leading-6 font-semibold">{children}</p>;
}

export function AddMoneyDemo() {
  const board = useStoryboard(addMoneyHolds);
  const pressed = board.step === 1;
  const added = board.step === 2;
  const breakdown: MoneyBreakdownItem[] = [
    { id: "cash", label: "Cash", value: added ? "$1,804.00" : "$1,604.00", weight: added ? 1804 : 1604 },
    { id: "investments", label: "Investments", value: "$4,381.08", weight: 4381.08 },
  ];
  return (
    <DemoFrame {...board} label="Add money">
      <div className="flex flex-col gap-3">
        <Card variant="flush">
          <CardContent inset="hero">
            <p className="text-sm text-muted-foreground">Total balance</p>
            <div className="flex min-h-10 items-center text-4xl font-semibold tabular-nums">
              <MoneyTicker value={added ? "$6,185.08" : "$5,985.08"} align="start" reserveDigits={false} />
            </div>
            <div className="space-y-2">
              <SignedBalanceBar items={breakdown} selectedId={null} onSelect={noop} />
              <MoneyBreakdownLegend items={breakdown} selectedId={null} onSelect={noop} />
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" className={cn(pressed && "scale-[0.97] bg-primary/80")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add money
          </Button>
          <Button size="touch" variant="outline">Send</Button>
        </div>
      </div>
    </DemoFrame>
  );
}

const sendFacts: readonly [string, ReactNode][] = [
  ["From", <span key="from" className="font-mono">0x1111…111111</span>],
  ["To", <span key="to" className="flex items-center justify-end gap-2 font-mono">0x2211…d77DA9<ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" /></span>],
  ["Asset", "USDC"],
  ["Network", "Base"],
  ["Network fee", "Up to 0.02 USDC · ≈ $0.02"],
];

function ReviewFacts({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <Card variant="flush">
      <CardContent inset="list">
        <dl>
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-3 text-sm">
              <dt className="min-w-0 text-muted-foreground">{label}</dt>
              <dd className="ms-auto min-w-0 text-end font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function SendDemo() {
  const board = useStoryboard(sendHolds);
  const sent = board.step >= 2;
  const confirmed = board.step === 3;
  return (
    <DemoFrame {...board} label="Send">
      <Card className="gap-5 p-4">
        <div className="grid">
          <div className={cn("col-start-1 row-start-1 flex flex-col gap-5 transition-[opacity,translate] duration-base ease-standard", sent && "-translate-y-2 opacity-0")}>
            <p className="text-center text-base font-semibold">Confirm</p>
            <div className="flex flex-col items-center gap-1">
              <p className="text-4xl leading-none font-semibold tabular-nums">$25.00</p>
              <p className="text-sm text-muted-foreground">You&apos;re sending USDC</p>
            </div>
          </div>
          <div className={cn("col-start-1 row-start-1 flex items-center justify-center transition-[opacity,translate] duration-base ease-standard", !sent && "translate-y-2 opacity-0", confirmed && "opacity-0")}>
            <ResultHeader outcome="pending" title="$25.00 on its way" description="We'll update Activity when it's confirmed." />
          </div>
          <div className={cn("col-start-1 row-start-1 flex items-center justify-center transition-[opacity,scale] duration-base ease-enter", confirmed ? "opacity-100" : "scale-95 opacity-0")}>
            <ResultHeader outcome="success" title="$25.00 sent" />
          </div>
        </div>
        <ReviewFacts rows={sendFacts} />
        <div className="grid">
          <Button size="touch" loading={board.step === 1} className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", sent && "opacity-0")}>Send $25.00</Button>
          <Button size="touch" className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", !sent && "opacity-0")}>Done</Button>
        </div>
      </Card>
    </DemoFrame>
  );
}

export function SaveDemo() {
  const board = useStoryboard(saveHolds);
  const saved = board.step === 1;
  return (
    <DemoFrame {...board} label="Save">
      <div className="flex flex-col gap-3">
        <Card className="gap-3">
          <CardHeader><CardHeading>Currencies</CardHeading></CardHeader>
          <CardContent inset="list">
            <ul className="list-none p-0">
              <BalanceRow
                icon={<GlyphMark size="sm"><Banknote className="size-4" /></GlyphMark>}
                iconTone="mark"
                label="US dollar"
                context="USDC"
                value={<MoneyTicker value={saved ? "$1,184.00" : "$1,284.00"} reserveDigits={false} />}
              />
            </ul>
          </CardContent>
        </Card>
        <Card className="gap-3">
          <CardHeader><CardHeading>Savings</CardHeading></CardHeader>
          <CardContent inset="list">
            <ul className="list-none p-0">
              <BalanceRow
                icon={<GlyphMark size="sm"><PiggyBank className="size-4" /></GlyphMark>}
                iconTone="mark"
                label="US dollar"
                context="USDC"
                value={<MoneyTicker value={saved ? "$420.00" : "$320.00"} reserveDigits={false} />}
                onActivate={noop}
                activateLabel="Open US dollar savings"
              />
            </ul>
          </CardContent>
        </Card>
        <p className={cn("flex items-center justify-center gap-2 text-sm transition-[opacity,translate] duration-base ease-enter", saved ? "opacity-100" : "translate-y-1 opacity-0")}>
          <StatusMark texture="done" />
          Deposited $100.00 to Save
        </p>
      </div>
    </DemoFrame>
  );
}

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
    ["Payout handle", "alice"],
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

export function CashOutDemo() {
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

export function ActivityDemo() {
  const board = useStoryboard(activityHolds);
  const complete = board.step === 1;
  return (
    <DemoFrame {...board} label="Activity">
      <Card className="gap-3">
        <CardHeader><CardHeading>Activity</CardHeading></CardHeader>
        <CardContent inset="list" className="relative">
          <div className="grid h-8 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            <span className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", complete && "opacity-0")}>Pending</span>
            <span className={cn("col-start-1 row-start-1 transition-opacity duration-base ease-standard", !complete && "opacity-0")}>Recent</span>
          </div>
          <ul className="list-none p-0">
            <ActivityRow
              icon={<GlyphMark size="sm"><Banknote className="size-4" /></GlyphMark>}
              iconTone="mark"
              label="Add money"
              context="Sep 28, 10:49 AM"
              value="+$200.00"
              valueTone={complete ? "success" : "default"}
              onActivate={noop}
              activateLabel="View Add money details"
            />
          </ul>
          <div className={cn("transition-[translate] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)", complete && "-translate-y-8")}>
            <p className={cn("h-8 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase transition-opacity duration-fast ease-exit", complete && "opacity-0")}>Recent</p>
            <ul className="list-none p-0">
              <ActivityRow icon="↓" iconTone="incoming" label="Received" context="Sep 28, 10:32 AM" value="+$25.00" valueTone="success" onActivate={noop} activateLabel="View Received details" />
              <ActivityRow icon="↑" iconTone="outgoing" label="Sent" context="Sep 28, 8:07 AM" value="−$18.50" onActivate={noop} activateLabel="View Sent details" />
            </ul>
          </div>
          <p className={cn("absolute inset-x-0 bottom-1 flex h-8 items-center justify-center text-xs text-muted-foreground transition-opacity duration-base ease-enter", complete ? "opacity-100 delay-150" : "opacity-0")}>End of activity</p>
        </CardContent>
      </Card>
    </DemoFrame>
  );
}

const operatorBrand: BrandSettings = {
  displayName: "Harbor",
  description: "Money for the harbour towns.",
  primaryColor: "#0b6e4f",
  backgroundColor: "#f1f7f3",
};

function brandStyle(settings: BrandSettings): CSSProperties {
  const theme = deriveBrandTheme(settings);
  return {
    ...(theme.primary ? { "--primary": theme.primary.color, "--primary-foreground": theme.primary.foreground, "--ring": theme.primary.color } : {}),
    ...(theme.page ? { "--background": theme.page.color, "--foreground": theme.page.foreground } : {}),
  } as CSSProperties;
}

const brandFieldLabels = { displayName: "Name", primaryColor: "Primary colour", backgroundColor: "Background colour" } as const;

export function BrandDemo() {
  const board = useStoryboard(brandHolds);
  const operator = board.step === 1;
  const settings = operator ? operatorBrand : BRAND_DEFAULTS;
  const admin = useContext(SceneContext)?.frame === "admin";
  const preview = (
    <div style={brandStyle(settings)} className="overflow-hidden rounded-xl bg-muted text-foreground shadow-raised">
      <div className="flex h-14 items-center gap-3 border-b bg-background px-4 transition-colors duration-(--motion-duration-slow) ease-standard">
        <span className="size-6 rounded-sm bg-primary transition-colors duration-(--motion-duration-slow) ease-standard" />
        <span className="grid text-base font-semibold">
          <span className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", operator && "-translate-y-1 opacity-0")}>{brandCopyName(BRAND_DEFAULTS.displayName)}</span>
          <span className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", !operator && "translate-y-1 opacity-0")}>{brandCopyName(operatorBrand.displayName)}</span>
        </span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <Card variant="flush">
          <CardContent inset="hero">
            <p className="text-sm text-muted-foreground">Total balance</p>
            <p className="text-4xl leading-none font-semibold tabular-nums">$5,985.08</p>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" className="duration-(--motion-duration-slow)">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add money
          </Button>
          <Button size="touch" variant="outline">Send</Button>
        </div>
      </div>
    </div>
  );
  return (
    <DemoFrame {...board} label="Your brand">
      {admin ? (
        <div className="grid gap-5">
          <p className="text-2xl font-semibold tracking-tight">Brand</p>
          <Card variant="flush">
            <CardContent inset="list">
              <dl>
                {(["displayName", "primaryColor", "backgroundColor"] as const).map((field) => (
                  <div key={field} className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                    <dt className="text-muted-foreground">{brandFieldLabels[field]}</dt>
                    <dd className="grid text-end font-medium">
                      <span className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", operator && "-translate-y-1 opacity-0")}>{BRAND_DEFAULTS[field]}</span>
                      <span className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", !operator && "translate-y-1 opacity-0")}>{operatorBrand[field]}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <div className="mx-auto w-full max-w-xs">{preview}</div>
        </div>
      ) : preview}
    </DemoFrame>
  );
}
