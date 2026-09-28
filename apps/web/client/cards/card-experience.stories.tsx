import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Toaster } from "@/components/ui/toast";
import type { CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import { CardScreen, type CardScreenData } from "./card-experience";

const actions = { onOpenVerification: fn(), onRetry: fn(), issue: fn(), setFrozen: fn() };
const kycUrl = "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_story";
const reveal = { publishableKey: "pk_test_story", revealKey: async (): Promise<never> => { throw new Error("Stripe is not loaded in stories."); } };

function CardStateStory({ state, withReveal = true }: { state: CardState | "loading" | "failed"; withReveal?: boolean }) {
  const [response, setResponse] = useState(() => state === "loading" || state === "failed" ? null : cardsBody(state));
  const cards: CardScreenData = response ? { status: "ready", response } : state === "failed" ? { status: "failed" } : { status: "loading" };
  return (
    <div className="mx-auto max-w-xl p-4">
      <CardScreen
        cards={cards}
        onRetry={actions.onRetry}
        onOpenVerification={actions.onOpenVerification}
        reveal={withReveal ? reveal : undefined}
        commands={{
          enroll: async () => kycUrl,
          issue: async () => { actions.issue(); setResponse(cardsBody("active")); },
          setFrozen: async (cardId, frozen) => { actions.setFrozen(cardId, frozen); setResponse(cardsBody(frozen ? "frozen" : "active")); },
        }}
      />
      <Toaster />
    </div>
  );
}

const meta = {
  id: "client-cards-card-screen",
  title: "Client/Cards/Card screen",
  component: CardStateStory,
  args: { state: "active" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof CardStateStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotEnrolled: Story = {
  args: { state: "not-enrolled" },
  play: async ({ canvasElement }) => {
    actions.onOpenVerification.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Get your card" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledWith(kycUrl));
  },
};
export const VerificationRequired: Story = {
  args: { state: "verification-required" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Verify your identity")).toBeVisible();
    actions.onOpenVerification.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledTimes(1));
  },
};
export const VerificationPending: Story = {
  args: { state: "verification-pending" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Checking your details")).toBeVisible();
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};
export const Ineligible: Story = { args: { state: "ineligible" } };
export const ReadyToIssue: Story = {
  args: { state: "ready-to-issue" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create your card" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
  },
};
export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Card details" })).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Lock card" })).not.toBeChecked();
  },
};
export const ActiveWithoutPublishableKey: Story = {
  args: { withReveal: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: "Card details" })).toBeNull();
  },
};
export const Frozen: Story = { args: { state: "frozen" } };
export const Restricted: Story = {
  args: { state: "restricted" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Lock card" })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.queryByRole("button", { name: "Card details" })).toBeNull();
  },
};
export const Canceled: Story = { args: { state: "canceled" } };
export const Unavailable: Story = {
  args: { state: "unavailable" },
  play: async ({ canvasElement }) => {
    actions.onRetry.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(actions.onRetry).toHaveBeenCalledTimes(1);
  },
};
export const Loading: Story = { args: { state: "loading" } };
