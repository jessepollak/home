"use client";

import { Banknote, PiggyBank, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { GlyphMark } from "@/components/currency-mark";
import { ActivityRow, BalanceRow } from "@/components/finance-rows";
import { ManagementFacts } from "@/components/management-facts";
import { MoneyTicker } from "@/components/money-ticker";
import { MoneyBreakdownLegend, SignedBalanceBar } from "@/components/signed-balance-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PayoutMark } from "@/components/ui/payout-mark";
import { ResultHeader } from "@/components/ui/result-header";
import { StatusStep, StatusSteps, type StepStatus } from "@/components/ui/status-step";
import { StatusMark } from "@/components/ui/status-texture";
import { cn } from "@/lib/utils";
import { BRAND_DEFAULTS, type BrandSettings } from "@/shared/operator-branding/schema";
import { brandCopyName, deriveBrandTheme } from "@/shared/operator-branding/theme";
import type { MoneyBreakdownItem } from "@/shared/balances/present";
import { DemoFrame } from "./demo-frame";
import { useStoryboard } from "./use-storyboard";

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

export function SendDemo() {
  const board = useStoryboard(sendHolds);
  const sent = board.step >= 2;
  const confirmed = board.step === 3;
  return (
    <DemoFrame {...board} label="Send">
      <Card className="grid p-4">
        <div className={cn("col-start-1 row-start-1 flex flex-col gap-5 transition-[opacity,translate] duration-base ease-standard", sent && "-translate-y-2 opacity-0")}>
          <p className="text-center text-base font-semibold">Confirm</p>
          <div className="flex flex-col items-center gap-1">
            <p className="text-4xl leading-none font-semibold tabular-nums">$25.00</p>
            <p className="text-sm text-muted-foreground">You&apos;re sending USDC</p>
          </div>
          <Card variant="flush">
            <CardContent className="py-1">
              <ManagementFacts rows={[["From", "0x1111…1111"], ["To", "0x2211…7DA9"], ["Network", "Base"], ["Network fee", "Up to 0.02 USDC · ≈ $0.02"]]} />
            </CardContent>
          </Card>
          <Button size="touch" loading={board.step === 1}>Send $25.00</Button>
        </div>
        <div className={cn("col-start-1 row-start-1 flex flex-col gap-5 transition-[opacity,translate] duration-base ease-standard", sent ? "opacity-100" : "translate-y-2 opacity-0")}>
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <ResultHeader
              outcome={confirmed ? "success" : "pending"}
              title={confirmed ? "$25.00 sent" : "$25.00 on its way"}
              description={confirmed ? "Track it in Activity." : "We'll update Activity when it's confirmed."}
            />
            <div className="w-full">
              <StatusSteps>
                <StatusStep status="complete" title="Submitted" time="11:42 AM" />
                <StatusStep status={confirmed ? "complete" : "current"} title={confirmed ? "Confirmed on Base" : "Confirming on Base"} />
              </StatusSteps>
            </div>
          </div>
          <Button size="touch">Done</Button>
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
                context="4.10% APY"
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

const cashOutSteps: Record<number, [StepStatus, StepStatus, StepStatus]> = {
  0: ["complete", "current", "upcoming"],
  1: ["complete", "complete", "current"],
  2: ["complete", "complete", "complete"],
};

export function CashOutDemo() {
  const board = useStoryboard(cashOutHolds);
  const [sent, matched, paid] = cashOutSteps[board.step] ?? cashOutSteps[2]!;
  const settled = paid === "complete";
  return (
    <DemoFrame {...board} label="Cash out">
      <div className="flex flex-col gap-3">
        <Card variant="flush">
          <CardContent inset="list">
            <ul className="list-none p-0">
              <ActivityRow
                icon={<PayoutMark variant="cashapp">$</PayoutMark>}
                iconTone="mark"
                label="Cash out to Cash App"
                context={settled ? "Sep 28, 11:24 AM" : matched === "complete" ? "Buyer paying you" : "Waiting for a buyer"}
                value="−$50"
                onActivate={noop}
                activateLabel="View Cash out to Cash App details"
                {...(settled ? {} : { working: "Cashing out" })}
              />
            </ul>
          </CardContent>
        </Card>
        <StatusSteps>
          <StatusStep status={sent} title="Sent from your balance" time="Sep 28, 11:16 AM" />
          <StatusStep status={matched} title="Matched with a buyer" time={matched === "complete" ? "Sep 28, 11:19 AM" : undefined} />
          <StatusStep status={paid} title="Paid out" time="To your Cash App" />
        </StatusSteps>
      </div>
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
              context={complete ? "Sep 28, 10:49 AM" : "Arriving on Base"}
              value="+$200.00"
              valueTone={complete ? "success" : "default"}
              onActivate={noop}
              activateLabel="View Add money details"
              {...(complete ? {} : { working: "Arriving on Base" })}
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

export function BrandDemo() {
  const board = useStoryboard(brandHolds);
  const operator = board.step === 1;
  const settings = operator ? operatorBrand : BRAND_DEFAULTS;
  return (
    <DemoFrame {...board} label="Your brand">
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
    </DemoFrame>
  );
}
