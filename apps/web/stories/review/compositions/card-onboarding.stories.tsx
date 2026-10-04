import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { CardScreen, type CardScreenData } from "@/client/cards/card-experience";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { shellContentFrameClassName, shellNavigationClearanceClassName } from "@/components/shell-layout";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

function CardOnboardingComposition({ initial = "not-enrolled" }: { initial?: Extract<CardState, "not-enrolled" | "active"> }) {
  const [response, setResponse] = useState<CardsResponse>(() => cardsBody(initial));
  const cards: CardScreenData = { status: "ready", response };
  return (
    <div className="flex h-svh flex-col bg-muted">
      <main id="navigation-panel" className={`min-h-0 flex-1 overflow-y-auto ${shellNavigationClearanceClassName}`}>
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
  id: "compositions-card-onboarding",
  title: "Compositions/Card Onboarding",
  component: CardOnboardingComposition,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    library: { render: "frame", order: 3 },
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
export const Active: Story = { args: { initial: "active" } };
