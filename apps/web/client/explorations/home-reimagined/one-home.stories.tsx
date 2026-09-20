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
import { OneHome } from "./one-home";
import { reviewViewport } from "./story-viewports";

/**
 * One Home review stories ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * One scroll of financial chapters with a Jump-to index and no persistent product tabs.
 * The Activity story starts on its chapter; moving money is a deliberate takeover of the
 * page rather than a tab.
 */

const meta = {
  id: "explorations-home-reimagined-one-home",
  title: "Explorations/Home reimagined/One Home",
  component: OneHome,
  args: {
    initialState: reimaginedFundedState(),
  },
  ...reviewViewport("mobile"),
} satisfies Meta<typeof OneHome>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The top of the scroll: Jump-to index, position chapter, then Move. */
export const Home: Story = {};

/** The move takeover at review, with exact facts and no tabs behind it. */
export const MoveMoney: Story = {
  args: {
    initialView: "move",
    initialFlow: {
      step: "review",
      destinationId: REIMAGINED_VAULT_ADDRESSES.gauntlet,
      amountText: "100",
    },
  },
};

/** A submitted deposit in the takeover; balances are unchanged. */
export const MoveMoneyPending: Story = {
  args: {
    initialState: reimaginedPendingState(),
    initialView: "move",
    initialFlow: { step: "pending", movementId: "movement-gauntlet-100" },
  },
};

/** A confirmed deposit: cash $150.00, saved $1,100.00, net $1,250.00. */
export const MoveMoneyConfirmed: Story = {
  args: {
    initialState: reimaginedConfirmedState(),
    initialView: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-confirmed" },
  },
};

/** A failed deposit inside the takeover, with the deliberate retry path. */
export const MoveMoneyFailedRecovery: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialView: "move",
    initialFlow: { step: "result", movementId: "movement-gauntlet-100-failed" },
  },
};

/** The Activity chapter, reached by the same jump link a person would use. */
export const Activity: Story = {
  args: {
    initialState: reimaginedFailedState(),
    initialChapterId: "one-home-activity",
  },
};

/** The Saved chapter, where vault-level facts live. */
export const SavedChapter: Story = {
  args: {
    initialChapterId: "one-home-saved",
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
