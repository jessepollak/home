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
  reimaginedUnknownState,
} from "./fixtures";
import { MoneyDesk } from "./money-desk";
import { reviewViewport } from "./story-viewports";

/**
 * Money Desk review stories ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * Move is the first tab: the deposit is one explicit amount → review → result workspace with
 * a visible step rail and an inline destination choice, so no vault is selected by rate.
 */

const meta = {
  id: "explorations-home-reimagined-money-desk",
  title: "Explorations/Home reimagined/Money Desk",
  component: MoneyDesk,
  args: {
    initialState: reimaginedFundedState(),
  },
  ...reviewViewport("mobile"),
} satisfies Meta<typeof MoneyDesk>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The workspace at the amount step, with the destination chosen inline. */
export const Home: Story = {};

/** The same workspace at review: exact facts and a visible step rail. */
export const MoveMoney: Story = {
  args: {
    initialFlow: {
      step: "review",
      destinationId: REIMAGINED_VAULT_ADDRESSES.gauntlet,
      amountText: "100",
    },
  },
};

/** A submitted deposit waiting on Base; balances are unchanged. */
export const MoveMoneyPending: Story = {
  args: {
    initialState: reimaginedPendingState(),
    initialFlow: { step: "pending", movementId: "movement-gauntlet-100" },
  },
};

/** A confirmed deposit: cash $150.00, saved $1,100.00, net $1,250.00. */
export const MoveMoneyConfirmed: Story = {
  args: {
    initialState: reimaginedConfirmedState(),
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-confirmed" },
  },
};

/** A failed deposit with a deliberate retry; nothing moved. */
export const MoveMoneyFailedRecovery: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-failed" },
  },
};

/** An unknown outcome, shown without a retry affordance. */
export const MoveMoneyUnknownOutcome: Story = {
  args: {
    initialState: reimaginedUnknownState(),
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-unknown" },
  },
};

/** The workspace log: needs attention, in progress, settled. */
export const Activity: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialTab: "activity",
  },
};

/** The facts ledger, with vault rates as reported facts and their provenance. */
export const MoneyFacts: Story = {
  args: {
    initialTab: "money",
  },
};

export const Loading: Story = {
  args: {
    initialState: reimaginedLoadingState(),
    initialTab: "money",
  },
};

export const VerifiedEmpty: Story = {
  args: {
    initialState: reimaginedEmptyState(),
    initialTab: "money",
  },
};

export const PartialUnavailable: Story = {
  args: {
    initialState: reimaginedSavedUnavailableState(),
    initialTab: "money",
  },
};
