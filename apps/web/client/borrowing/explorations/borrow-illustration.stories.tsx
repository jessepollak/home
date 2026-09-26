import { useState } from "react";
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { CircleDollarSign, Coins, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { BorrowIllustration } from "./borrow-illustration";
import type { BorrowIllustrationOption } from "./borrow-illustration";

const chooseAsset = fn();
const benefits = [
  { icon: Coins, text: "Borrow without selling" },
  { icon: ShieldCheck, text: "See the variable rate and liquidation risk" },
  { icon: CircleDollarSign, text: "Repay when you're ready" },
] as const;
const options: { option: BorrowIllustrationOption; name: string; idea: string }[] = [
  { option: "keep", name: "A — Keep & draw", idea: "USDC slides out from behind the coins you keep." },
  { option: "counterweight", name: "B — Counterweight", idea: "Your collateral outweighs the loan and the beam settles." },
  { option: "tether", name: "C — Tether", idea: "USDC lifts off and stays tied to your coins." },
];

function Page({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <main className={dark ? "dark min-h-screen bg-background p-4 text-foreground" : "min-h-screen bg-background p-4 text-foreground"}>{children}</main>;
}

function IntroPreview({ option, motion }: { option: BorrowIllustrationOption; motion?: "system" | "reduce" }) {
  return (
    <Card>
      <CardContent>
        <div className="space-y-5">
          <div className="mx-auto w-full max-w-40"><BorrowIllustration option={option} motion={motion} /></div>
          <div className="space-y-2">
            <h2 className="text-center text-2xl font-semibold text-balance">Borrow against your crypto</h2>
            <p className="text-center text-sm text-muted-foreground">Use a supported asset as collateral to borrow USDC.</p>
          </div>
          <ul className="space-y-1 rounded-lg border px-3 py-1">
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Item size="sm" className="px-0">
                  <ItemMedia variant="avatar"><Icon aria-hidden="true" /></ItemMedia>
                  <ItemContent className="min-w-0"><ItemTitle truncate={false} className="whitespace-normal">{text}</ItemTitle></ItemContent>
                </Item>
              </li>
            ))}
          </ul>
          <Button size="touch" className="w-full" onClick={chooseAsset}>Choose an asset</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionStory({ option }: { option: BorrowIllustrationOption }) {
  const [run, setRun] = useState(0);
  return (
    <Page>
      <div className="mx-auto w-full max-w-md space-y-3">
        <IntroPreview key={run} option={option} />
        <Button variant="outline" size="touch" className="w-full" onClick={() => setRun((value) => value + 1)}>Replay</Button>
      </div>
    </Page>
  );
}

function Comparison({ dark = false }: { dark?: boolean }) {
  return (
    <section aria-label={dark ? "Dark theme" : "Light theme"} className={dark ? "dark rounded-xl bg-background p-6 text-foreground" : "rounded-xl bg-background p-6 text-foreground"}>
      <h2 className="mb-4 text-lg font-semibold">{dark ? "Dark theme" : "Light theme"}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {options.map(({ option, name, idea }) => (
          <div key={option} className="min-w-0 space-y-2 rounded-lg border bg-card p-4 text-card-foreground">
            <h3 className="text-sm font-medium">{name}</h3>
            <p className="text-sm text-muted-foreground">{idea}</p>
            <div className="mx-auto w-full max-w-60"><BorrowIllustration option={option} motion="reduce" /></div>
            <div className="mx-auto w-full max-w-40"><BorrowIllustration option={option} motion="reduce" /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function illustrationIn(element: HTMLElement): SVGSVGElement {
  const svg = element.querySelector<SVGSVGElement>('svg[data-slot="borrow-illustration"]');
  if (!svg) throw new Error("Borrow illustration not found");
  return svg;
}

const animatedProperties = new Set(["opacity", "transform", "strokeDashoffset"]);
const keyframeMeta = new Set(["offset", "easing", "composite", "computedOffset"]);

async function assertEntrance(svg: SVGSVGElement) {
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  await waitFor(() => expect(svg).toHaveAttribute("data-state", "playing"));
  await waitFor(() => expect(svg.getAnimations({ subtree: true }).length).toBeGreaterThan(0));
  const animations = svg.getAnimations({ subtree: true });
  const end = Math.max(...animations.map((animation) => {
    const { delay, duration } = animation.effect!.getTiming();
    return Number(delay) + Number(duration);
  }));
  await expect(end).toBeGreaterThanOrEqual(1000);
  await expect(end).toBeLessThanOrEqual(1300);
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect;
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame).filter((name) => !keyframeMeta.has(name))) await expect(animatedProperties.has(key)).toBe(true);
    }
  }
  await Promise.all(animations.map((animation) => animation.finished));
  return animations;
}

async function assertOption(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { name: "Borrow against your crypto" })).toBeVisible();
  const svg = illustrationIn(canvasElement);
  const first = await assertEntrance(svg);
  await userEvent.click(canvas.getByRole("button", { name: "Replay" }));
  await waitFor(() => expect(illustrationIn(canvasElement)).not.toBe(svg));
  const replayed = await assertEntrance(illustrationIn(canvasElement));
  await expect(replayed.some((animation) => first.includes(animation))).toBe(false);
}

const meta = {
  id: "explorations-borrow-illustration",
  title: "Explorations/Borrow Illustration",
  component: BorrowIllustration,
  args: { option: "keep" },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BorrowIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => (
    <Page>
      <div className="mx-auto w-full max-w-md">
        <FeatureIntro size="compact" illustration="borrow" headline="Borrow against your crypto" description="Use a supported asset as collateral to borrow USDC."
          benefits={[...benefits]} primary={{ label: "Choose an asset", onClick: chooseAsset }} />
      </div>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Borrow against your crypto" })).toBeVisible();
  },
};

export const OptionAKeep: Story = {
  name: "Option A — Keep & draw",
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <OptionStory option="keep" />,
  play: async ({ canvasElement }) => assertOption(canvasElement),
};

export const OptionBCounterweight: Story = {
  name: "Option B — Counterweight",
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <OptionStory option="counterweight" />,
  play: async ({ canvasElement }) => assertOption(canvasElement),
};

export const OptionCTether: Story = {
  name: "Option C — Tether",
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <OptionStory option="tether" />,
  play: async ({ canvasElement }) => assertOption(canvasElement),
};

export const FinalFrames: Story = {
  render: () => <div className="space-y-6 bg-background p-6"><Comparison /><Comparison dark /></div>,
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll<SVGSVGElement>('svg[data-slot="borrow-illustration"]');
    await expect(svgs).toHaveLength(12);
    for (const svg of svgs) await expect(svg.getAnimations({ subtree: true })).toHaveLength(0);
  },
};

export const ReducedMotion: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => (
    <Page>
      <div className="mx-auto w-full max-w-md space-y-4">
        {options.map(({ option }) => <IntroPreview key={option} option={option} motion="reduce" />)}
      </div>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll<SVGSVGElement>('svg[data-slot="borrow-illustration"]');
    await expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      await expect(svg).toHaveAttribute("data-state", "idle");
      await expect(svg.getAnimations({ subtree: true })).toHaveLength(0);
    }
  },
};
