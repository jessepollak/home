import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { SavingsJourney } from "@/client/savings/savings-actions";
import { SavingsDialogFixtureProvider } from "@/client/savings/savings-dialog-fixture";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { session, spark, preparedAction } from "../../journeys/explorations/savings-deposit.fixtures";
import { fetchStoryResource } from "../../journeys/explorations/home-pull-to-refresh.fixtures";
import { sendRecipientHandlers } from "../../journeys/explorations/send-recipient.fixtures";

type State = "ready" | "preparing" | "error";

function DepositComposition({ state }: { state: State }) {
  const [open, setOpen] = useState(true);
  return <PresentationRegionProvider regionId="US">
    <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
      <SavingsJourney open={open} entry="amount" management={null} mode="deposit" session={session} candidate={spark}
        availableLabel="$250.00 available" availableBaseUnits="250000000" destinationLabel="Spark USDC Vault · 4.10% APY"
        fetchAccountResource={fetchStoryResource}
        prepareMoneyAction={async () => {
          if (state === "preparing") return new Promise<never>(() => {});
          if (state === "error") throw new Error("Couldn't prepare the deposit. Try again.");
          return preparedAction(spark, "25000000");
        }}
        executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })}
        onSelectMode={() => {}} onBackToManagement={() => {}} onClose={() => setOpen(false)} />
    </SavingsDialogFixtureProvider>
  </PresentationRegionProvider>;
}

const meta = {
  title: "Compositions/Deposit to Savings",
  component: DepositComposition,
  args: { state: "ready" },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 2 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
    msw: { handlers: [...sendRecipientHandlers, http.get("/api/actions", () => HttpResponse.json({ actions: [] }))] },
  },
} satisfies Meta<typeof DepositComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

async function enterAmount(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  const dialog = await screen.findByRole("dialog", { name: "Deposit" });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "25");
  return screen;
}

export const DepositToSavings: Story = {
  name: "Deposit to Savings",
  play: async ({ canvasElement }) => {
    const screen = await enterAmount(canvasElement);
    await expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("25");
  },
};

export const DepositReview: Story = {
  play: async ({ canvasElement }) => {
    const screen = await enterAmount(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const review = await screen.findByRole("dialog", { name: "Confirm" });
    await expect(within(review).getByRole("button", { name: "Deposit $25.00" })).toBeVisible();
  },
};

export const DepositSubmitted: Story = {
  name: "Deposit Submitted",
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvasElement }) => {
    const screen = await enterAmount(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const review = await screen.findByRole("dialog", { name: "Confirm" });
    await userEvent.click(within(review).getByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "Depositing $25.00 to Save" })).toBeVisible();
  },
};

export const DepositLoading: Story = {
  args: { state: "preparing" },
  play: async ({ canvasElement }) => {
    const screen = await enterAmount(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("aria-busy", "true");
  },
};

export const DepositError: Story = {
  args: { state: "error" },
  play: async ({ canvasElement }) => {
    const screen = await enterAmount(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(await screen.findByRole("alert")).toBeVisible();
  },
};
