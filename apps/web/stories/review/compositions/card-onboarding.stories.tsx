import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CardScreen, type CardScreenData } from "@/client/cards/card-experience";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { shellContentFrameClassName, shellNavigationClearanceClassName } from "@/components/shell-layout";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

function CardOnboardingComposition({ initial = "not-enrolled" }: { initial?: CardState | "loading" | "failed" }) {
  const [response, setResponse] = useState<CardsResponse>(() => cardsBody(initial === "loading" || initial === "failed" ? "not-enrolled" : initial));
  const cards: CardScreenData = initial === "loading" || initial === "failed" ? { status: initial } : { status: "ready", response };
  return (
    <div className="flex h-svh flex-col bg-muted">
      <main className={`min-h-0 flex-1 overflow-y-auto ${shellNavigationClearanceClassName}`}>
        <div className={`${shellContentFrameClassName} py-4`}>
          <CardScreen cards={cards} onRetry={() => {}} onOpenVerification={() => setResponse(cardsBody("ready-to-issue"))}
            commands={{
              enroll: async () => "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_journey",
              issue: async () => setResponse(cardsBody("active")),
              setFrozen: async (_cardId, frozen) => setResponse(cardsBody(frozen ? "frozen" : "active")),
            }} />
        </div>
      </main>
      <PrimaryNavigation activeNavigation="card" cardsEnabled onNavigate={() => {}} />
      <Toaster />
    </div>
  );
}

const meta = {
  title: "Compositions/Card Onboarding",
  component: CardOnboardingComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 6 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
  },
} satisfies Meta<typeof CardOnboardingComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CardOnboarding: Story = {
  name: "Card Onboarding",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Spend your Cash with a card" })).toBeVisible();
  },
};
export const VerificationRequired: Story = { args: { initial: "verification-required" } };
export const CardVerification: Story = { name: "Card Verification", args: { initial: "verification-pending" } };
export const ReadyToIssue: Story = { args: { initial: "ready-to-issue" } };
export const CardIssued: Story = {
  name: "Card Issued",
  args: { initial: "ready-to-issue" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create your card" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
  },
};
export const Active: Story = { args: { initial: "active" } };
export const Frozen: Story = { args: { initial: "frozen" } };
export const Restricted: Story = { args: { initial: "restricted" } };
export const Ineligible: Story = { args: { initial: "ineligible" } };
export const Canceled: Story = { args: { initial: "canceled" } };
export const Loading: Story = { args: { initial: "loading" } };
export const Error: Story = { args: { initial: "failed" } };
export const Unavailable: Story = { args: { initial: "unavailable" } };
