import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { UseActivityResult } from "@/client/activity/use-activity";
import type { ReferenceMoneyPosition } from "./reference-position";
import { ReferenceJourney, type ReferenceJourneyView } from "./reference-journey";
import {
  referenceActivity,
  referenceEmptyActivity,
  referenceEmptyPosition,
  referenceExecuteMoneyAction,
  referenceFundedPosition,
  referencePrepareMoneyAction,
  referenceSession,
  referenceUnavailableCashPosition,
  referenceVaultMetadata,
} from "./reference-fixtures";

/**
 * Connected reference journey for
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Status: **unapproved proposed design**, pending Jesse's review.
 *
 * Fixture limits, stated precisely: this story simulates navigation and dispatch with
 * component state and injected fixture money-action functions. It does not exercise Next
 * routing or history, browser Back, provider or wallet behavior, a database, real
 * balances, or real money movement. `Add money`, `Send`, `Cash out`, `Borrow`,
 * `Your money`, `Withdraw`, and `Invest` are reference intents that keep their existing
 * production flows and are labeled as unwired when activated. Only the Save deposit and
 * the Activity detail path are connected.
 */

const pendingExecution: AccountWalletClient["executeMoneyAction"] = () => new Promise(() => {});

type JourneySurfaceProps = {
  position: ReferenceMoneyPosition;
  activity: UseActivityResult;
  execution: "confirmed" | "failed" | "pending";
  initialView?: ReferenceJourneyView;
};

function JourneySurface({ position, activity, execution, initialView }: JourneySurfaceProps) {
  return (
    <ReferenceJourney
      initialPosition={position}
      session={referenceSession}
      activity={activity}
      initialView={initialView}
      prepareMoneyAction={referencePrepareMoneyAction(referenceVaultMetadata)}
      executeMoneyAction={
        execution === "failed"
          ? referenceExecuteMoneyAction("failed")
          : execution === "pending"
            ? pendingExecution
            : referenceExecuteMoneyAction("confirmed")
      }
    />
  );
}

/** A money value is exposed as the ticker's `role="img"` accessible name. */
async function expectMoneyValue(
  screen: ReturnType<typeof within>,
  value: string,
): Promise<HTMLElement> {
  const matches = await screen.findAllByRole("img", { name: value });
  await expect(matches[0]).toBeVisible();
  return matches[0]!;
}

async function enterDepositReview(screen: ReturnType<typeof within>): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: /^Deposit to / }));
  await screen.findByRole("dialog", { name: "Deposit" });
  await userEvent.click(await screen.findByRole("button", { name: "2" }));
  await userEvent.click(await screen.findByRole("button", { name: "5" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await expect(await screen.findByRole("button", { name: "Deposit $25.00" })).toBeVisible();
}

const meta = {
  id: "reference-journey",
  title: "Reference/Connected journey",
  component: JourneySurface,
  args: {
    position: referenceFundedPosition,
    activity: referenceActivity(),
    execution: "confirmed",
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof JourneySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Home → Save → existing deposit amount → review → pending → result → return. */
export const FundedJourney: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Net position")).toBeVisible();
    await expectMoneyValue(screen, "$1,250.00");

    await userEvent.click(await screen.findByRole("button", { name: /Gauntlet USDC Prime/ }));
    await expect(await screen.findByText("Earning ~4.04%")).toBeVisible();

    await enterDepositReview(screen);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByText(/Fixture only — deposit simulated/)).toBeVisible();
    await expect(
      await screen.findByText(/Cash \$225\.00 · Saved \$1,025\.00 · Net position \$1,250\.00 unchanged\./),
    ).toBeVisible();

    const chrome = canvasElement.ownerDocument.querySelector("header");
    await userEvent.click(await within(chrome!).findByRole("button", { name: "Back" }));
    await expect(await screen.findByText("Net position")).toBeVisible();
    await expectMoneyValue(screen, "$225.00");
    await expectMoneyValue(screen, "$1,025.00");
    await expect(await screen.findByRole("button", { name: /Deposit USDC/ })).toHaveTextContent(
      "Confirmed",
    );
  },
  parameters: {
    docs: {
      description: {
        story: "The deposit keeps the exact 25 USDC amount, updates cash to $225.00 and saved to $1,025.00, and leaves the $1,250.00 net position unchanged. The confirmed action also appears in the Activity feed.",
      },
    },
  },
};

/** The existing deposit dialog keeps its failure state and recovery path. */
export const DepositFailureRecovery: Story = {
  args: { execution: "failed" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: /Gauntlet USDC Prime/ }));
    await enterDepositReview(screen);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));

    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "The deposit did not succeed onchain.",
    );
    await expect(screen.queryByText(/Fixture only/)).toBeNull();
    const back = (await screen.findAllByRole("button", { name: "Back" })).at(-1);
    await expect(back).toBeEnabled();
    await userEvent.click(back!);
    await expect(await screen.findByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

/** A pending fixture dispatch stays open until the wallet result resolves. */
export const PendingDeposit: Story = {
  args: { execution: "pending" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: /Gauntlet USDC Prime/ }));
    await enterDepositReview(screen);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));

    await expect(await screen.findByText("Waiting for your wallet…")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Close deposit dialog" })).toBeDisabled();
  },
};

/** Reference intents stay labeled instead of opening a provider or routing flow. */
export const ReferenceIntents: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Add money" }));
    await expect(
      await screen.findByText(/Reference intent — Add money keeps its existing production flow/),
    ).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Cash out" }));
    await expect(
      await screen.findByText(/Reference intent — Cash out keeps its existing production flow/),
    ).toBeVisible();
    await expect(screen.queryByRole("dialog")).toBeNull();
  },
};

/** Activity → transaction detail → return to the list. */
export const ActivityDetail: Story = {
  args: { initialView: "activity" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("End of activity")).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: /^Received .*250\.00 USDC$/ }));
    await expect(await screen.findByRole("dialog", { name: "Received USDC" })).toBeVisible();
    await userEvent.click(
      await screen.findByRole("button", { name: "Close transaction details" }),
    );
    await expect(await screen.findByText("End of activity")).toBeVisible();
  },
};

export const EmptyJourney: Story = {
  args: { position: referenceEmptyPosition, activity: referenceEmptyActivity() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expectMoneyValue(screen, "$0.00");
    await expect(await screen.findByText("Nothing saved yet")).toBeVisible();
    await expect(await screen.findByText("No activity yet")).toBeVisible();
  },
};

export const UnavailableCashJourney: Story = {
  args: { position: referenceUnavailableCashPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(
      (await screen.findAllByText("Cash balance unavailable")).length,
    ).toBeGreaterThan(0);
    await expect(screen.queryByText("$0.00")).toBeNull();
  },
};
