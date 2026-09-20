import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  REIMAGINED_VAULT_ADDRESSES,
  reimaginedConfirmedState,
  reimaginedDebtState,
  reimaginedEmptyState,
  reimaginedFailedState,
  reimaginedFundedState,
  reimaginedLoadingState,
  reimaginedLongLocalizedState,
  reimaginedPendingState,
  reimaginedSavedUnavailableState,
  reimaginedUnknownState,
} from "./fixtures";
import { MoneyMap } from "./money-map";
import { reviewViewport } from "./story-viewports";

/**
 * Money Map review stories ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * Funded facts are identical in every story: cash $250.00, saved $1,000.00 (Gauntlet
 * $750.00 at 4.10%, Steakhouse $250.00 at 3.85%), net position $1,250.00, weighted rate
 * 4.04%, no debt, and the Sep 19 12:04 UTC clock.
 */

const meta = {
  id: "explorations-home-reimagined-money-map",
  title: "Explorations/Home reimagined/Money Map",
  component: MoneyMap,
  args: {
    initialState: reimaginedFundedState(),
  },
  ...reviewViewport("mobile"),
} satisfies Meta<typeof MoneyMap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Position directory: net position, available to use, and the positions that open detail. */
export const Home: Story = {};

/** The move-money workspace, interactive from the destination step through result. */
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

/** A recorded deposit waiting on the network. Balances are unchanged. */
export const MoveMoneyPending: Story = {
  args: {
    initialState: reimaginedPendingState(),
    initialScreen: "move",
    initialFlow: { step: "pending", movementId: "movement-gauntlet-100" },
  },
};

/** A confirmed deposit: cash $150.00, Gauntlet $850.00, saved $1,100.00, net $1,250.00. */
export const MoveMoneyConfirmed: Story = {
  args: {
    initialState: reimaginedConfirmedState(),
    initialScreen: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-confirmed" },
  },
};

/** A failed deposit with a deliberate retry path; nothing moved. */
export const MoveMoneyFailedRecovery: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialScreen: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-failed" },
  },
};

export const Activity: Story = {
  args: {
    initialTab: "activity",
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

/** Saved is unavailable: the net position stays incomplete instead of guessing. */
export const PartialUnavailable: Story = {
  args: {
    initialState: reimaginedSavedUnavailableState(),
  },
};

/** A movement recorded but not settled; it carries no balance change. */
export const PendingMovement: Story = {
  args: {
    initialState: reimaginedPendingState(),
  },
};

/** A failed movement on the home surface, with the exact safe next step. */
export const FailedRecovery: Story = {
  args: {
    initialState: reimaginedFailedState(),
  },
};

/** An unknown outcome cannot be retried from here on purpose. */
export const UnknownOutcome: Story = {
  args: {
    initialState: reimaginedUnknownState(),
  },
};

/** Positive debt stays visible and is subtracted from the net position. */
export const DebtPosition: Story = {
  args: {
    initialState: reimaginedDebtState(),
  },
};

/** Large balances, long vault names, and an IDR holding with no display quote. */
export const LongLocalizedContent: Story = {
  args: {
    initialState: reimaginedLongLocalizedState(),
  },
};

export const ActivityLongLocalizedContent: Story = {
  args: {
    initialState: reimaginedLongLocalizedState(),
    initialTab: "activity",
  },
};

/** Desktop review at 1280×800. */
export const DesktopHome: Story = {
  ...reviewViewport("desktop"),
};
