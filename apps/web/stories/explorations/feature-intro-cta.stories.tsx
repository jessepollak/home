import { useId, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  ArrowLeft, ArrowUpFromLine, Banknote, ChartNoAxesCombined, CreditCard, House,
  LoaderCircle, Lock, LockOpen, Percent, ReceiptText, Sparkles, Store, type LucideIcon,
} from "lucide-react";
import { HomeMark } from "@/components/home-mark";
import { MoneyTicker } from "@/components/money-ticker";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { ProfileMark } from "@/components/profile-mark";
import {
  shellChromeCompensationClassName, shellContentFrameClassName, shellScrollContainerClassName, shellWidthClassName,
} from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerTitle,
} from "@/components/ui/drawer";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

type Benefit = { icon: LucideIcon; text: string };
type Action = { label: string; onClick: () => void };
type FeatureIntroProps = {
  headline: string;
  description?: string;
  benefits: [Benefit, Benefit] | [Benefit, Benefit, Benefit] | [Benefit, Benefit, Benefit, Benefit];
  primary: Action & { pending?: boolean };
  secondary?: Action;
  illustration?: boolean;
  illustrationSubject?: "card" | "savings";
  icon?: LucideIcon;
  availability?: { kind: "available" } | {
    kind: "unavailable";
    reason: string;
    recovery?: Action;
  };
};
type Alternative = "a" | "b" | "c";
type Scenario = "card" | "pending" | "loading" | "verify" | "region" | "long" | "no-illustration" | "save";
type WorkshopProps = {
  alternative?: Alternative;
  presentation?: "inline" | "sheet";
  scenario?: Scenario;
  shell?: "card" | "save";
  compare?: boolean;
};

const actions = {
  getCard: fn(), verify: fn(), getStarted: fn(), notNow: fn(),
};
const noOp = () => undefined;

function introProps(scenario: Scenario): FeatureIntroProps {
  if (scenario === "save") {
    return {
      headline: "Start saving",
      benefits: [
        { icon: Percent, text: "Earn interest on USDC" },
        { icon: ArrowUpFromLine, text: "Withdraw anytime" },
        { icon: LockOpen, text: "No lockups" },
      ],
      primary: { label: "Get started", onClick: actions.getStarted },
      illustration: true,
      illustrationSubject: "savings",
      icon: Percent,
    };
  }
  const props: FeatureIntroProps = {
    headline: "Earn 4.20% APY on Cash",
    icon: CreditCard,
    benefits: [
      { icon: Store, text: "Pay in stores and online" },
      { icon: Lock, text: "Lock it anytime" },
      { icon: Banknote, text: "Spend straight from your balance" },
    ],
    primary: { label: "Get your card", onClick: actions.getCard },
    illustration: scenario !== "no-illustration",
  };
  if (scenario === "pending") props.primary.pending = true;
  if (scenario === "verify") {
    props.availability = {
      kind: "unavailable", reason: "Verify your identity to get a card.",
      recovery: { label: "Verify", onClick: actions.verify },
    };
  }
  if (scenario === "region") {
    props.availability = {
      kind: "unavailable", reason: "Card isn’t available in Canada yet.",
    };
  }
  if (scenario === "long") {
    props.headline = "Make everyday spending safer";
    props.description = "See how your Cash works with a card before you decide if it fits your needs now.";
    props.benefits = [
      { icon: CreditCard, text: "Pay in stores and online safely." },
      { icon: Lock, text: "Lock your card whenever you need" },
      { icon: Banknote, text: "Spend straight from your balance" },
      { icon: ReceiptText, text: "Track every purchase as it lands" },
    ];
  }
  return props;
}

function Illustration() {
  return (
    <div aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted">
      <Sparkles className="size-5 text-muted-foreground" />
    </div>
  );
}

function Sparkle({ x, y, arm }: { x: number; y: number; arm: number }) {
  return (
    <g stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
      <path d={`M${x - arm} ${y} H${x + arm} M${x} ${y - arm} V${y + arm}`} />
    </g>
  );
}

function LinePlaneIllustration({ subject }: { subject: "card" | "savings" }) {
  const clipId = useId();
  return (
    <svg viewBox="0 0 240 160" aria-hidden="true" focusable="false" className="block aspect-[3/2] w-full">
      {subject === "card" ? (
        <>
          <ellipse cx="124" cy="138" rx="52" ry="4" fill="var(--muted)" />
          <g transform="rotate(6 129 83)">
            <path d="M164 41 H186.8 A6.2 6.2 0 0 1 193 47.2 V118.8 A6.2 6.2 0 0 1 186.8 125 H71.2 A6.2 6.2 0 0 1 65 118.8" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <g transform="rotate(-8 111 69)">
            <rect x="47" y="27" width="128" height="84" rx="7.2" fill="var(--primary)" />
            <path d="M66 45 H84 A1 1 0 0 1 85 46 V59 A1 1 0 0 1 84 60 H66 A1 1 0 0 1 65 59 V46 A1 1 0 0 1 66 45 Z" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M155.24 48.76 A6 6 0 0 1 155.24 57.24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M158.07 45.93 A10 10 0 0 1 158.07 60.07" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M160.9 43.1 A14 14 0 0 1 160.9 62.9" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <Sparkle x={194} y={28} arm={7} />
          <Sparkle x={44} y={136} arm={5} />
        </>
      ) : (
        <>
          <defs><clipPath id={clipId}><rect x="0" y="0" width="240" height="129" /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <path d="M143 129 V63.4 A2.4 2.4 0 0 1 145.4 61 H170.6 A2.4 2.4 0 0 1 173 63.4 V129 Z" fill="var(--balance-savings)" />
          </g>
          <path d="M41 129 H196" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M68 129 V106.4 A1.4 1.4 0 0 1 69.4 105 H94.6 A1.4 1.4 0 0 1 96 106.4 V129" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M106 129 V86.4 A1.4 1.4 0 0 1 107.4 85 H132.6 A1.4 1.4 0 0 1 134 86.4 V129" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 97 Q110 45 178 35" fill="none" stroke="var(--balance-savings)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M178 35 L170.9 31.4 L178 35 L172.2 40.5" fill="none" stroke="var(--balance-savings)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <Sparkle x={194} y={47} arm={6} />
        </>
      )}
    </svg>
  );
}

function IntroActions({ primary, secondary, availability }: Pick<FeatureIntroProps, "primary" | "secondary" | "availability">) {
  const reasonId = useId();
  if (availability?.kind === "unavailable") {
    return (
      <div className="w-full space-y-2">
        <p id={reasonId} className="text-center text-sm text-muted-foreground">{availability.reason}</p>
        {availability.recovery ? (
          <Button className="h-11 w-full" aria-describedby={reasonId} onClick={availability.recovery.onClick}>
            {availability.recovery.label}
          </Button>
        ) : null}
        {secondary ? (
          <Button variant="ghost" className="h-11 w-full" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="w-full space-y-2">
      <Button className="h-11 w-full" disabled={primary.pending} aria-busy={primary.pending || undefined} onClick={primary.onClick}>
        {primary.pending ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
        {primary.label}
      </Button>
      {secondary ? (
        <Button variant="ghost" className="h-11 w-full" onClick={secondary.onClick}>
          {secondary.label}
        </Button>
      ) : null}
    </div>
  );
}

function IntroBody({ alternative, props, sheet = false, hero = "inline" }: { alternative: Alternative; props: FeatureIntroProps; sheet?: boolean; hero?: "inline" | "sheet" | "compact" }) {
  const controls = <IntroActions primary={props.primary} secondary={props.secondary} availability={props.availability} />;
  const FallbackIcon = props.icon ?? CreditCard;
  if (alternative === "a") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant={props.illustration ? "default" : "icon"}>
            {props.illustration ? <Illustration /> : <FallbackIcon aria-hidden="true" />}
          </EmptyMedia>
          {sheet ? <DrawerTitle>{props.headline}</DrawerTitle> : <EmptyTitle><h2>{props.headline}</h2></EmptyTitle>}
          {props.description ? sheet ? <DrawerDescription>{props.description}</DrawerDescription> : <EmptyDescription>{props.description}</EmptyDescription> : null}
        </EmptyHeader>
        <EmptyContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {props.benefits.map(({ text }) => <li key={text}>{text}</li>)}
          </ul>
          {!sheet ? controls : null}
        </EmptyContent>
      </Empty>
    );
  }
  if (alternative === "b") {
    return (
      <div className="space-y-5">
        <div className={`flex justify-between gap-4 ${props.description ? "items-start" : "items-center"}`}>
          <div className="min-w-0 space-y-2">
            {sheet ? <DrawerTitle>{props.headline}</DrawerTitle> : <h2 className="text-xl font-semibold">{props.headline}</h2>}
            {props.description ? sheet ? <DrawerDescription>{props.description}</DrawerDescription> : <p className="text-sm text-muted-foreground">{props.description}</p> : null}
          </div>
          {props.illustration ? <Illustration /> : null}
        </div>
        <ul>
          {props.benefits.map(({ icon: Icon, text }) => (
            <li key={text}>
              <Item size="sm">
                <ItemMedia variant="icon"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></ItemMedia>
                <ItemContent className="min-w-0"><ItemTitle truncate={false} className="whitespace-normal">{text}</ItemTitle></ItemContent>
              </Item>
            </li>
          ))}
        </ul>
        {!sheet ? controls : null}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {props.illustration ? (
        <div className={hero === "compact" ? "mx-auto w-full max-w-40" : hero === "sheet" ? "mx-auto w-full max-w-70" : "mx-auto w-full max-w-60"}>
          <LinePlaneIllustration subject={props.illustrationSubject ?? "card"} />
        </div>
      ) : null}
      <div className="space-y-2">
        {sheet ? <DrawerTitle className="text-center text-2xl leading-8 text-balance">{props.headline}</DrawerTitle> : <h2 className="text-center text-2xl font-semibold text-balance">{props.headline}</h2>}
        {props.description ? sheet ? <DrawerDescription className="text-center">{props.description}</DrawerDescription> : <p className="text-center text-sm text-muted-foreground">{props.description}</p> : null}
      </div>
      <ul className="space-y-1 rounded-lg border px-3 py-1">
        {props.benefits.map(({ icon: Icon, text }) => (
          <li key={text}>
            <Item size="sm" className="px-0">
              <ItemMedia variant="avatar"><Icon aria-hidden="true" /></ItemMedia>
              <ItemContent className="min-w-0"><ItemTitle truncate={false} className="whitespace-normal">{text}</ItemTitle></ItemContent>
            </Item>
          </li>
        ))}
      </ul>
      {!sheet ? controls : null}
    </div>
  );
}

function InlineIntro({ alternative, props }: { alternative: Alternative; props: FeatureIntroProps }) {
  return <Card><CardContent><IntroBody alternative={alternative} props={props} /></CardContent></Card>;
}

function IntroSkeleton({ sheet = false, hero = "inline" }: { sheet?: boolean; hero?: "inline" | "compact" }) {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className={hero === "compact" ? "mx-auto aspect-[3/2] w-full max-w-40" : sheet ? "mx-auto aspect-[3/2] w-full max-w-70" : "mx-auto aspect-[3/2] w-full max-w-60"} />
      <Skeleton className="mx-auto h-8 w-56" />
      <div className="space-y-1 rounded-lg border px-3 py-1">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex items-center gap-2.5 py-2.5">
            <Skeleton className="size-7 rounded-full" /><Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
      {!sheet ? <Skeleton className="h-11 w-full" /> : null}
    </div>
  );
}

function LoadingIntro({ hero }: { hero?: "inline" | "compact" }) {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading introduction">
      <CardContent><IntroSkeleton hero={hero} /></CardContent>
    </Card>
  );
}

function SheetIntro({ alternative, props, loading = false }: { alternative: Alternative; props: FeatureIntroProps; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const secondary: Action = { label: "Not now", onClick: () => { actions.notNow(); setOpen(false); } };
  return (
    <>
      <Button variant="outline" className="h-11" onClick={() => setOpen(true)}>Open introduction</Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          {loading ? (
            <>
              <DrawerTitle className="sr-only">Feature introduction</DrawerTitle>
              <DrawerDescription className="sr-only">The introduction is loading.</DrawerDescription>
            </>
          ) : null}
          <div className="min-h-0 overflow-y-auto px-4 pt-4" role={loading ? "status" : undefined}
            aria-busy={loading || undefined} aria-label={loading ? "Loading introduction" : undefined}>
            {loading ? <IntroSkeleton sheet /> : <IntroBody alternative={alternative} props={props} sheet hero="sheet" />}
          </div>
          <DrawerFooter>
            {loading ? (
              <>
                <Skeleton className="h-11 w-full" aria-hidden="true" />
                <Button variant="ghost" className="h-11 w-full" onClick={secondary.onClick}>Not now</Button>
              </>
            ) : <IntroActions primary={props.primary} secondary={secondary} availability={props.availability} />}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function CardNavigation() {
  return (
    <div className={`order-2 w-full shrink-0 bg-background pb-[var(--shell-safe-area-bottom)] sm:order-1 sm:pb-0 ${shellChromeCompensationClassName}`}>
      <nav aria-label="Main navigation" className={`${shellWidthClassName} grid min-h-shell-mobile-navigation grid-cols-3 border-t sm:border-x sm:border-b`}>
        {([
          { label: "Home", Icon: House },
          { label: "Card", Icon: CreditCard },
          { label: "Invest", Icon: ChartNoAxesCombined },
        ] as const).map(({ label, Icon }) => (
          <Button key={label} variant="navigation" size="lg" className="relative h-full min-h-11 min-w-0"
            aria-current={label === "Card" ? "page" : undefined} onClick={noOp}>
            {label === "Card" ? <span className="absolute inset-x-6 bottom-1 h-0.5 rounded-full bg-primary" aria-hidden="true" /> : null}
            <Icon className="size-5" aria-hidden="true" /><span className="truncate">{label}</span>
          </Button>
        ))}
      </nav>
    </div>
  );
}

function Shell({ surface, props, loading = false }: { surface: "card" | "save"; props: FeatureIntroProps; loading?: boolean }) {
  if (surface === "save") {
    return (
      <div className="flex h-svh max-h-svh flex-col overflow-hidden bg-muted [--shell-scrollbar-width:0px]">
        <header className={`order-0 w-full shrink-0 bg-background ${shellChromeCompensationClassName}`}>
          <div className={`${shellContentFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-11 w-11 shrink-0 items-center md:w-7.5 md:pointer-fine:h-7">
                <Button variant="ghost" size="icon" className="size-11 md:pointer-fine:size-7" aria-label="Back" onClick={noOp}>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <h1 className="min-w-0 truncate text-base font-semibold">Save</h1>
            </div>
            <ProfileMark status="ready" ownerKey="profile" address={null} onClick={noOp} />
          </div>
        </header>
        <PrimaryNavigation activeNavigation="save" onNavigate={noOp} />
        <main id="navigation-panel" data-app-main-authenticated tabIndex={loading ? 0 : undefined} className={`order-1 min-h-0 flex-1 overscroll-contain overflow-x-hidden bg-muted pb-4 scroll-pb-4 sm:order-2 ${shellScrollContainerClassName}`}>
          <div className={`${shellContentFrameClassName} py-4 sm:py-6`}>
            <section className="w-full space-y-4" aria-label="Save">
              <Card>
                <CardContent>
                  <p className="text-center text-4xl font-semibold tracking-tight text-muted-foreground tabular-nums">
                    <MoneyTicker value="$0.00" />
                  </p>
                </CardContent>
              </Card>
              {loading ? <LoadingIntro hero="compact" /> : (
                <Card>
                  <CardContent>
                    <IntroBody alternative="c" hero="compact" props={introProps("save")} />
                  </CardContent>
                </Card>
              )}
              <section className="space-y-4" aria-label="Vaults">
                <h2 className="text-sm font-semibold">Vaults</h2>
                <div className="space-y-4">
                  {([
                    { name: "Gauntlet USDC Prime", initials: "GU", apy: "4.10% APY" },
                    { name: "Steakhouse USDC", initials: "SU", apy: "3.85% APY" },
                    { name: "Spark USDC Vault", initials: "SU", apy: "3.62% APY" },
                  ] as const).map(({ name, initials, apy }) => (
                    <div key={name} className="overflow-hidden rounded-xl border bg-card pt-1">
                      <Item variant="flush" className="flex-nowrap items-center">
                        <ItemMedia variant="avatar" aria-hidden="true" className="text-foreground">
                          <span className="text-xs font-semibold">{initials}</span>
                        </ItemMedia>
                        <ItemContent className="min-w-0"><ItemTitle>{name}</ItemTitle></ItemContent>
                        <ItemContent className="items-end text-end"><ItemTitle numeric>{apy}</ItemTitle></ItemContent>
                      </Item>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-svh flex-col bg-muted/20">
      <header className={`order-0 w-full shrink-0 bg-background ${shellChromeCompensationClassName}`}>
        <div className={`${shellContentFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}>
          <div className="flex min-w-0 items-center gap-2">
            <HomeMark compact onClick={noOp} /><h1 className="text-base font-semibold">Card</h1>
          </div>
          <ProfileMark status="ready" ownerKey="profile" address={null} onClick={noOp} />
        </div>
      </header>
      <CardNavigation />
      <main id="navigation-panel" className="order-1 min-h-0 flex-1 overflow-y-auto">
        <div className={`${shellContentFrameClassName} space-y-4 py-4`}>
          {loading ? <LoadingIntro /> : <InlineIntro alternative="c" props={props} />}
        </div>
      </main>
    </div>
  );
}

function FeatureIntroWorkshop({ alternative = "c", presentation = "inline", scenario = "card", shell, compare = false }: WorkshopProps) {
  const props = introProps(scenario);
  if (shell) return <Shell surface={shell} props={props} loading={scenario === "loading"} />;
  if (compare) {
    return (
      <main className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-3">
        {([
          ["a", "A — Centred (not selected)"],
          ["b", "B — Left-aligned list (not selected)"],
          ["c", "C — Illustration-led hero (selected)"],
        ] as const).map(([variant, label]) => (
          <section key={variant} aria-label={label} className="min-w-0 space-y-3">
            <h2 className="text-sm font-medium">{label}</h2>
            {scenario === "loading" ? <LoadingIntro /> : <InlineIntro alternative={variant} props={props} />}
          </section>
        ))}
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-md p-4">
      {presentation === "sheet" ? <SheetIntro alternative={alternative} props={props} loading={scenario === "loading"} />
        : scenario === "loading" ? <LoadingIntro /> : <InlineIntro alternative={alternative} props={props} />}
    </main>
  );
}

const meta = {
  id: "explorations-feature-intro-cta",
  title: "Explorations/Feature Intro CTA",
  component: FeatureIntroWorkshop,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof FeatureIntroWorkshop>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CompareInline: Story = { args: { compare: true }, parameters: { viewport: { defaultViewport: "desktop" } } };
export const CompareInlineMobile: Story = { args: { compare: true } };
export const ACentredInline: Story = {
  args: { alternative: "a" },
  name: "A — Centred inline (history)",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Earn 4.20% APY on Cash", level: 2 })).toBeVisible();
  },
};
export const BListInline: Story = {
  args: { alternative: "b" },
  name: "B — Left-aligned list inline (history)",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole("button");
    for (const button of buttons) await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    actions.getCard.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get your card" }));
    await expect(actions.getCard).toHaveBeenCalledTimes(1);
  },
};
export const CHeroInline: Story = {
  args: { alternative: "c" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Earn 4.20% APY on Cash", level: 2 })).toBeVisible();
    const benefits = canvas.getAllByRole("listitem");
    await expect(benefits).toHaveLength(3);
    for (const benefit of benefits) await expect(benefit.querySelector("[data-slot=item-media] svg")).toBeInTheDocument();
    for (const button of canvas.getAllByRole("button")) await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    actions.getCard.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get your card" }));
    await expect(actions.getCard).toHaveBeenCalledTimes(1);
  },
};

async function playSheet(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  actions.getCard.mockClear();
  actions.notNow.mockClear();
  await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
  let dialog = await body.findByRole("dialog", { name: "Earn 4.20% APY on Cash" });
  await expect(within(dialog).getAllByText("Earn 4.20% APY on Cash")).toHaveLength(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(body.queryByRole("dialog", { name: "Earn 4.20% APY on Cash" })).not.toBeInTheDocument());
  await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
  dialog = await body.findByRole("dialog", { name: "Earn 4.20% APY on Cash" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Get your card" }));
  await expect(actions.getCard).toHaveBeenCalledTimes(1);
  await expect(actions.notNow).toHaveBeenCalledTimes(1);
}
export const ACentredSheet: Story = { name: "A — Centred sheet (history)", args: { alternative: "a", presentation: "sheet" }, play: async ({ canvasElement }) => playSheet(canvasElement) };
export const BListSheet: Story = { name: "B — Left-aligned list sheet (history)", args: { alternative: "b", presentation: "sheet" }, play: async ({ canvasElement }) => playSheet(canvasElement) };
export const CHeroSheet: Story = { args: { alternative: "c", presentation: "sheet" }, play: async ({ canvasElement }) => playSheet(canvasElement) };
export const CHeroLoadingSheet: Story = {
  args: { alternative: "c", presentation: "sheet", scenario: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
    const dialog = await body.findByRole("dialog", { name: "Feature introduction" });
    const content = within(dialog);
    await expect(content.getByRole("status", { name: "Loading introduction" })).toHaveAttribute("aria-busy", "true");
    await expect(content.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    const dismiss = content.getByRole("button", { name: "Not now" });
    await expect(dismiss.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(dismiss);
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Feature introduction" })).not.toBeInTheDocument());
  },
};
export const CHeroPendingSheet: Story = {
  args: { alternative: "c", presentation: "sheet", scenario: "pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    actions.notNow.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
    const dialog = await body.findByRole("dialog");
    const content = within(dialog);
    await expect(content.getByRole("button", { name: "Get your card" })).toBeDisabled();
    const dismiss = content.getByRole("button", { name: "Not now" });
    await expect(dismiss).toBeEnabled();
    await userEvent.click(dismiss);
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(actions.notNow).toHaveBeenCalledTimes(1);
  },
};
export const CHeroUnavailableSheet: Story = {
  args: { alternative: "c", presentation: "sheet", scenario: "verify" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    actions.notNow.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
    const dialog = await body.findByRole("dialog", { name: "Earn 4.20% APY on Cash" });
    const content = within(dialog);
    await expect(content.getByText("Verify your identity to get a card.")).toBeVisible();
    await expect(content.getByRole("button", { name: "Verify" })).toBeVisible();
    await expect(content.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    await userEvent.click(content.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Earn 4.20% APY on Cash" })).not.toBeInTheDocument());
    await expect(actions.notNow).toHaveBeenCalledTimes(1);
  },
};
export const CHeroPending: Story = {
  args: { scenario: "pending" },
  play: async ({ canvasElement }) => {
    const primary = within(canvasElement).getByRole("button", { name: "Get your card" });
    actions.getCard.mockClear();
    await expect(primary).toBeDisabled();
    await expect(primary).toHaveAttribute("aria-busy", "true");
    primary.click();
    await expect(actions.getCard).not.toHaveBeenCalled();
  },
};
export const CHeroLoading: Story = {
  args: { scenario: "loading" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status", { name: "Loading introduction" })).toHaveAttribute("aria-busy", "true");
  },
};
async function playUnavailable(canvasElement: HTMLElement, reason: string, recovery: string, handler: typeof actions.verify) {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(reason)).toBeVisible();
  await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
  const recoveryButton = canvas.getByRole("button", { name: recovery });
  await expect(recoveryButton).toHaveAccessibleDescription(reason);
  handler.mockClear();
  await userEvent.click(recoveryButton);
  await expect(handler).toHaveBeenCalledTimes(1);
}
export const CHeroUnavailableVerify: Story = {
  args: { scenario: "verify" },
  play: async ({ canvasElement }) => playUnavailable(canvasElement, "Verify your identity to get a card.", "Verify", actions.verify),
};
export const CHeroUnavailableRegion: Story = {
  args: { scenario: "region" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Card isn’t available in Canada yet.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
  },
};
export const CHeroLongCopy: Story = {
  args: { scenario: "long" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const props = introProps("long");
    await expect(props.headline.length).toBeLessThanOrEqual(28);
    await expect(props.description?.length).toBeLessThanOrEqual(80);
    await expect(canvas.getByRole("heading", { name: props.headline })).toBeVisible();
    for (const { text } of props.benefits) {
      await expect(text).toHaveLength(32);
      const benefit = canvas.getByText(text);
      await expect(benefit).toBeVisible();
      await expect(benefit.scrollWidth).toBeLessThanOrEqual(benefit.clientWidth);
    }
  },
};
export const CHeroNoIllustration: Story = { args: { scenario: "no-illustration" } };
export const CardNotIssued: Story = {
  args: { shell: "card" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Card", current: "page" })).toHaveAttribute("aria-current", "page");
    actions.getCard.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get your card" }));
    await expect(actions.getCard).toHaveBeenCalledTimes(1);
  },
};
export const CardNotIssuedDesktop: Story = { args: { shell: "card" }, parameters: { viewport: { defaultViewport: "desktop" } } };
export const CardLoading: Story = {
  args: { shell: "card", scenario: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status", { name: "Loading introduction" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  },
};
export const CardNeedsVerification: Story = { args: { shell: "card", scenario: "verify" } };
export const CardRegionUnavailable: Story = {
  args: { shell: "card", scenario: "region" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Card isn’t available in Canada yet.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /verify|country/i })).not.toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  },
};
export const SaveNotStarted: Story = {
  args: { shell: "save", scenario: "save" },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Home", current: "page" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("img", { name: "$0.00" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Start saving" })).toBeVisible();
    await expect(canvas.getByText("Earn interest on USDC")).toBeVisible();
    const main = within(canvas.getByRole("main"));
    for (const name of ["Gauntlet USDC Prime", "Steakhouse USDC", "Spark USDC Vault"]) {
      await expect(main.getByText(name)).toBeVisible();
    }
    await expect(main.getAllByRole("button", { name: "Get started" })).toHaveLength(1);
    await expect(main.queryByRole("button", { name: "Deposit" })).not.toBeInTheDocument();
    for (const button of main.getAllByRole("button")) await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    actions.getStarted.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get started" }));
    await expect(actions.getStarted).toHaveBeenCalledTimes(1);
  },
};
export const SaveNotStartedDesktop: Story = {
  args: { shell: "save", scenario: "save" }, parameters: { viewport: { defaultViewport: "desktop" }, a11y: { test: "error" } },
};
export const SaveLoading: Story = {
  args: { shell: "save", scenario: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status", { name: "Loading introduction" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Get started" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "Vaults" })).toBeInTheDocument();
  },
};
