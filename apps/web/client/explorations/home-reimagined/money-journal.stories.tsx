import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  REIMAGINED_VAULT_ADDRESSES,
  reimaginedConfirmedState,
  reimaginedEmptyState,
  reimaginedFailedState,
  reimaginedFundedState,
  reimaginedLoadingState,
  reimaginedPendingState,
  reimaginedSavedUnavailableState,
} from "./fixtures";
import { MoneyJournal } from "./money-journal";
import { reviewViewport } from "./story-viewports";

/**
 * Money Journal review stories ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * Today leads with a compact position line, any unresolved entry, and dated receipts;
 * Money is a short statement, and the full ledger of entries is its own screen.
 */

const meta = {
  id: "explorations-home-reimagined-money-journal",
  title: "Explorations/Home reimagined/Money Journal",
  component: MoneyJournal,
  args: {
    initialState: reimaginedFundedState(),
  },
  ...reviewViewport("mobile"),
} satisfies Meta<typeof MoneyJournal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Today: compact position context, primary entry action, and today's receipts. */
export const Home: Story = {};

/** The new-entry flow at its review step, with the exact receipt facts. */
export const MoveMoney: Story = {
  args: {
    initialScreen: "move",
    initialFlow: {
      step: "review",
      destinationId: REIMAGINED_VAULT_ADDRESSES.gauntlet,
      amountText: "100",
    },
  },
};

/** An entry submitted and still open. Balances are unchanged. */
export const MoveMoneyPending: Story = {
  args: {
    initialState: reimaginedPendingState(),
    initialScreen: "move",
    initialFlow: { step: "pending", movementId: "movement-gauntlet-100" },
  },
};

/** A recorded entry: cash $150.00, saved $1,100.00, net $1,250.00. */
export const MoveMoneyConfirmed: Story = {
  args: {
    initialState: reimaginedConfirmedState(),
    initialScreen: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-confirmed" },
  },
};

/** A failed entry with its recovery path; nothing moved. */
export const MoveMoneyFailedRecovery: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialScreen: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-failed" },
  },
};

/** The dated ledger: unresolved entries first, then receipts grouped by day. */
export const Activity: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialScreen: "entries",
  },
};

export const ActivitySettledOnly: Story = {
  args: {
    initialScreen: "entries",
  },
};

export const Loading: Story = {
  args: {
    initialState: reimaginedLoadingState(),
  },
};

export const VerifiedEmpty: Story = {
  args: {
    initialState: reimaginedEmptyState(),
  },
};

export const PartialUnavailable: Story = {
  args: {
    initialState: reimaginedSavedUnavailableState(),
  },
};
