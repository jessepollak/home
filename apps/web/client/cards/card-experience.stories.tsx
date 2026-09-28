import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import { CardScreen, type CardScreenData } from "./card-experience";
import { CardRefreshError } from "./use-cards";

const actions = { onOpenVerification: fn(), onRetry: fn(), issue: fn(), setFrozen: fn() };
const kycUrl = "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_story";
const reveal = { publishableKey: "pk_test_story", revealKey: async (): Promise<never> => { throw new Error("Stripe is not loaded in stories."); } };

const twoCards: CardsResponse = { ...cardsBody("frozen"), cards: [
  { id: "ic_fixture1107", status: "frozen", last4: "1107" },
  { id: "ic_fixture4821", status: "active", last4: "4821" },
] };

function CardStateStory({ state, initial, refreshFails = false, withReveal = true }: {
  state: CardState | "loading" | "failed";
  initial?: CardsResponse;
  refreshFails?: boolean;
  withReveal?: boolean;
}) {
  const [response, setResponse] = useState(() => initial ?? (state === "loading" || state === "failed" ? null : cardsBody(state)));
  const [readFailed, setReadFailed] = useState(state === "failed");
  const cards: CardScreenData = readFailed ? { status: "failed" } : response ? { status: "ready", response } : { status: "loading" };
  return (
    <div className="mx-auto max-w-xl p-4">
      <CardScreen
        cards={cards}
        onRetry={() => { actions.onRetry(); if (refreshFails) setReadFailed(false); }}
        onOpenVerification={actions.onOpenVerification}
        reveal={withReveal ? reveal : undefined}
        commands={{
          enroll: async () => kycUrl,
          issue: async () => { actions.issue(); setResponse(cardsBody("active")); },
          setFrozen: async (cardId, frozen) => {
            actions.setFrozen(cardId, frozen);
            setResponse(cardsBody(frozen ? "frozen" : "active"));
            if (refreshFails) { setReadFailed(true); throw new CardRefreshError(); }
          },
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
export const RestrictedBeforeIssue: Story = {
  args: { state: "restricted", initial: { ...cardsBody("restricted"), cards: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByText("You can't create a card right now.")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};
export const TwoCards: Story = {
  args: { state: "frozen", initial: twoCards },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("img").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Virtual card ending 4821", "Virtual card ending 1107, locked",
    ]);
    await expect(canvas.getByRole("switch", { name: "Lock card ending 4821" })).not.toBeChecked();
    await expect(canvas.getByRole("switch", { name: "Lock card ending 1107" })).toBeChecked();
  },
};
export const RefreshFailureAfterLock: Story = {
  args: { state: "active", refreshFails: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Lock card" }));
    await expect(await canvas.findByText("Card is unavailable right now")).toBeVisible();
    await expect(canvas.queryByText("Card locked")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821, locked" })).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { state: "unavailable" },
  play: async ({ canvasElement }) => {
    actions.onRetry.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(actions.onRetry).toHaveBeenCalledTimes(1);
  },
};
export const Loading: Story = { args: { state: "loading" } };
