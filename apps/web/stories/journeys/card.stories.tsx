import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { CardScreen } from "@/client/cards/card-experience";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { shellContentFrameClassName, shellNavigationClearanceClassName } from "@/components/shell-layout";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

const actions = { onOpenVerification: fn(), onNavigate: fn() };
const kycUrl = "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_journey";

function CardJourney() {
  const [response, setResponse] = useState<CardsResponse>(() => cardsBody("not-enrolled"));
  return (
    <div className="flex h-svh flex-col bg-muted">
      <main className={`min-h-0 flex-1 overflow-y-auto ${shellNavigationClearanceClassName}`}>
        <div className={`${shellContentFrameClassName} py-4`}>
          <CardScreen
            cards={{ status: "ready", response }}
            onRetry={() => {}}
            onOpenVerification={(url) => { actions.onOpenVerification(url); setResponse(cardsBody("ready-to-issue")); }}
            commands={{
              enroll: async () => ({ kind: "redirect", url: kycUrl }),
              issue: async () => setResponse(cardsBody("active")),
              setFrozen: async (_cardId, frozen) => setResponse(cardsBody(frozen ? "frozen" : "active")),
            }}
          />
        </div>
      </main>
      <PrimaryNavigation activeNavigation="card" cardsEnabled onNavigate={actions.onNavigate} />
      <Toaster />
    </div>
  );
}

const meta = {
  id: "journeys-card",
  title: "Journeys/Card",
  component: CardJourney,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof CardJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const GetLockAndUnlock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole("button", { name: "Card", current: "page" })).toBeVisible();
    actions.onOpenVerification.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Get your card" }));
    await waitForReady(() => expect(actions.onOpenVerification).toHaveBeenCalledWith(kycUrl));
    await userEvent.click(await canvas.findByRole("button", { name: "Create your card" }));
    const toggle = await canvas.findByRole("switch", { name: "Lock card" });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(await body.findByText("Card locked")).toBeVisible();
    await waitForReady(() => expect(canvas.getByRole("switch", { name: "Lock card" })).toBeChecked());
    await expect(canvas.getByRole("img", { name: "Virtual card ending 4821, locked" })).toBeVisible();
    await userEvent.click(canvas.getByRole("switch", { name: "Lock card" }));
    await expect(await body.findByText("Card unlocked")).toBeVisible();
    await waitForReady(() => expect(canvas.getByRole("switch", { name: "Lock card" })).not.toBeChecked());
  },
};
