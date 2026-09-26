import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  ArrowLeft, ArrowLeftRight, Banknote, ChartNoAxesCombined, ChevronRight,
  Circle, CircleAlert, CircleCheck, CircleX, Clock3, CreditCard, Eye, House, Info,
  LoaderCircle, Lock, Plus, RotateCcw, Settings, SmartphoneNfc, Undo2,
} from "lucide-react";
import { HomeSectionHeading } from "@/client/home/home-overview";
import { HomeHeaderStatus, headerStatus } from "@/client/home/home-status";
import { ShimmerRows } from "@/client/home/panel-shared";
import { useHomeToast } from "@/client/home/use-home-toast";
import { GlyphMark } from "@/components/currency-mark";
import { HomeMark } from "@/components/home-mark";
import { ProfileMark } from "@/components/profile-mark";
import { ActivityRow, BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import {
  shellChromeCompensationClassName, shellContentFrameClassName, shellWidthClassName,
} from "@/components/shell-layout";
import { Alert, AlertIcon, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/toast";
import { formatFiatAmount } from "@/shared/formatting/money";

const noop = () => undefined;
const actions = {
  onOpenAddMoney: fn(), onOpenSecureView: fn(), onTryAgain: fn(),
  onGetCard: fn(), onVerify: fn(), onOpenAccount: fn(), onAddToWallet: fn(), onOpenCash: fn(),
  onReplaceCard: fn(), onCancelCard: fn(),
};

type Variant =
  | "active" | "locked" | "low" | "loading" | "not-issued"
  | "verify" | "verify-review" | "region" | "wallet-eligible" | "wallet-added";
type Detail =
  | "card" | "pending" | "settled" | "netflix" | "declined-locked"
  | "declined-insufficient" | "refund" | "reversal" | "help" | "replace" | "cancel";
type Event = {
  id: Detail;
  merchant: string;
  context: string;
  amount: string;
  tone?: "default" | "success" | "muted";
};
const events: Event[] = [
  { id: "pending", merchant: "Blue Bottle Coffee", context: "Pending · Today", amount: "−$6.50" },
  { id: "settled", merchant: "Whole Foods Market", context: "Today", amount: "−$42.18" },
  { id: "declined-locked", merchant: "Lyft", context: "Declined · Yesterday", amount: "$18.20", tone: "muted" },
  { id: "refund", merchant: "Apple", context: "Refund · Sep 20", amount: "+$9.99", tone: "success" },
  { id: "reversal", merchant: "Grand Hotel", context: "Reversed · Sep 19", amount: "$100.00", tone: "muted" },
  { id: "netflix", merchant: "Netflix", context: "Sep 18", amount: "−$11.99" },
];

function CardArt({ locked, size = "sm" }: { locked: boolean; size?: "sm" | "lg" }) {
  return (
    <div
      aria-label={`Virtual card ending 4821${locked ? ", locked" : ""}`}
      role="img"
      className={`relative flex shrink-0 flex-col justify-between rounded-lg border ${
        size === "lg" ? "h-44 w-70 p-4" : locked ? "h-15 w-24 p-1" : "h-15 w-24 p-2.5"
      } ${locked ? "border-border bg-muted text-foreground/75" : "border-foreground bg-foreground text-background"}`}
    >
      <div className="flex items-start justify-between">
        {locked ? (
          size === "sm" ? <Badge variant="secondary"><Lock aria-hidden="true" />Locked</Badge> : null
        ) : <span className="size-3 rounded-sm bg-primary" aria-hidden="true" />}
        {size === "lg" ? <span className="text-xs">Virtual</span> : null}
      </div>
      {locked && size === "lg" ? (
        <Badge variant="secondary" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Lock aria-hidden="true" />Locked
        </Badge>
      ) : null}
      <span className={`font-mono ${size === "lg" ? "text-sm" : "text-xs"}`}>•••• 4821</span>
    </div>
  );
}

function CardNavigation() {
  return (
    <div className={`order-2 w-full shrink-0 bg-background pb-[var(--shell-safe-area-bottom)] sm:order-1 sm:pb-0 ${
      shellChromeCompensationClassName
    }`}>
      <nav
        aria-label="Main navigation"
        className={`${shellWidthClassName} relative grid min-h-shell-mobile-navigation grid-cols-3 border-t sm:border-x sm:border-b`}
      >
        {([
          { label: "Home", Icon: House },
          { label: "Card", Icon: CreditCard },
          { label: "Invest", Icon: ChartNoAxesCombined },
        ] as const).map(({ label, Icon }) => (
          <Button
            key={label} variant="navigation" size="lg" className="h-full min-h-11 min-w-0"
            aria-current={label === "Card" ? "page" : undefined} onClick={noop}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Button>
        ))}
        <span className="pointer-events-none absolute bottom-1 left-1/3 w-1/3 px-6" aria-hidden="true">
          <span className="block h-0.5 rounded-full bg-primary" />
        </span>
      </nav>
    </div>
  );
}

function LockRow({
  locked, disabled, onChange, help = false,
}: {
  locked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  help?: boolean;
}) {
  return (
    <li>
      <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${disabled ? "cursor-not-allowed" : ""}`}>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <Lock className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Lock card</span>
          <span className="block text-sm text-muted-foreground">
            {disabled ? "Unavailable right now" : locked ? "New purchases are declined" : help ? "Stop new purchases now" : "Pause new purchases"}
          </span>
        </span>
        <Switch checked={locked} disabled={disabled} onCheckedChange={onChange} />
      </label>
    </li>
  );
}

function DetailRows({ rows }: { rows: [string, string][] }) {
  return (
    <Card variant="flush">
      <CardContent inset="list">
        <dl>
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-h-11 items-center justify-between gap-3 px-3 py-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ActionRow({ label, context, icon, trailing = "chevron", onActivate, disabled = false }: {
  label: string; context: string; icon?: ReactNode; trailing?: "chevron" | "plus" | "none";
  onActivate?: () => void; disabled?: boolean;
}) {
  return (
    <li>
      <Item className="flex-nowrap items-center gap-3 py-2" render={onActivate ? (
        <Button type="button" variant="ghost" press="none" onClick={onActivate} disabled={disabled} />
      ) : undefined}>
        {icon ? <ItemMedia variant="avatar" aria-hidden="true">{icon}</ItemMedia> : null}
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle>{label}</ItemTitle>
          <ItemDescription lines={1}>{disabled ? "Unavailable right now" : context}</ItemDescription>
        </ItemContent>
        {onActivate && trailing !== "none" ? (
          <ItemActions aria-hidden="true">
            {trailing === "plus" ? <Plus className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
          </ItemActions>
        ) : null}
      </Item>
    </li>
  );
}

function HelpOptions({ locked, setLocked, outage, setDetail }: {
  outage: boolean; locked: boolean; setLocked: (locked: boolean) => void;
  setDetail: (detail: Detail) => void;
}) {
  return (
    <Card variant="flush">
      <CardContent inset="list">
        <ul className="list-none p-0">
          <LockRow locked={locked} disabled={outage} onChange={setLocked} help />
          <ActionRow icon={<GlyphMark size="sm"><CreditCard /></GlyphMark>}
            label="Replace card" context="Get a new number if this wasn't you"
            disabled={outage} onActivate={() => setDetail("replace")} />
        </ul>
      </CardContent>
    </Card>
  );
}

type PurchaseStatus = "Completed" | "Pending" | "Declined" | "Refunded" | "Reversed";

const purchaseStatusIcon: Record<PurchaseStatus, ReactNode> = {
  Completed: <CircleCheck aria-hidden="true" />,
  Pending: <Clock3 aria-hidden="true" />,
  Declined: <CircleX aria-hidden="true" />,
  Refunded: <Undo2 aria-hidden="true" />,
  Reversed: <RotateCcw aria-hidden="true" />,
};

type PurchaseData = {
  title: string;
  amount: string;
  badge: PurchaseStatus;
  rows: [string, string][];
  alert?: { icon: ReactNode; title: string; description: string; destructive?: boolean };
};
const detailData: Record<Exclude<Detail, "card" | "help" | "replace" | "cancel">, PurchaseData> = {
  "declined-locked": {
    title: "Lyft", amount: "$18.20", badge: "Declined",
    rows: [["Date", "Yesterday, 8:14 PM"], ["Card", "•••• 4821"]],
    alert: {
      icon: <Lock className="size-4" aria-hidden="true" />,
      title: "Declined because your card was locked", description: "Nothing was charged.", destructive: true,
    },
  },
  "declined-insufficient": {
    title: "Whole Foods Market", amount: "$64.10", badge: "Declined",
    rows: [["Date", "Today, 6:02 PM"], ["Available then", "$8.40"], ["Card", "•••• 4821"]],
    alert: {
      icon: <CircleAlert className="size-4" aria-hidden="true" />,
      title: "Not enough available to spend", description: "Nothing was charged. Add money and try again.", destructive: true,
    },
  },
  pending: {
    title: "Blue Bottle Coffee", amount: "−$6.50", badge: "Pending",
    rows: [["Date", "Today, 9:41 AM"], ["Held from", "Cash"], ["Card", "•••• 4821"]],
    alert: {
      icon: <Clock3 className="size-4" aria-hidden="true" />,
      title: "Waiting for the merchant",
      description: "Most purchases settle within 3 days. If this one doesn’t, the $6.50 is released.",
    },
  },
  refund: {
    title: "Apple", amount: "+$9.99", badge: "Refunded",
    rows: [["Refunded to", "Cash"], ["Date", "Sep 20, 9:02 AM"],
      ["Original purchase", "Sep 12 · −$9.99"], ["Card", "•••• 4821"]],
  },
  reversal: {
    title: "Grand Hotel", amount: "$100.00", badge: "Reversed",
    rows: [["Released to", "Cash"], ["Held", "Sep 17"], ["Released", "Sep 19"], ["Card", "•••• 4821"]],
  },
  settled: {
    title: "Whole Foods Market", amount: "−$42.18", badge: "Completed",
    rows: [["Date", "Today, 10:02 AM"], ["Paid from", "Cash"], ["Card", "•••• 4821"]],
  },
  netflix: {
    title: "Netflix", amount: "−$11.99", badge: "Completed",
    rows: [["Date", "Sep 18, 11:20 AM"], ["Paid from", "Cash"], ["Card", "•••• 4821"]],
  },
};

function PurchaseDetails({ detail, data }: { detail: Detail; data: PurchaseData }) {
  return (
    <>
      <div className="flex flex-col items-center gap-2 pb-3">
        <p className={`text-4xl font-semibold tabular-nums ${detail === "refund" ? "text-market-gain" : ""}`}>
          {data.amount}
        </p>
        <Badge variant="secondary">
          {purchaseStatusIcon[data.badge]}
          {data.badge}
        </Badge>
      </div>
      {data.alert ? (
        <Alert variant={data.alert.destructive ? "destructive" : "default"}>
          <AlertIcon>{data.alert.icon}</AlertIcon>
          <AlertTitle>{data.alert.title}</AlertTitle>
          <AlertDescription>
            {data.alert.destructive ? <span className="text-foreground">{data.alert.description}</span> : data.alert.description}
          </AlertDescription>
        </Alert>
      ) : null}
      <DetailRows rows={data.rows} />
    </>
  );
}

function CardDetailSheet({
  detail: openDetail, setDetail, locked, setLocked, helpPurchase, outage,
}: {
  detail: Detail | null;
  setDetail: (detail: Detail | null) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
  helpPurchase: string;
  outage: boolean;
}) {
  const [lastDetail, setLastDetail] = useState<Detail | null>(openDetail);
  if (openDetail !== null && openDetail !== lastDetail) setLastDetail(openDetail);
  const detail = openDetail ?? lastDetail;
  const data = detail && detail !== "card" && detail !== "help" && detail !== "replace" && detail !== "cancel"
    ? detailData[detail] : null;
  const showUnlock = detail === "declined-locked" && locked && !outage;
  return (
    <Drawer open={openDetail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="items-center">
          <DrawerTitle>
            {detail === "card" ? "Card details" : detail === "help" ? "Get help with this purchase"
              : detail === "replace" ? "Replace card?" : detail === "cancel" ? "Cancel card?" : data?.title}
          </DrawerTitle>
          {detail === "help" ? <DrawerDescription>{helpPurchase}</DrawerDescription> : null}
          {detail === "replace" ? <DrawerDescription>Your current number stops working now. You&apos;ll get a new number to use instead.</DrawerDescription> : null}
          {detail === "cancel" ? <DrawerDescription>This card stops working for good. Your Cash stays in Home.</DrawerDescription> : null}
        </DrawerHeader>
        {detail !== "replace" && detail !== "cancel" ? (
          <div className={`min-h-0 flex flex-col gap-3 overflow-y-auto px-4 pt-4 ${detail === "help" ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : "pb-1"}`}>
            {detail === "card" ? (
              <>
                <div className="flex justify-center pb-3"><CardArt locked={locked} size="lg" /></div>
                <DetailRows rows={[["Name on card", "Alex Rivera"], ["Type", "Virtual"]]} />
              </>
            ) : null}
            {detail === "help" ? <HelpOptions locked={locked} setLocked={setLocked} outage={outage} setDetail={setDetail} /> : null}
            {data ? <PurchaseDetails detail={detail!} data={data} /> : null}
          </div>
        ) : null}
        {detail !== "help" ? (
          <DrawerFooter>
            {detail === "card" ? (
              <Button className="h-11" disabled={outage} onClick={() => { actions.onOpenSecureView(); setDetail(null); }}>
                <Eye className="size-4" aria-hidden="true" />Show number and CVV
              </Button>
            ) : null}
            {detail === "replace" ? (
              <>
                <Button className="h-11" disabled={outage} onClick={() => { actions.onReplaceCard(); setDetail(null); }}>Replace card</Button>
                <Button variant="ghost" className="h-11" onClick={() => setDetail(null)}>Keep current card</Button>
              </>
            ) : null}
            {detail === "cancel" ? (
              <>
                <Button variant="destructive" className="h-11" disabled={outage} onClick={() => { actions.onCancelCard(); setDetail(null); }}>Cancel card</Button>
                <Button variant="ghost" className="h-11" onClick={() => setDetail(null)}>Keep card</Button>
              </>
            ) : null}
            {showUnlock ? (
              <Button className="h-11" onClick={() => { setLocked(false); setDetail(null); }}>Unlock card</Button>
            ) : null}
            {detail === "declined-insufficient" ? (
              <Button className="h-11" onClick={() => { actions.onOpenAddMoney(); setDetail(null); }}>
                <Plus className="size-4" aria-hidden="true" />Add money
              </Button>
            ) : null}
            {data ? (
              <Button variant={showUnlock || detail === "declined-insufficient" ? "ghost" : "outline"}
                className="h-11" onClick={() => setDetail("help")}>Get help</Button>
            ) : null}
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function CardHero({ availableCents, locked, loading }: {
  availableCents: number; locked: boolean; loading: boolean;
}) {
  return (
    <Card variant="flush" role="group" aria-label="Available to spend" aria-busy={loading || undefined}>
      <CardContent inset="hero">
        <div className="flex min-h-15 flex-wrap items-center justify-between gap-3">
          <div className="shrink-0">
            {loading ? (
              <div className="flex min-h-15 flex-col justify-between"><Skeleton className="h-3 w-30" /><Skeleton className="h-9 w-45" /></div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Available to spend</p>
                <div className="text-4xl font-semibold tabular-nums">
                  <MoneyTicker value={formatFiatAmount(BigInt(availableCents), 2, "USD")} align="start" reserveDigits={false} />
                </div>
              </>
            )}
          </div>
          {loading ? <Skeleton className="h-15 w-24" /> : <CardArt locked={locked} />}
        </div>
      </CardContent>
    </Card>
  );
}

function CardActions({ loading, outage, openDetails }: {
  loading: boolean; outage: boolean; openDetails: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Card actions">
      <Button size="lg" className="h-11" disabled={loading} onClick={actions.onOpenAddMoney}>
        <Plus className="size-4" aria-hidden="true" />Add money
      </Button>
      <Button size="lg" variant="outline" className="h-11" disabled={loading || outage} onClick={openDetails}>
        <Eye className="size-4" aria-hidden="true" />Card details
      </Button>
    </div>
  );
}

function CardAlerts() {
  return (
    <Alert>
      <AlertIcon><Info /></AlertIcon>
      <AlertTitle>Low available to spend</AlertTitle>
      <AlertDescription>Purchases over $8.40 will be declined.</AlertDescription>
    </Alert>
  );
}

function YourCardSection({
  locked, loading, outage, variant, pendingCents, spendableCents, setLocked, openSettings,
}: {
  locked: boolean; loading: boolean; outage: boolean; variant: Variant;
  pendingCents: number; spendableCents: number; setLocked: (next: boolean) => void;
  openSettings: () => void;
}) {
  return (
    <section aria-labelledby="your-card-title">
      <Card className="gap-3">
        <CardHeader><HomeSectionHeading id="your-card-title">Your card</HomeSectionHeading></CardHeader>
        <CardContent inset="list">
          {loading ? <ShimmerRows count={3} /> : (
            <ul className="list-none p-0">
              <LockRow locked={locked} disabled={outage} onChange={setLocked} />
              <BalanceRow
                icon={<GlyphMark size="sm"><Banknote /></GlyphMark>} iconTone="mark"
                label="Spends from Cash" context={`${formatFiatAmount(BigInt(pendingCents), 2, "USD")} pending`}
                value={formatFiatAmount(BigInt(spendableCents), 2, "USD")}
                onActivate={actions.onOpenCash} activateLabel="Open Cash"
              />
              {variant === "wallet-eligible" ? (
                <ActionRow icon={<GlyphMark size="sm"><SmartphoneNfc /></GlyphMark>} label="Add to phone wallet"
                  context="Pay in stores by tapping" trailing="plus" disabled={outage} onActivate={actions.onAddToWallet} />
              ) : null}
              <BalanceRow icon={<Settings className="size-4" />} label="Card settings"
                context={variant === "wallet-eligible" || variant === "wallet-added"
                  ? "Replace, cancel, phone wallet" : "Replace, cancel"}
                onActivate={openSettings} activateLabel="Open Card settings" />
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CardSettingsScreen({ variant, outage, pendingCents, spendableCents, setDetail }: {
  variant: Variant; outage: boolean; pendingCents: number; spendableCents: number;
  setDetail: (detail: Detail) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-labelledby="card-spending-title">
        <div className="px-4"><HomeSectionHeading id="card-spending-title">Spending</HomeSectionHeading></div>
        <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
          <BalanceRow icon={<GlyphMark size="sm"><Banknote /></GlyphMark>} iconTone="mark"
            label="Spends from Cash" context={`${formatFiatAmount(BigInt(pendingCents), 2, "USD")} pending`}
            value={formatFiatAmount(BigInt(spendableCents), 2, "USD")}
            onActivate={actions.onOpenCash} activateLabel="Open Cash" />
        </ul></CardContent></Card>
      </section>
      {variant === "wallet-eligible" || variant === "wallet-added" ? (
        <section className="space-y-2" aria-labelledby="card-wallet-title">
          <div className="px-4"><HomeSectionHeading id="card-wallet-title">Phone wallet</HomeSectionHeading></div>
          <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
            {variant === "wallet-eligible" ? (
              <ActionRow icon={<GlyphMark size="sm"><SmartphoneNfc /></GlyphMark>}
                label="Add to phone wallet" context="Pay in stores by tapping"
                trailing="plus" disabled={outage} onActivate={actions.onAddToWallet} />
            ) : <ActionRow icon={<GlyphMark size="sm"><SmartphoneNfc /></GlyphMark>}
              label="In your phone wallet" context="Ready to tap in stores" trailing="none" />}
          </ul></CardContent></Card>
        </section>
      ) : null}
      <section className="space-y-2" aria-labelledby="card-settings-title">
        <div className="px-4"><HomeSectionHeading id="card-settings-title">Card</HomeSectionHeading></div>
        <Card variant="flush"><CardContent inset="list"><ul className="list-none p-0">
          <ActionRow icon={<GlyphMark size="sm"><CreditCard /></GlyphMark>}
            label="Replace card" context="Lost, stolen or not yours"
            disabled={outage} onActivate={() => setDetail("replace")} />
          <ActionRow icon={<GlyphMark size="sm"><CircleX /></GlyphMark>}
            label="Cancel card" context="Stop this card for good"
            disabled={outage} onActivate={() => setDetail("cancel")} />
        </ul></CardContent></Card>
      </section>
    </div>
  );
}

function CardActivity({ loading, low, openDetail }: {
  loading: boolean; low: boolean; openDetail: (detail: Detail) => void;
}) {
  return (
    <section aria-labelledby="card-activity-title" className="space-y-2">
      <div className="px-4"><HomeSectionHeading id="card-activity-title">Activity</HomeSectionHeading></div>
      {loading ? <ShimmerRows count={3} /> : (
        <ul className="list-none p-0">
          {events.map((event, index) => {
            const insufficient = low && event.id === "settled";
            return (
              <ActivityRow
                key={`${event.id}-${index}`} icon={<CreditCard className="size-4" />}
                label={event.merchant}
                context={insufficient ? "Declined · Today" : event.context}
                value={insufficient ? "$64.10" : event.amount}
                valueTone={insufficient ? "muted" : event.tone}
                onActivate={() => openDetail(insufficient ? "declined-insufficient" : event.id)}
                activateLabel={`Open ${event.merchant} transaction details`}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CardEntryState() {
  return (
    <Card>
      <CardContent>
        <div className="flex h-40 w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground" aria-hidden="true">
          Illustration (#896)
        </div>
        <h2 className="mt-4 text-lg font-semibold">Spend your Cash with a card</h2>
        <ul className="mt-3 flex list-none flex-col gap-3 p-0">
          {([
            [CreditCard, "Spend Cash online, anywhere cards are accepted"],
            [Lock, "Lock it instantly if something looks wrong"],
            [ArrowLeftRight, "See every purchase in Activity"],
            [SmartphoneNfc, "Add it to your phone wallet where supported"],
          ] as const).map(([Icon, text]) => (
            <li key={text} className="flex items-center gap-3 text-sm">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{text}
            </li>
          ))}
        </ul>
        <Button className="mt-4 h-11 w-full" onClick={actions.onGetCard}>Get your card</Button>
      </CardContent>
    </Card>
  );
}

function CardVerification({ review }: { review: boolean }) {
  const steps = [
    { title: "Card requested", state: "complete", time: "Today, 9:38 AM" },
    { title: "Verify your identity", state: review ? "complete" : "current", time: review ? "Today, 9:41 AM" : "Takes about 2 minutes" },
    { title: "Checking your details", state: review ? "current" : "upcoming", time: review ? "Started 9:41 AM" : null },
    { title: "Card ready", state: "upcoming", time: null },
  ] as const;
  return (
    <section className="space-y-4" aria-labelledby="card-progress-title">
      <div className="px-4"><HomeSectionHeading id="card-progress-title">Getting your card</HomeSectionHeading></div>
      <Card><CardContent>
        <ol aria-label="Card progress" className="flex flex-col">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex items-start gap-3 pb-3 last:pb-0" aria-current={step.state === "current" ? "step" : undefined}>
              {step.state === "complete" ? <CircleCheck className="mt-1 size-4 shrink-0" aria-hidden="true" />
                : step.state === "current" ? <LoaderCircle className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                  : <Circle className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              {index < steps.length - 1 ? <span className="absolute top-5 -bottom-1 left-2 w-px bg-border" aria-hidden="true" /> : null}
              <div>
                <p className={step.state === "upcoming" ? "text-muted-foreground" : "text-foreground"}>{step.title}</p>
                {step.time ? <p className="text-sm text-muted-foreground">{step.time}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent></Card>
      {!review ? <Button className="h-11 w-full" onClick={actions.onVerify}>Verify</Button> : null}
    </section>
  );
}

function CardRegionUnavailable() {
  return (
    <Card><CardContent><Empty className="gap-2">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CreditCard aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>Card isn’t available in Canada yet</EmptyTitle>
        <EmptyDescription>Wrong country? Change it in Account.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline" className="h-11" onClick={actions.onOpenAccount}>Open Account</Button></EmptyContent>
    </Empty></CardContent></Card>
  );
}

function CardShellHeader({ nestedTitle, onBack, status }: {
  nestedTitle: string | null; onBack: () => void; status: ReactNode;
}) {
  return (
    <header className={`order-0 w-full shrink-0 bg-background ${shellChromeCompensationClassName}`}>
      <div className={`${shellContentFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}>
        <div className="flex min-w-0 items-center gap-2">
          {nestedTitle ? (
            <div className="flex h-11 w-11 shrink-0 items-center">
              <Button variant="ghost" size="icon" className="size-11" aria-label="Back" onClick={onBack}>
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : <HomeMark compact onClick={noop} />}
          <h1 className="min-w-0 truncate text-base font-semibold">{nestedTitle ?? "Card"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {status}
          <ProfileMark status="ready" ownerKey="profile" address={null} onClick={noop} />
        </div>
      </div>
    </header>
  );
}

function CardProposal({ variant = "active", outage = false }: { variant?: Variant; outage?: boolean }) {
  const [locked, setLockedState] = useState(variant === "locked");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [helpPurchase, setHelpPurchase] = useState("");
  const { add } = useHomeToast("card-proposal");
  function setLocked(next: boolean) {
    setLockedState(next);
    add({ message: next ? "Card locked" : "Card unlocked", tone: "success" });
  }
  function openDetail(next: Detail) {
    if (next !== "card" && next !== "help" && next !== "replace" && next !== "cancel") {
      const purchase = detailData[next];
      setHelpPurchase(`${purchase.title} · ${purchase.amount}`);
    }
    setDetail(next);
  }
  const entry = variant === "not-issued" || variant === "verify" || variant === "verify-review" || variant === "region";
  const low = variant === "low";
  const loading = variant === "loading";
  const spendableCents = low ? 1490 : 150000;
  const pendingCents = 650;
  const status = headerStatus({ interruption: outage ? { kind: "interrupted" } : null, coverage: null });
  return (
    <Toaster>
      <div className="flex h-svh flex-col bg-muted/20">
        <CardShellHeader
          nestedTitle={settingsOpen ? "Card settings" : null} onBack={() => setSettingsOpen(false)}
          status={status ? <HomeHeaderStatus status={status} onRetry={actions.onTryAgain} onOpenAccount={actions.onOpenAccount} /> : null}
        />
        <CardNavigation />
        <main id="navigation-panel" className="order-1 min-h-0 flex-1 overflow-y-auto">
          <div className={`${shellContentFrameClassName} space-y-4 py-4`}>
            {settingsOpen ? (
              <CardSettingsScreen variant={variant} outage={outage} pendingCents={pendingCents} spendableCents={spendableCents}
                setDetail={openDetail} />
            ) : variant === "not-issued" ? <CardEntryState />
              : variant === "verify" || variant === "verify-review" ? <CardVerification review={variant === "verify-review"} />
                : variant === "region" ? <CardRegionUnavailable /> : (
                  <>
                    <CardHero availableCents={spendableCents - pendingCents} locked={locked} loading={loading} />
                    <CardActions loading={loading} outage={outage} openDetails={() => openDetail("card")} />
                    {low ? <CardAlerts /> : null}
                    <YourCardSection locked={locked} loading={loading} outage={outage} variant={variant}
                      pendingCents={pendingCents} spendableCents={spendableCents} setLocked={setLocked}
                      openSettings={() => setSettingsOpen(true)} />
                    <CardActivity loading={loading} low={low} openDetail={openDetail} />
                  </>
                )}
          </div>
        </main>
        {!entry ? <CardDetailSheet detail={detail} setDetail={setDetail} locked={locked}
          setLocked={setLocked} helpPurchase={helpPurchase} outage={outage} /> : null}
      </div>
    </Toaster>
  );
}

const meta = {
  id: "explorations-card",
  title: "Explorations/Card",
  component: CardProposal,
  args: { variant: "active" },
  render: (args) => <CardProposal key={`${args.variant ?? "active"}-${String(args.outage ?? false)}`} {...args} />,
  parameters: {
    layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "todo" },
  },
} satisfies Meta<typeof CardProposal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Available to spend")).toHaveTextContent("$1,493.50");
    await expect(canvas.getByText("Spends from Cash").closest("li")).toHaveTextContent("$1,500.00");
    await expect(canvas.getByText("Spends from Cash").closest("li")).toHaveTextContent("$6.50 pending");
    await expect(canvas.getByRole("button", { name: "Card", current: "page" })).toHaveAttribute("aria-current", "page");
  },
};
export const ActiveDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } } };
export const Locked: Story = {
  args: { variant: "locked" },
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("switch", { name: /^Lock card/ });
    await expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await expect(toggle).not.toBeChecked();
    await expect(await within(canvasElement.ownerDocument.body).findByText("Card unlocked")).toBeVisible();
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
    await expect(await within(canvasElement.ownerDocument.body).findByText("Card locked")).toBeVisible();
  },
};
export const LowAvailable: Story = { args: { variant: "low" } };
export const Outage: Story = {
  args: { outage: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("switch", { name: /^Lock card/ })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByRole("button", { name: "Card details" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Add money" })).toBeEnabled();
    await expect(within(canvas.getByRole("main")).queryByText(/Try again/)).not.toBeInTheDocument();
    actions.onTryAgain.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: /Home can.t refresh right now/ }));
    const popover = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Status" });
    await userEvent.click(within(popover).getByRole("button", { name: "Retry" }));
    await expect(actions.onTryAgain).toHaveBeenCalledTimes(1);
  },
};
export const Loading: Story = { args: { variant: "loading" } };
export const NotIssued: Story = {
  args: { variant: "not-issued" },
  play: async ({ canvasElement }) => {
    actions.onGetCard.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Get your card" }));
    await expect(actions.onGetCard).toHaveBeenCalledTimes(1);
  },
};
export const VerificationRequired: Story = {
  args: { variant: "verify" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Verify your identity").closest("li")).toHaveAttribute("aria-current", "step");
    actions.onVerify.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
    await expect(actions.onVerify).toHaveBeenCalledTimes(1);
  },
};
export const VerificationInReview: Story = {
  args: { variant: "verify-review" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Checking your details").closest("li")).toHaveAttribute("aria-current", "step");
    await expect(canvas.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  },
};
export const RegionUnavailable: Story = { args: { variant: "region" } };
export const WalletEligible: Story = {
  args: { variant: "wallet-eligible" },
  play: async ({ canvasElement }) => {
    actions.onAddToWallet.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Add to phone wallet/ }));
    await expect(actions.onAddToWallet).toHaveBeenCalledTimes(1);
  },
};
export const WalletAdded: Story = {
  args: { variant: "wallet-added" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("In your phone wallet")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Card settings/ }));
    await expect(canvas.getByText("In your phone wallet")).toBeVisible();
  },
};
export const CardSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Card settings/ }));
    await expect(canvas.getByRole("heading", { name: "Card settings" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await expect(canvas.getByText("Your card")).toBeVisible();
  },
};
export const ReplaceCard: Story = {
  play: async ({ canvasElement }) => {
    actions.onReplaceCard.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Card settings/ }));
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Replace card/ }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Replace card?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Replace card" }));
    await expect(actions.onReplaceCard).toHaveBeenCalledTimes(1);
  },
};
export const CancelCard: Story = {
  play: async ({ canvasElement }) => {
    actions.onCancelCard.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Card settings/ }));
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Cancel card/ }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Cancel card?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel card" }));
    await expect(actions.onCancelCard).toHaveBeenCalledTimes(1);
  },
};
export const OutageCardSettings: Story = {
  args: { variant: "wallet-eligible", outage: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Card settings/ }));
    await expect(canvas.getByRole("button", { name: /Replace card/ })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: /Add to phone wallet/ })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: /Cancel card/ })).toBeDisabled();
    await expect(canvas.getAllByText("Unavailable right now")).toHaveLength(3);
  },
};
export const CardDetails: Story = {
  play: async ({ canvasElement }) => {
    actions.onOpenSecureView.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Card details" }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Card details" });
    await expect(within(dialog).getByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
    await expect(within(dialog).getByText("Alex Rivera")).toBeVisible();
    await expect(canvasElement.ownerDocument.body.textContent).not.toMatch(/\d{13,19}/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Show number and CVV" }));
    await expect(actions.onOpenSecureView).toHaveBeenCalledTimes(1);
  },
};
export const DeclinedLocked: Story = {
  args: { variant: "locked" },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Lyft/ }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Lyft" });
    await expect(within(dialog).getByText("Declined because your card was locked")).toBeVisible();
    await expect(within(dialog).getByText("Nothing was charged.")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Unlock card" }));
    await expect(within(canvasElement).getByRole("switch", { name: /^Lock card/ })).not.toBeChecked();
  },
};
export const DeclinedInsufficient: Story = {
  args: { variant: "low" },
  play: async ({ canvasElement }) => {
    actions.onOpenAddMoney.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Whole Foods Market/ }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Whole Foods Market" });
    await expect(within(dialog).getByText("Not enough available to spend")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add money" }));
    await expect(actions.onOpenAddMoney).toHaveBeenCalledTimes(1);
  },
};
export const PendingPurchase: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Blue Bottle Coffee/ }));
    await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Blue Bottle Coffee" })).toBeVisible();
  },
};
export const SettledPurchase: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Whole Foods Market/ }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Whole Foods Market" });
    await expect(within(dialog).getByText("Completed")).toBeVisible();
    await expect(within(dialog).getByText("Paid from")).toBeVisible();
  },
};
export const Refund: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Apple/ }));
    await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Apple" })).toBeVisible();
  },
};
export const Reversal: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Grand Hotel/ }));
    await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Grand Hotel" })).toBeVisible();
  },
};
export const GetHelp: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Blue Bottle Coffee/ }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(await body.findByRole("dialog", { name: "Blue Bottle Coffee" }))
      .getByRole("button", { name: "Get help" }));
    const dialog = await body.findByRole("dialog", { name: "Get help with this purchase" });
    await expect(within(dialog).getByText("Blue Bottle Coffee · −$6.50")).toBeVisible();
    await expect(within(dialog).getByRole("switch", { name: /^Lock card/ })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: /Replace card/ })).toBeVisible();
    await expect(within(dialog).queryByText("Wrong amount")).not.toBeInTheDocument();
    await expect(within(dialog).getByText("Stop new purchases now")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("switch", { name: /^Lock card/ }));
    await expect(within(dialog).getByText("New purchases are declined")).toBeVisible();
    await expect(within(dialog).queryByText("Stop new purchases now")).not.toBeInTheDocument();
  },
};
export const OutageGetHelp: Story = {
  args: { outage: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Blue Bottle Coffee/ }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(await body.findByRole("dialog", { name: "Blue Bottle Coffee" }))
      .getByRole("button", { name: "Get help" }));
    const dialog = await body.findByRole("dialog", { name: "Get help with this purchase" });
    await expect(within(dialog).getByRole("switch", { name: /^Lock card/ })).toHaveAttribute("aria-disabled", "true");
    await expect(within(dialog).getByRole("button", { name: /Replace card/ })).toBeDisabled();
    await expect(within(dialog).getAllByText("Unavailable right now")).toHaveLength(2);
  },
};
