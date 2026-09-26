import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ArrowUpFromLine, Banknote, CreditCard, Lock, LockOpen, Percent, ReceiptText, Store } from "lucide-react";
import { Button } from "./button";
import { FeatureIntro, FeatureIntroSheet, FeatureIntroSkeleton } from "./feature-intro";
import type { FeatureIntroContent } from "./feature-intro";

const actions = { getCard: fn(), verify: fn(), getStarted: fn(), notNow: fn() };
const card: FeatureIntroContent = {
  headline: "Spend your Cash with a card",
  benefits: [
    { icon: Store, text: "Pay in stores and online" },
    { icon: Lock, text: "Lock it anytime" },
    { icon: Banknote, text: "Spend straight from your balance" },
  ],
  primary: { label: "Get your card", onClick: actions.getCard },
  illustration: "card",
};
const save: FeatureIntroContent = {
  headline: "Start saving",
  benefits: [
    { icon: Percent, text: "Earn interest on USDC" },
    { icon: ArrowUpFromLine, text: "Withdraw anytime" },
    { icon: LockOpen, text: "No lockups" },
  ],
  primary: { label: "Get started", onClick: actions.getStarted },
  illustration: "savings",
};
const verification: FeatureIntroContent["availability"] = {
  kind: "unavailable", reason: "Verify your identity to get a card.",
  recovery: { label: "Verify", onClick: actions.verify },
};
const region: FeatureIntroContent["availability"] = { kind: "unavailable", reason: "Card isn’t available in your region yet." };
const long: FeatureIntroContent = {
  ...card,
  headline: "Make everyday spending safer",
  description: "See how your Cash works with a card before you decide if it fits your needs now.",
  benefits: [
    { icon: CreditCard, text: "Pay in stores and online safely." },
    { icon: Lock, text: "Lock your card whenever you need" },
    { icon: Banknote, text: "Spend straight from your balance" },
    { icon: ReceiptText, text: "Track every purchase as it lands" },
  ],
};

type IntroStoryProps = { content: FeatureIntroContent; size?: "default" | "compact"; presentation?: "inline" | "sheet" | "loading"; rtl?: boolean };
function IntroStory({ content, size, presentation = "inline", rtl = false }: IntroStoryProps) {
  const [open, setOpen] = useState(false);
  const secondary = { label: "Not now", onClick: () => { actions.notNow(); setOpen(false); } };
  return (
    <main dir={rtl ? "rtl" : undefined} className="mx-auto w-full max-w-md p-4">
      {presentation === "loading" ? <FeatureIntroSkeleton size={size} /> : presentation === "sheet" ? (
        <>
          <Button variant="outline" className="h-11" onClick={() => setOpen(true)}>Open introduction</Button>
          <FeatureIntroSheet {...content} secondary={secondary} open={open} onOpenChange={setOpen} />
        </>
      ) : <FeatureIntro {...content} size={size} />}
    </main>
  );
}

const meta = {
  id: "ui-feature-intro",
  title: "UI/FeatureIntro",
  component: IntroStory,
  args: { content: card },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    a11y: { test: "error" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=385-4124" },
  },
} satisfies Meta<typeof IntroStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CardNotIssued: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: card.headline, level: 2 })).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    actions.getCard.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get your card" }));
    await expect(actions.getCard).toHaveBeenCalledTimes(1);
  },
};
export const CardNotIssuedDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } } };
export const CardPending: Story = {
  args: { content: { ...card, primary: { ...card.primary, pending: true } } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Get your card" });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    actions.getCard.mockClear();
    await userEvent.click(button);
    await expect(actions.getCard).not.toHaveBeenCalled();
  },
};
export const CardLoading: Story = {
  args: { presentation: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status", { name: "Loading introduction" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
  },
};
export const CardNeedsVerification: Story = {
  args: { content: { ...card, availability: verification } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    const button = canvas.getByRole("button", { name: "Verify" });
    await expect(button).toHaveAccessibleDescription("Verify your identity to get a card.");
    actions.verify.mockClear();
    await userEvent.click(button);
    await expect(actions.verify).toHaveBeenCalledTimes(1);
  },
};
export const CardRegionUnavailable: Story = {
  args: { content: { ...card, availability: region } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Card isn’t available in your region yet.")).toBeVisible();
    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
  },
};
export const LongCopy: Story = {
  args: { content: long },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(long.headline.length).toBeLessThanOrEqual(28);
    await expect(long.description?.length).toBeLessThanOrEqual(80);
    await expect(canvas.getByRole("heading", { name: long.headline })).toBeVisible();
    for (const { text } of long.benefits) {
      await expect(text).toHaveLength(32);
      const benefit = canvas.getByText(text);
      await expect(benefit).toBeVisible();
      await expect(benefit.scrollWidth).toBeLessThanOrEqual(benefit.clientWidth);
    }
  },
};
export const NoIllustration: Story = {
  args: { content: { ...card, illustration: undefined } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: card.headline })).toBeVisible();
  },
};
async function playSheet(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  actions.getCard.mockClear();
  actions.notNow.mockClear();
  await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
  let dialog = await body.findByRole("dialog", { name: card.headline });
  await expect(within(dialog).getByRole("heading", { name: card.headline })).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(body.queryByRole("dialog", { name: card.headline })).not.toBeInTheDocument());
  await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
  dialog = await body.findByRole("dialog", { name: card.headline });
  await userEvent.click(within(dialog).getByRole("button", { name: "Get your card" }));
  await expect(actions.getCard).toHaveBeenCalledTimes(1);
  await expect(actions.notNow).toHaveBeenCalledTimes(1);
}
export const Sheet: Story = { args: { presentation: "sheet" }, play: async ({ canvasElement }) => playSheet(canvasElement) };
export const SheetPending: Story = {
  args: { presentation: "sheet", content: { ...card, primary: { ...card.primary, pending: true } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    actions.getCard.mockClear();
    actions.notNow.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
    const dialog = await body.findByRole("dialog", { name: card.headline });
    const primary = within(dialog).getByRole("button", { name: "Get your card" });
    await expect(primary).toHaveAttribute("aria-busy", "true");
    await expect(primary).toHaveAttribute("aria-disabled", "true");
    await expect(primary.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(primary);
    await expect(actions.getCard).not.toHaveBeenCalled();
    const dismiss = within(dialog).getByRole("button", { name: "Not now" });
    await expect(dismiss).toBeEnabled();
    await expect(dismiss.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(dismiss);
    await waitFor(() => expect(body.queryByRole("dialog", { name: card.headline })).not.toBeInTheDocument());
    await expect(actions.notNow).toHaveBeenCalledTimes(1);
  },
};
export const SheetUnavailable: Story = {
  args: { presentation: "sheet", content: { ...card, availability: verification } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Open introduction" }));
    const dialog = await body.findByRole("dialog", { name: card.headline });
    const content = within(dialog);
    await expect(content.getByRole("button", { name: "Verify" })).toHaveAccessibleDescription("Verify your identity to get a card.");
    await expect(content.queryByRole("button", { name: "Get your card" })).not.toBeInTheDocument();
    await expect(content.getByRole("button", { name: "Not now" })).toBeEnabled();
  },
};
export const SaveNotStarted: Story = {
  args: { content: save, size: "compact" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Start saving", level: 2 })).toBeVisible();
    await expect(canvas.getByText("Earn interest on USDC")).toBeVisible();
    actions.getStarted.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get started" }));
    await expect(actions.getStarted).toHaveBeenCalledTimes(1);
  },
};
export const SaveNotStartedDesktop: Story = { args: { content: save, size: "compact" }, parameters: { viewport: { defaultViewport: "desktop" } } };
export const Rtl: Story = {
  args: { rtl: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("main")).toHaveAttribute("dir", "rtl");
    await expect(canvas.getByRole("heading", { name: card.headline })).toBeVisible();
    const benefits = canvas.getAllByRole("listitem");
    await expect(benefits).toHaveLength(3);
    for (const [index, benefit] of benefits.entries()) await expect(within(benefit).getByText(card.benefits[index].text)).toBeVisible();
  },
};
