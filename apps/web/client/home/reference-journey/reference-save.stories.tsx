import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { useState } from "react";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { RegionId } from "@/config/regions";
import {
  presentReferencePosition,
  type ReferenceMoneyPosition,
} from "./reference-position";
import { ReferenceSaveComposition, type ReferenceSaveVariant } from "./reference-save";
import {
  referenceEmptyPosition,
  referenceFundedPosition,
  referenceLoadingPosition,
  referenceLongContentPosition,
  referenceUnavailableSavedPosition,
} from "./reference-fixtures";

/**
 * Reference Save option comparison for
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Status: **unapproved proposed design**, pending Jesse's review. Both options render the
 * same production-intended component (`ReferenceSaveComposition`) with the same fixture
 * position and the same selected vault. Fixture limits: no Next routing, no provider or
 * wallet calls, no persistence, and the deposit action is intentionally unwired here —
 * the connected journey story wires the existing deposit dialog.
 */

type SaveOptionSurfaceProps = {
  variant: ReferenceSaveVariant;
  position: ReferenceMoneyPosition;
  regionId: RegionId;
};

function SaveOptionSurface({ variant, position, regionId }: SaveOptionSurfaceProps) {
  const view = presentReferencePosition(position);
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<string | null>(
    view.saved.vaults.find((vault) => vault.funded)?.vaultAddress ?? null,
  );
  return (
    <PresentationRegionProvider regionId={regionId}>
      <main className={`${shellContentFrameClassName} py-4`}>
        <ReferenceSaveComposition
          variant={variant}
          position={view}
          selectedVaultAddress={selectedVaultAddress}
          onSelectVault={setSelectedVaultAddress}
          onDeposit={() => {}}
          onWithdraw={() => {}}
        />
      </main>
    </PresentationRegionProvider>
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

/** Facts that both Save options must present from the same fixture position. */
async function assertFundedSaveFacts(screen: ReturnType<typeof within>): Promise<void> {
  await expect(await screen.findByText("Saved")).toBeVisible();
  await expectMoneyValue(screen, "$1,000.00");
  await expect(await screen.findByText("Earning ~4.04%")).toBeVisible();
  await expect(await screen.findByText("Gauntlet USDC Prime")).toBeVisible();
  await expect(await screen.findByText("4.10% APY")).toBeVisible();
  await expectMoneyValue(screen, "$750.00");
  await expect(await screen.findByText("Steakhouse USDC")).toBeVisible();
  await expect(await screen.findByText("3.85% APY")).toBeVisible();
  await expectMoneyValue(screen, "$250.00");
  await expect(await screen.findByRole("button", { name: /^Deposit to / })).toBeVisible();
  await expect(await screen.findByRole("button", { name: /^Withdraw from / })).toBeVisible();
}

const meta = {
  id: "reference-save",
  title: "Reference/Save options",
  component: SaveOptionSurface,
  args: {
    variant: "ledger",
    position: referenceFundedPosition,
    regionId: "US",
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof SaveOptionSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Option A (recommended): one Saved hero plus a dense vault ledger and footer actions. */
export const LedgerFirst: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertFundedSaveFacts(screen);
    await expect(await screen.findByText("Vaults")).toBeVisible();
    await expect(await screen.findByLabelText("Gauntlet USDC Prime details")).toBeVisible();

    const deposit = await screen.findByRole("button", { name: /^Deposit to / });
    const gauntletRow = await screen.findByRole("radio", { name: /Gauntlet USDC Prime/ });
    await expect(deposit.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(gauntletRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    const steakhouseRow = await screen.findByRole("radio", { name: /Steakhouse USDC/ });
    steakhouseRow.click();
    await expect(await screen.findByLabelText("Steakhouse USDC details")).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story: "Only the selected vault discloses Fee and Curator. Selecting a different vault moves the disclosure instead of duplicating it.",
      },
    },
  },
};

/** Option B: the primary deposit action lives in the hero and vaults are larger cards. */
export const TilesFirst: Story = {
  args: { variant: "tiles" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertFundedSaveFacts(screen);
    await expect(await screen.findByText("Your vaults")).toBeVisible();
    await expect(await screen.findByLabelText("Gauntlet USDC Prime details")).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story: "Option B leads with the action inside the Saved hero and keeps each vault in its own larger card, separating the primary action from the balance list.",
      },
    },
  },
};

export const LedgerFirstDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const LedgerFirstLoading: Story = {
  args: { position: referenceLoadingPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.queryByText("$1,000.00")).toBeNull();
    await expect(await screen.findByText("Saved")).toBeVisible();
    await expect(await screen.findByText("Loading…")).toBeVisible();
    await expect(screen.queryByText("Nothing saved yet")).toBeNull();
  },
};

export const LedgerFirstEmpty: Story = {
  args: { position: referenceEmptyPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect((await screen.findAllByText("Nothing saved yet")).length).toBeGreaterThan(0);
    await expect(await screen.findByRole("radio", { name: /Gauntlet USDC Prime/ })).toBeVisible();
    await expect(await screen.findByRole("radio", { name: /Re7 USDC/ })).toBeVisible();
    await expectMoneyValue(screen, "$0.00");
  },
  parameters: {
    docs: {
      description: {
        story: "An empty Save states the zero balance, names the available vault and rate, and keeps Deposit enabled from the fixture's $250.00 cash.",
      },
    },
  },
};

export const LedgerFirstUnavailable: Story = {
  args: { position: referenceUnavailableSavedPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.queryByText("$0.00")).toBeNull();
    await expectMoneyValue(screen, "—");
    await expect((await screen.findAllByText("Saved balance unavailable")).length).toBeGreaterThan(0);
    await expect(screen.queryByText("Nothing saved yet")).toBeNull();
    await expect(screen.queryByRole("radio")).toBeNull();
    await expect(screen.queryByRole("button", { name: /^Deposit to / })).toBeNull();
  },
};

export const LedgerFirstLongContent: Story = {
  args: { position: referenceLongContentPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(
      await screen.findByText("Gauntlet Diversified Onchain Treasury Savings Strategy Prime"),
    ).toBeVisible();
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};
