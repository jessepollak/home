import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Illustration } from "./illustration";

type Subject = "card" | "savings" | "money";
type Direction = "a" | "b" | "c";

const columns: { direction: Direction; name: string }[] = [
  { direction: "a", name: "A — Soft Blocks" },
  { direction: "b", name: "B — Line & Plane (recommended)" },
  { direction: "c", name: "C — UI Fragments" },
];
const subjects: { subject: Subject; name: string }[] = [
  { subject: "card", name: "Card" },
  { subject: "savings", name: "Savings growing" },
  { subject: "money", name: "Money moving" },
];

function Board({ dark = false }: { dark?: boolean }) {
  return (
    <section className={dark ? "dark bg-background text-foreground rounded-xl p-4 sm:p-6" : "bg-background text-foreground rounded-xl p-4 sm:p-6"} aria-label={dark ? "Dark theme directions" : "Light theme directions"}>
      <h2 className="mb-5 text-lg font-semibold">{dark ? "Dark theme" : "Light theme"}</h2>
      <div className="grid gap-5 lg:grid-cols-3">
        {columns.map(({ direction, name }) => (
          <div key={direction} className="min-w-0 space-y-3">
            <h3 className="text-sm font-medium">{name}</h3>
            {subjects.map(({ subject, name: subjectName }) => (
              <div key={subject} className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                <p className="text-sm text-muted-foreground">{subjectName}</p>
                <Illustration direction={direction} subject={subject} className="mx-auto max-w-60" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplayIllustration({ subject, variant, motion }: { subject: Subject; variant?: "intro" | "completion"; motion?: "system" | "reduce" }) {
  const [key, setKey] = useState(0);
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 p-6">
      <h2 className="text-base font-medium">{subject === "card" ? "Card" : subject === "savings" ? "Savings growing" : "Money moving"}</h2>
      <Illustration key={key} direction="b" subject={subject} variant={variant} motion={motion} play className="max-w-60" />
      <Button variant="outline" className="h-11 md:pointer-fine:h-8" onClick={() => setKey((value) => value + 1)}>Replay</Button>
    </div>
  );
}

function usePlayWhenVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = false;
    const start = () => {
      if (visible && document.visibilityState === "visible") setPlay(true);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      start();
    }, { threshold: 0.5 });
    observer.observe(element);
    document.addEventListener("visibilitychange", start);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  return { ref, play };
}

function IntroContent({ play, maxWidth = "max-w-60", idle = "none" }: { play: boolean; maxWidth?: string; idle?: "none" | "twinkle" }) {
  return (
    <>
      <div className={`mx-auto aspect-3/2 w-full ${maxWidth}`}>
        <Illustration direction="b" subject="card" play={play} idle={idle} />
      </div>
      <CardHeader>
        <CardTitle><h2>Get the Home Card</h2></CardTitle>
        <CardDescription>A card for everyday spending.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>Spend from your account</li>
          <li>See each purchase in Home</li>
          <li>Freeze it any time from Home</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="h-11 md:pointer-fine:h-8">Get your card</Button>
          <Button variant="ghost" className="h-11 md:pointer-fine:h-8">Not now</Button>
        </div>
      </CardContent>
    </>
  );
}

function InlineIntro({ dark = false }: { dark?: boolean }) {
  const { ref, play } = usePlayWhenVisible();
  return (
    <div className={dark ? "dark min-h-[100vh] bg-background p-4 text-foreground sm:p-8" : "min-h-[100vh] bg-background p-4 text-foreground sm:p-8"}>
      <div ref={ref} className="mx-auto w-full max-w-sm">
        <Card>
          <IntroContent play={play} />
        </Card>
      </div>
    </div>
  );
}

function SheetIntro() {
  const [play, setPlay] = useState(false);
  return (
    <div className="p-6">
      <Drawer onOpenChangeComplete={(open) => setPlay(open)}>
        <DrawerTrigger render={<Button className="h-11 md:pointer-fine:h-8">Explore the Home Card</Button>} />
        <DrawerContent>
          <div className="mx-auto aspect-3/2 w-full max-w-70 shrink-0">
            <Illustration direction="b" subject="card" play={play} idle="twinkle" />
          </div>
          <DrawerHeader>
            <DrawerTitle>Get the Home Card</DrawerTitle>
            <DrawerDescription>A card for everyday spending.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <ul className="mx-auto w-fit list-inside list-disc space-y-1 text-left text-sm text-muted-foreground md:mx-0 md:w-full">
              <li>Spend from your account</li>
              <li>See each purchase in Home</li>
              <li>Freeze it any time from Home</li>
            </ul>
          </div>
          <DrawerFooter>
            <Button className="h-11 md:pointer-fine:h-8">Get your card</Button>
            <DrawerClose render={<Button variant="ghost" className="h-11 md:pointer-fine:h-8">Not now</Button>} />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function CompletionStory() {
  return (
    <Card className="mx-auto mt-6 w-full max-w-sm">
      <CardContent>
        <Illustration direction="b" subject="money" variant="completion" play className="mx-auto max-w-60" />
      </CardContent>
      <CardHeader className="text-center">
        <CardTitle><h2>Money sent</h2></CardTitle>
        <CardDescription>It&apos;s on its way to Alex.</CardDescription>
      </CardHeader>
      <CardContent><Button className="h-11 w-full md:pointer-fine:h-8">Done</Button></CardContent>
    </Card>
  );
}

function illustrationIn(element: HTMLElement): SVGSVGElement {
  const svg = element.querySelector<SVGSVGElement>('svg[data-slot="illustration"]');
  if (!svg) throw new Error("Illustration not found");
  return svg;
}

function entranceAnimations(svg: SVGSVGElement) {
  return svg.getAnimations({ subtree: true }).filter((animation) => {
    const effect = animation.effect;
    return effect instanceof KeyframeEffect && !effect.getKeyframes().some((frame) => frame.opacity === "0.4");
  });
}

async function assertAnimation(svg: SVGSVGElement) {
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  await waitFor(() => expect(svg).toHaveAttribute("data-state", "playing"));
  await waitFor(() => expect(entranceAnimations(svg).length).toBeGreaterThan(0));
  const animations = entranceAnimations(svg);
  const entry = animations.map((animation) => {
    const effect = animation.effect as KeyframeEffect;
    const { delay, duration } = effect.getTiming();
    return { part: (effect.target as Element).getAttribute("data-part"), gesture: (effect.target as Element).getAttribute("data-gesture"), delay: Number(delay), duration: Number(duration), frames: effect.getKeyframes() };
  });
  const end = Math.max(...entry.map(({ delay, duration }) => delay + duration));
  if (svg.querySelector('[data-part="context"]')) await expect(end).toBeLessThanOrEqual(700);
  else {
    await expect(end).toBeGreaterThanOrEqual(1000);
    await expect(end).toBeLessThanOrEqual(1400);
  }
  const draws = entry.filter(({ part }) => part === "draw").sort((a, b) => a.delay - b.delay);
  for (const [index, draw] of draws.entries()) {
    await expect(draw.duration).toBeGreaterThanOrEqual(90);
    await expect(draw.gesture).not.toBeNull();
    if (index) {
      const previous = draws[index - 1];
      if (draw.gesture === previous.gesture) await expect(draw.delay).toBe(previous.delay + previous.duration);
      else await expect(draw.delay + 0.001).toBeGreaterThanOrEqual(previous.delay + previous.duration + 32);
    }
  }
  const plane = entry.find(({ part }) => part === "plane");
  await expect(plane).toBeDefined();
  await expect(plane!.delay + plane!.duration).toBeLessThanOrEqual(draws.find((draw) => draw.delay > 0)!.delay);
  for (const frame of plane!.frames) {
    await expect(Object.keys(frame).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)).sort()).toEqual(["opacity", "transform"]);
    await expect(String(frame.transform)).toMatch(/^translateY\(/);
  }
  for (const accent of entry.filter(({ part }) => part === "accent" || part === "coin")) {
    await expect(accent.delay).toBeGreaterThanOrEqual(draws.at(-1)!.delay + draws.at(-1)!.duration);
  }
  await Promise.all(animations.map((animation) => animation.finished));
}

async function assertReplay(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { level: 2 })).toBeVisible();
  const svg = illustrationIn(canvasElement);
  await assertAnimation(svg);
  const original = entranceAnimations(svg);
  await userEvent.click(canvas.getByRole("button", { name: "Replay" }));
  const fresh = illustrationIn(canvasElement);
  await expect(fresh).not.toBe(svg);
  await waitFor(() => expect(entranceAnimations(fresh).length).toBeGreaterThan(0));
  const replayed = entranceAnimations(fresh);
  await expect(replayed.some((animation) => original.includes(animation))).toBe(false);
  await Promise.all(replayed.map((animation) => animation.finished));
}

const meta = {
  id: "explorations-illustrations",
  title: "Explorations/Illustrations",
  component: Illustration,
  args: { direction: "b", subject: "card" },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof Illustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DirectionsBoard: Story = {
  render: () => <div className="space-y-6 p-3 sm:p-6"><Board /><Board dark /></div>,
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll<SVGSVGElement>('svg[data-slot="illustration"]');
    await expect(svgs).toHaveLength(18);
    for (const svg of svgs) {
      await expect(svg).toHaveAttribute("aria-hidden", "true");
      await expect(svg.getAnimations({ subtree: true })).toHaveLength(0);
    }
  },
};

export const CardEntranceMobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <ReplayIllustration subject="card" />,
  play: async ({ canvasElement }) => assertReplay(canvasElement),
};

export const CardEntranceDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <ReplayIllustration subject="card" />,
  play: async ({ canvasElement }) => assertReplay(canvasElement),
};

export const CardReducedMotion: Story = {
  render: () => <ReplayIllustration subject="card" motion="reduce" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Card" })).toBeVisible();
    const svg = illustrationIn(canvasElement);
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(svg.getAnimations({ subtree: true })).toHaveLength(0);
    await userEvent.click(canvas.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(illustrationIn(canvasElement)).not.toBe(svg));
    await expect(illustrationIn(canvasElement)).toHaveAttribute("data-state", "idle");
    await expect(illustrationIn(canvasElement).getAnimations({ subtree: true })).toHaveLength(0);
  },
};

export const FeatureIntroInline: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <InlineIntro />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Get the Home Card" })).toBeVisible();
    await assertAnimation(illustrationIn(canvasElement));
  },
};

export const FeatureIntroSheet: Story = {
  render: () => <SheetIntro />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Explore the Home Card" }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByRole("heading", { name: "Get the Home Card" })).toBeVisible();
    const svg = illustrationIn(dialog);
    await waitFor(() => expect(svg).toHaveAttribute("data-state", "playing"));
    await assertAnimation(svg);
  },
};

export const SavingsEntrance: Story = {
  render: () => <ReplayIllustration subject="savings" />,
  play: async ({ canvasElement }) => assertReplay(canvasElement),
};

export const MoneyMovingEntrance: Story = {
  render: () => <ReplayIllustration subject="money" />,
  play: async ({ canvasElement }) => {
    await assertReplay(canvasElement);
    const svg = illustrationIn(canvasElement);
    const chevron = svg.querySelector('[data-part="chevron"]');
    await expect(chevron).not.toBeNull();
    await expect(chevron?.getAnimations()).toHaveLength(0);
    const coin = svg.querySelector('[data-part="coin"]');
    await expect(coin).not.toBeNull();
    const lastDrawEnd = Math.max(...[...svg.querySelectorAll('[data-part="draw"]')].map((path) => {
      const { delay, duration } = path.getAnimations()[0].effect!.getTiming();
      return Number(delay) + Number(duration);
    }));
    const animations = coin?.getAnimations() ?? [];
    for (const animation of animations) await expect(Number(animation.effect?.getTiming().delay)).toBeGreaterThanOrEqual(lastDrawEnd + 32);
    await expect(animations).toHaveLength(2);
    for (const animation of animations) await expect(animation.playState).toBe("finished");
    await expect(animations.some((animation) => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some((frame) => frame.offsetDistance === "50%"))).toBe(true);
    await expect(animations.some((animation) => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some((frame) => frame.opacity === "1"))).toBe(true);
  },
};

export const TransferComplete: Story = {
  render: () => <CompletionStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Money sent" })).toBeVisible();
    await expect(canvas.getByText("It's on its way to Alex.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Done" })).toBeVisible();
    const svg = illustrationIn(canvasElement);
    await expect(svg.querySelector('[data-part="coin"]')).toBeNull();
    await assertAnimation(svg);
  },
};

export const FeatureIntroInlineDark: Story = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () => <InlineIntro dark />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Get the Home Card" })).toBeVisible();
    await assertAnimation(illustrationIn(canvasElement));
  },
};
