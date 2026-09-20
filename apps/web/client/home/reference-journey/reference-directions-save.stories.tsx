import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import {
  ReferenceDirectionsSurface,
  type ReferenceDirectionsSurfaceProps,
} from "./reference-directions-surface";
import { referenceActivity, referenceFundedPosition } from "./reference-fixtures";

/**
 * Three Save direction examples for
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Status: **unapproved direction examples**, pending Jesse's selection. Each story renders
 * the paired Save surface of the Home direction in
 * `reference-directions-home.stories.tsx` over the same `referenceFundedPosition` fixture
 * (saved $1,000.00 at a combined 4.04% APY; Gauntlet $750.00 and Steakhouse $250.00 funded,
 * Re7 accessible at $0.00). The frame renders the production `PrimaryNavigation` with Home
 * active and a Back affordance, because Save is Home-nested.
 *
 * Fixture limits, stated plainly: navigation is component state, not Next routing or
 * browser history; no provider, wallet, database, or live service is involved; Deposit and
 * Withdraw keep the connected journey's callback shape but are unlabeled no-ops here, so no
 * story simulates a provider result. Reading these stories never authorizes production
 * adoption.
 */

type DirectionStoryProps = Pick<
  ReferenceDirectionsSurfaceProps,
  "direction" | "position" | "activity" | "reducedMotion"
>;

function SaveDirectionSurface({
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
      initialSurface="save"
      reducedMotion={reducedMotion}
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


/** Facts every Save direction must present from the same fixture position. */
async function assertSharedSaveFacts(screen: ReturnType<typeof within>): Promise<void> {
  await expect(await screen.findByText("Saved")).toBeVisible();
  await expectMoneyValue(screen, "$1,000.00");
  await expect(await screen.findByText("Earning ~4.04%")).toBeVisible();
  await expect(await screen.findByText("Gauntlet USDC Prime")).toBeVisible();
  await expect(await screen.findByText("4.10% APY")).toBeVisible();
  await expectMoneyValue(screen, "$750.00");
}

const meta = {
  id: "reference-directions-save",
  title: "Reference/Directions/Save",
  component: SaveDirectionSurface,
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
          "**Unapproved direction examples** for #654, pending Jesse's selection. The recommended selected-vault workspace, an expandable statement, and a tabbed workspace share the Home pair's fixture, presenter, and selected-vault contract. Fixture-level interactions only; not production adoption.",
      },
    },
  },
} satisfies Meta<typeof SaveDirectionSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Recommended: saved aggregate, change-vault Select, one workspace with scoped actions. */
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedSaveFacts(screen);

    const picker = await screen.findByRole("combobox", { name: "Vault" });
    await expect(picker).toHaveTextContent("Change vault");
    await expectMinHeight(picker);

    const deposit = await screen.findByRole("button", { name: "Deposit to Gauntlet USDC Prime" });
    const withdraw = await screen.findByRole("button", { name: "Withdraw from Gauntlet USDC Prime" });
    await expect(deposit).toBeVisible();
    await expectMinHeight(deposit);
    await expectMinHeight(withdraw);

    const details = await screen.findByRole("button", { name: "Vault details" });
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(screen.queryByRole("definition")).toBeNull();
  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** The recommended direction keeps one selected-vault workspace: the change-vault `Select`, the Fee/Curator disclosure, and the Deposit (primary) / Withdraw (quiet) band all follow the visible vault name. Deposit and Withdraw are ≥44 CSS pixels.",
      },
    },
  },
};

/** One statement boundary where each vault row discloses its own details and actions. */
export const Statement: Story = {
  args: { direction: "statement" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedSaveFacts(screen);

    const gauntletRow = await screen.findByRole("button", { name: "Gauntlet USDC Prime details" });
    await expect(gauntletRow).toHaveAttribute("aria-expanded", "true");
    await expectMinHeight(gauntletRow);
    const steakhouseRow = await screen.findByRole("button", { name: "Steakhouse USDC details" });
    await expect(steakhouseRow).toHaveAttribute("aria-expanded", "false");
    await expect(
      await screen.findByRole("button", { name: "Deposit to Gauntlet USDC Prime" }),
    ).toBeVisible();

    // Re7 stays reachable as the last row in the statement.
    await expect(await screen.findByRole("button", { name: "Re7 USDC details" })).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** One statement owns the saved aggregate; each vault row discloses Fee/Curator and its own scoped actions, so a vault with $0.00 (Re7) stays reachable but withdraw stays disabled.",
      },
    },
  },
};

/** Local owned tabs split the funded workspace from the full vault list. */
export const Workspace: Story = {
  args: { direction: "workspace" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedSaveFacts(screen);
    await expect(await screen.findByText("Selected · Gauntlet USDC Prime")).toBeVisible();
    await expect(
      await screen.findByRole("radio", { name: /Gauntlet USDC Prime/ }),
    ).toHaveAttribute("aria-checked", "true");

    const savingsTab = await screen.findByRole("tab", { name: "Your savings" });
    await expect(savingsTab).toHaveAttribute("aria-selected", "true");

  },
  parameters: {
    docs: {
      description: {
        story: "**Unapproved.** The tabbed direction states the selected target explicitly, keeps one normal-flow action band in Your savings, and offers Re7 in the secondary All vaults tab. Tab triggers and actions are ≥44 CSS pixels.",
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
        story: "**Unapproved.** The recommended Save direction at the 1280px review viewport, unchanged facts and hierarchy.",
      },
    },
  },
};
