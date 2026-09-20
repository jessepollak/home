import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, passthrough } from "msw";
import { reimaginedFundedState, reimaginedLongLocalizedState } from "./fixtures";
import { ReferenceHome } from "./reference-home";
import { ReferenceComparison } from "./reference-comparison";
import { homeReimaginedViewports, reviewViewport } from "./story-viewports";

const meta = {
  id: "explorations-home-reimagined-astra",
  title: "Explorations/Home reimagined/Astra",
  component: ReferenceHome,
  args: { initialState: reimaginedFundedState() },
  ...reviewViewport("mobile"),
  parameters: {
    ...reviewViewport("mobile").parameters,
    docs: { description: { component: "Reference-led funded Home. Fixed Sep 19, 2026 fixtures: net $1,250; available cash $250; saved $1,000; combined 4.04% APY; no debt. Actions open explicit fixture-only modal handoff notices; no wallet, network, trade, or balance mutation. Activity is the existing plain-transfer history, not an invented savings ledger." } },
  },
} satisfies Meta<typeof ReferenceHome>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Canonical full-size 390×844 composition. */
export const FundedHome: Story = {};

/** Unscaled 390px boards; horizontally scroll, do not shrink them to fit. */
export const ReferenceComparisonBoard: Story = {
  render: () => <ReferenceComparison />,
  ...reviewViewport("desktop"),
  parameters: {
    ...reviewViewport("desktop").parameters,
    // Permit only this same-origin static reference; the global network guard remains intact.
    msw: { handlers: [http.get("/references/mercury-official-promotional.png", () => passthrough())] },
  },
};

export const Narrow320: Story = {
  globals: { viewport: { value: "narrow" } },
  parameters: {
    viewport: { options: { ...homeReimaginedViewports, narrow: { name: "Narrow Home (320×844)", styles: { width: "320px", height: "844px" } } } },
  },
};

/** Existing large/long fixture, including the honest unquoted-IDR exclusion note. */
export const LargeAmounts: Story = { args: { initialState: reimaginedLongLocalizedState() } };

/** The same composition, centered and constrained, not a second desktop direction. */
export const DesktopFit: Story = { ...reviewViewport("desktop") };
