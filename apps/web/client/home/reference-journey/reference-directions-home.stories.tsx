import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import {
  ReferenceDirectionsSurface,
  type ReferenceDirectionsSurfaceProps,
} from "./reference-directions-surface";
import { referenceActivity, referenceFundedPosition } from "./reference-fixtures";

/**
 * Three Home direction examples for
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Status: **unapproved direction examples**, pending Jesse's selection. Each story renders
 * the same production-intended compositions and the same `referenceFundedPosition` fixture
 * (cash $250.00, saved $1,000.00 at a combined 4.04% APY, net position $1,250.00), so the
 * only differences are grouping, hierarchy, disclosure, and action placement. The frame
 * renders the production `PrimaryNavigation`; Save is a Home-nested surface.
 *
 * Fixture limits, stated plainly: navigation is component state, not Next routing or
 * browser history; no provider, wallet, database, or live service is involved; `Add money`,
 * `Send`, `Invest`, and the activity `See all` remain labeled reference intents. Reading
 * these stories never authorizes production adoption.
 */

type DirectionStoryProps = Pick<
  ReferenceDirectionsSurfaceProps,
  "direction" | "position" | "activity" | "reducedMotion"
>;

function HomeDirectionSurface({
  direction,
  position,
  activity,
  reducedMotion,
}: DirectionStoryProps) {
  return (
    <ReferenceDirectionsSurface
      direction={direction}
      position={position}
      activity={activity}
      initialSurface="home"
      reducedMotion={reducedMotion}
      onOpenActivity={() => {}}
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

async function expectMinHeight(element: HTMLElement, minimum = 44): Promise<void> {
  await expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(minimum);
}


/** Facts every Home direction must present from the same fixture position. */
async function assertSharedHomeFacts(screen: ReturnType<typeof within>): Promise<void> {
  await expect(await screen.findByText("Net position")).toBeVisible();
  await expectMoneyValue(screen, "$1,250.00");
  await expectMoneyValue(screen, "$250.00");
  await expectMoneyValue(screen, "$1,000.00");
  await expect((await screen.findAllByText("4.04% APY")).length).toBeGreaterThan(0);
}

const meta = {
  id: "reference-directions-home",
  title: "Reference/Directions/Home",
  component: HomeDirectionSurface,
  args: {
    direction: "overview",
    position: referenceFundedPosition,
    activity: referenceActivity(),
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    docs: {
      description: {
        component:
          "**Unapproved direction examples** for #654, pending Jesse's selection. Overview-to-vault workspace (recommended), expandable statement, and tabbed workspace render the same fixture facts through `presentReferencePosition`. Fixture-level navigation and intents only; not production adoption.",
      },
    },
  },
} satisfies Meta<typeof HomeDirectionSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Recommended: net position, one Cash / Save summary list, one action band, recent activity. */
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedHomeFacts(screen);
    await expect(await screen.findByRole("button", { name: "Add money" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Send" })).toBeVisible();
    await expectMinHeight(await screen.findByRole("button", { name: "Add money" }));
    await expectMinHeight(await screen.findByRole("button", { name: "Send" }));

    // No per-vault list, no Borrow tile, and no promoted cash-out action on Home.
    await expect(screen.queryByText("Gauntlet USDC Prime")).toBeNull();
    await expect(screen.queryByText("Re7 USDC")).toBeNull();
    await expect(screen.queryByText(/Borrow/)).toBeNull();
    await expect(screen.queryByText("Cash out")).toBeNull();

    const saveRow = await screen.findByRole("button", { name: "Open Save" });
    await expectMinHeight(saveRow);
  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** The recommended direction states the net position first, keeps cash available in exactly one summary row, pairs the saved total with the combined APY, and leaves vault detail to the Save workspace the Save row opens. Every action keeps a ≥44 CSS-pixel hit region.",
      },
    },
  },
};

/** One statement boundary whose cash and saved rows disclose their detail in place. */
export const Statement: Story = {
  args: { direction: "statement" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedHomeFacts(screen);

    const cashRow = await screen.findByRole("button", { name: "Cash details" });
    await expect(cashRow).toHaveAttribute("aria-expanded", "true");
    await expectMinHeight(cashRow);
    // The cash actions stay with the cash row they act on.
    await expect(await screen.findByRole("button", { name: "Add money" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Send" })).toBeVisible();

    const saveRow = await screen.findByRole("button", { name: "Save details" });
    await expect(saveRow).toHaveAttribute("aria-expanded", "false");
  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** One statement owns the headline, the Cash and Save rows, and the disclosures; `aria-expanded`/`aria-controls` drive the rows, and the cash actions disappear with the cash row when it collapses.",
      },
    },
  },
};

/** Local owned tabs split Home's money facts from the Activity list. */
export const Workspace: Story = {
  args: { direction: "workspace" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedHomeFacts(screen);

    const moneyTab = await screen.findByRole("tab", { name: "Money" });
    await expect(moneyTab).toHaveAttribute("aria-selected", "true");
    await expect(await screen.findByRole("button", { name: "Add money" })).toBeVisible();
    await expect(screen.queryByText("Gauntlet USDC Prime")).toBeNull();
    await expect(screen.queryByText(/Borrow/)).toBeNull();

  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** The tabbed direction keeps the same money facts in the Money tab and makes Activity a real destination instead of a teaser; the tab triggers keep ≥44 CSS-pixel hit regions.",
      },
    },
  },
};

/** Representative desktop composition for the recommended overview direction. */
export const OverviewDesktop: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story: "**Unapproved.** The recommended Home direction at the 1280px review viewport: the same facts and hierarchy, with the wider card treatment.",
      },
    },
  },
};
