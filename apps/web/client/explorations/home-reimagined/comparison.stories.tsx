import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HomeReimaginedComparison } from "./comparison";
import {
  reimaginedFundedState,
  reimaginedPendingState,
} from "./fixtures";
import { reviewViewport } from "./story-viewports";

/**
 * Side-by-side comparison for the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * Every direction renders the same funded facts at real device width, so the comparison is
 * about information architecture, navigation, hierarchy, density, action model, and tone.
 */

const meta = {
  id: "explorations-home-reimagined-comparison",
  title: "Explorations/Home reimagined/Comparison",
  component: HomeReimaginedComparison,
  args: {
    initialState: reimaginedFundedState(),
  },
  ...reviewViewport("desktop"),
} satisfies Meta<typeof HomeReimaginedComparison>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Four homes, one set of facts. Scroll sideways to compare at 390px each. */
export const Homes: Story = {};

/** The same board with one deposit still settling: nothing has moved anywhere. */
export const HomesWithPendingMovement: Story = {
  args: {
    initialState: reimaginedPendingState(),
  },
};
