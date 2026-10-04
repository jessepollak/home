import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { CashExperience } from "@/client/cash/cash-experience";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { fixedNow, session, spark, SELECTED_VAULT, vaultsFixture, savingsVaultHandlers, startingSnapshot, fundedSnapshot, preparedAction } from "./explorations/savings-deposit.fixtures";

// The wallet boundary stays injected: Storybook owns no signer, and the
// journey asserts the exact action the production flow prepared and dispatched.
const journey = {
  prepared: [] as Array<{ endpoint: string; input: unknown }>,
  dispatched: [] as PreparedMoneyAction[],
};

function resetJourney() {
  journey.prepared.length = 0;
  journey.dispatched.length = 0;
}

const prepareMoneyAction = async (
  endpoint: string,
  input: unknown,
): Promise<PreparedMoneyAction> => {
  journey.prepared.push({ endpoint, input });
  const candidate = vaultsFixture.candidates.find((entry) => entry.vaultAddress.toLowerCase() === (input as { vaultAddress: string }).vaultAddress.toLowerCase());
  if (!candidate) throw new Error("No savings vault selected");
  return preparedAction(candidate, "25000000");
};

const executeMoneyAction = async (
  action: PreparedMoneyAction,
): Promise<OperationResult> => {
  journey.dispatched.push(action);
  await getHomeQueryClient().invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey(session), "actions") });
  return { id: action.id, status: "submitted" };
};

function SavingsJourneySurface() {
  const [view, setView] = useState<"cash" | "savings">("cash");
  const [snapshot, setSnapshot] = useState(startingSnapshot);
  return (
    <PresentationRegionProvider regionId="US">
      <main className={`${shellContentFrameClassName} py-4`}>
        <CashExperience view={view} onOpenSavings={() => setView("savings")}
          session={session} snapshot={snapshot} balanceStatus="ready"
          onRetryBalances={() => undefined} onAddMoney={() => undefined} now={fixedNow}
          prepareMoneyAction={prepareMoneyAction}
          fetchAccountResource={async () => {
            const action = preparedAction(spark, "25000000");
            return { actions: journey.dispatched.length === 0 ? [] : [{
              id: action.id, owner: action.owner, provider: "cdp-embedded",
              kind: action.kind, status: "confirmed",
              createdAt: action.createdAt, confirmedAt: action.createdAt,
              summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt, metadata: action.metadata },
            }] };
          }}
          executeMoneyAction={executeMoneyAction}
          onAddMoneyIntent={() => undefined}
        />
        <button type="button" onClick={() => setSnapshot(fundedSnapshot)}>Confirm snapshot</button>
      </main>
    </PresentationRegionProvider>
  );
}

const meta = {
  id: "journeys-savings-deposit",
  title: "Journeys/Savings Deposit",
  component: SavingsJourneySurface,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    msw: {
      handlers: savingsVaultHandlers,
    },
  },
} satisfies Meta<typeof SavingsJourneySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Deposit: Story = {
  play: async ({ canvasElement }) => {
    resetJourney();
    const document = canvasElement.ownerDocument;
    const screen = within(document.body);

    await userEvent.click(await within(await screen.findByRole("region", { name: "Savings" })).findByRole("button", { name: /^US dollar/ }));
    await expect(await screen.findByRole("heading", { name: "Earn on your savings" })).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Start saving" }));
    const options = await screen.findByRole("dialog", { name: "Choose where to save" });
    await expect(within(options).getByText("4.10% APY")).toBeVisible();
    await expect(journey.prepared).toHaveLength(0);
    await expect(journey.dispatched).toHaveLength(0);
    await userEvent.click(within(options).getByRole("button", { name: /^Spark USDC Vault/, description: "Deposit to Spark USDC Vault" }));
    let depositDialog = await screen.findByRole("dialog", { name: "Deposit" });
    await screen.findByRole("textbox", { name: "Amount" });
    depositDialog = screen.getByRole("dialog", { name: "Deposit" });
    await expect(within(depositDialog).getByText("Spark USDC Vault · 4.10% APY")).toBeVisible();
    await userEvent.click(within(depositDialog).getByRole("button", { name: "Back" }));
    await expect(await screen.findByRole("dialog", { name: "Choose where to save" })).toBeVisible();
    await userEvent.click(within(screen.getByRole("dialog", { name: "Choose where to save" })).getByRole("button", { name: /^Spark USDC Vault/, description: "Deposit to Spark USDC Vault" }));
    await screen.findByRole("textbox", { name: "Amount" });
    depositDialog = screen.getByRole("dialog", { name: "Deposit" });
    await expect(depositDialog).toBeVisible();
    await expect(journey.prepared).toHaveLength(0);
    await expect(journey.dispatched).toHaveLength(0);
    await userEvent.type(await within(depositDialog).findByRole("textbox", { name: "Amount" }), "25");
    await fireEvent.click(await within(depositDialog).findByRole("button", { name: "Continue" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "Confirm" });
    const amountRow = within(confirmDialog)
      .getAllByRole("definition")
      .find((node) => node.textContent === "$25.00");
    await expect(amountRow).toBeVisible();
    await expect(within(confirmDialog).getByText("Spark USDC Vault")).toBeVisible();
    await expect(within(confirmDialog).getByText("Base (8453)")).toBeVisible();
    await expect(
      within(confirmDialog).getByRole("button", { name: "Deposit $25.00" }),
    ).toBeVisible();
    await expect(journey.prepared).toEqual([
      {
        endpoint: "savings-deposit",
        input: {
          kind: "deposit",
          vaultAddress: SELECTED_VAULT,
          amountBaseUnits: "25000000",
        },
      },
    ]);

    await fireEvent.click(within(confirmDialog).getByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "Deposited $25.00 to Save" })).toBeVisible();
    await expect(screen.getByRole("dialog", { name: "Deposit" })).toBeVisible();
    await fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(journey.dispatched).toHaveLength(1);
    await expect(journey.dispatched[0]?.metadata).toMatchObject({
      product: "savings",
      vaultAddress: SELECTED_VAULT,
    });
    await expect(journey.dispatched[0]?.amounts[0]?.amountBaseUnits).toBe("25000000");
    await expect(await within(screen.getByLabelText("Savings balance")).findByRole("img", { name: "$25.00" })).toBeVisible();
    const pendingSavings = within(screen.getByRole("region", { name: "Your savings" }));
    await expect(pendingSavings.getByText("Pending")).toBeVisible();
    await expect(pendingSavings.getByRole("img", { name: "$25.00" })).toBeVisible();
    await expect(screen.queryByRole("button", { name: "Start saving" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Confirm snapshot" }));
    await expect(await screen.findByRole("region", { name: "Your savings" })).toBeVisible();
    await expect(within(screen.getByRole("region", { name: "Your savings" })).queryByText("Pending")).toBeNull();
  },
};
