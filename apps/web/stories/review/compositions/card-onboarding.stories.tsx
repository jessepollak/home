import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { CardScreen, type CardScreenData } from "@/client/cards/card-experience";
import { shellDesktopContentClassName } from "@/components/shell-layout";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import { CompositionShell, compositionShellHandlers } from "../../journeys/explorations/composition-shell";

function CardOnboardingComposition({ initial = "not-enrolled" }: { initial?: Extract<CardState, "not-enrolled" | "active"> }) {
  const [response, setResponse] = useState<CardsResponse>(() => cardsBody(initial));
  const cards: CardScreenData = { status: "ready", response };
  return <CompositionShell>
    <div className={shellDesktopContentClassName} data-shell-panel-id="card">
      <CardScreen cards={cards} onRetry={() => {}} onOpenVerification={() => setResponse(cardsBody("ready-to-issue"))}
        commands={{
          enroll: async () => ({ kind: "redirect", url: "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_journey" }),
          issue: async () => setResponse(cardsBody("active")),
          setFrozen: async (_cardId, frozen) => setResponse(cardsBody(frozen ? "frozen" : "active")),
        }} />
    </div>
  </CompositionShell>;
}

const meta = {
  id: "compositions-card-onboarding",
  title: "Compositions/Card Onboarding",
  component: CardOnboardingComposition,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    library: { render: "frame", order: 2 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    nextjs: { navigation: { pathname: "/card" } },
    msw: { handlers: compositionShellHandlers },
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
export const Active: Story = { name: "Card Active", args: { initial: "active" } };
