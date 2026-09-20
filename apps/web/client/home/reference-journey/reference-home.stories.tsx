import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { RegionId } from "@/config/regions";
import {
  presentReferencePosition,
  type ReferenceMoneyPosition,
} from "./reference-position";
import {
  ReferenceActivityHeader,
  ReferenceHomeComposition,
  type ReferenceHomeIntent,
  type ReferenceHomeVariant,
} from "./reference-home";
import {
  referenceActivity,
  referenceDebtPosition,
  referenceEmptyActivity,
  referenceEmptyPosition,
  referenceFundedPosition,
  referenceLoadingPosition,
  referenceLocalCashPosition,
  referenceLongContentPosition,
  referenceUnavailableCashPosition,
} from "./reference-fixtures";

/**
 * Reference Home option comparison for
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Status: **unapproved proposed design**, pending Jesse's review. Both options render the
 * same production-intended component (`ReferenceHomeComposition`) with the same fixture
 * position, so the only differences are grouping, hierarchy, density, and disclosure.
 * Fixture limits: no Next routing, no provider or wallet calls, no persistence, and the
 * account control is fixture chrome.
 */

type HomeOptionSurfaceProps = {
  variant: ReferenceHomeVariant;
  position: ReferenceMoneyPosition;
  activity: UseActivityResult;
  regionId: RegionId;
  reducedMotion?: boolean;
  onIntent?: (intent: ReferenceHomeIntent) => void;
};

function HomeOptionSurface({
  variant,
  position,
  activity,
  regionId,
  reducedMotion = false,
  onIntent,
}: HomeOptionSurfaceProps) {
  const surface = (
    <main className={`${shellContentFrameClassName} py-4`}>
      <ReferenceHomeComposition
        variant={variant}
        position={presentReferencePosition(position)}
        activityContent={
          <ActivityPanelView
            density="teaser"
            header={<ReferenceActivityHeader onOpen={() => {}} />}
            activity={activity}
            operations={[]}
            regionId={regionId}
          />
        }
        onIntent={onIntent}
        onOpenSave={() => {}}
        onOpenBorrow={() => {}}
        onOpenMoney={() => {}}
      />
    </main>
  );
  return (
    <PresentationRegionProvider regionId={regionId}>
      {reducedMotion ? <MoneyMotionProvider reducedMotion>{surface}</MoneyMotionProvider> : surface}
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

/** Facts that both Home options must present from the same fixture position. */
async function assertSharedHomeFacts(screen: ReturnType<typeof within>): Promise<void> {
  await expect(await screen.findByText("Net position")).toBeVisible();
  await expectMoneyValue(screen, "$1,250.00");
  await expect(await screen.findByText("Available to use $250.00")).toBeVisible();
  await expectMoneyValue(screen, "$250.00");
  await expectMoneyValue(screen, "$1,000.00");
  await expect((await screen.findAllByText("Cash")).length).toBeGreaterThan(0);
  await expect((await screen.findAllByText("Save")).length).toBeGreaterThan(0);
  await expect((await screen.findAllByText("4.04% APY")).length).toBeGreaterThan(0);
  await expect((await screen.findAllByText("Received")).length).toBeGreaterThan(0);
}

/** Row-level disclosure that only the ledger option carries. */
async function assertLedgerVaultRows(screen: ReturnType<typeof within>): Promise<void> {
  await expect(await screen.findByText("Gauntlet USDC Prime")).toBeVisible();
  await expect(await screen.findByText("4.10% APY")).toBeVisible();
  await expect(await screen.findByText("Steakhouse USDC")).toBeVisible();
  await expect(await screen.findByText("3.85% APY")).toBeVisible();
  await expectMoneyValue(screen, "$750.00");
}

const meta = {
  id: "reference-home",
  title: "Reference/Home options",
  component: HomeOptionSurface,
  args: {
    variant: "ledger",
    position: referenceFundedPosition,
    activity: referenceActivity(),
    regionId: "US",
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof HomeOptionSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Option A (recommended): one money ledger holds Cash, Save, and Borrow with row-level disclosure. */
export const LedgerFirst: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedHomeFacts(screen);
    await assertLedgerVaultRows(screen);
    await expect(await screen.findByText("Cash out")).toBeVisible();

    const addMoney = await screen.findByRole("button", { name: "Add money" });
    const saveRow = await screen.findByRole("button", { name: /Gauntlet USDC Prime/ });
    const activityRow = await screen.findAllByRole("button", { name: /^Received / });
    await expect(addMoney.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(saveRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(activityRow[0]!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
  parameters: {
    docs: {
      description: {
        story: "Every mandated action keeps a ≥44 CSS-pixel hit region; the play function measures the primary action, a ledger vault row, and an activity row.",
      },
    },
  },
};

/** Option B: Save and Borrow stay first-class tiles and Cash keeps its own card. */
export const TilesFirst: Story = {
  args: { variant: "tiles" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await assertSharedHomeFacts(screen);
    await expect(await screen.findByRole("button", { name: "Open Save" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Open Borrow" })).toBeVisible();
    await expect(await screen.findByText("No current debt")).toBeVisible();
    await expect(screen.queryByText("Cash out")).toBeNull();
    await expect(screen.queryByText("Gauntlet USDC Prime")).toBeNull();
  },
  parameters: {
    docs: {
      description: {
        story: "Option B keeps today's hub-and-drill-down grouping: the same numbers, but Save and Borrow remain product tiles and Cash out stays inside the existing Send flow rather than becoming a first-class Home action.",
      },
    },
  },
};

/** Representative desktop composition for the recommended option. */
export const LedgerFirstDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const LedgerFirstLoading: Story = {
  args: { position: referenceLoadingPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.queryByText("$1,250.00")).toBeNull();
    await expect(await screen.findByText("Net position")).toBeVisible();
  },
};

export const LedgerFirstEmpty: Story = {
  args: { position: referenceEmptyPosition, activity: referenceEmptyActivity() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expectMoneyValue(screen, "$0.00");
    await expect(await screen.findByText("Nothing saved yet")).toBeVisible();
    await expect(await screen.findByText("No activity yet")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Get started" })).toBeVisible();
  },
};

export const LedgerFirstPartial: Story = {
  args: { position: referenceUnavailableCashPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect((await screen.findAllByText("Cash balance unavailable")).length).toBeGreaterThan(0);
    await expectMoneyValue(screen, "—");
    await expect(screen.queryByText("$0.00")).toBeNull();
  },
  parameters: {
    docs: {
      description: {
        story: "An unavailable cash slice names the slice and leaves the headline blank; the fixture never renders a missing source as zero.",
      },
    },
  },
};

/** Positive debt stays visible and reduces the net position. */
export const LedgerFirstDebt: Story = {
  args: { position: referenceDebtPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Debt −$500.00")).toBeVisible();
    await expectMoneyValue(screen, "$750.00");
    await expect(await screen.findByText("Debt −$500.00")).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story: "Borrowed proceeds offset by debt: assets stay $1,250.00, debt is $500.00, and the headline net position is $750.00. The Borrow row repeats the debt instead of hiding it.",
      },
    },
  },
};

export const LedgerFirstLocalCash: Story = {
  args: { position: referenceLocalCashPosition, regionId: "ID" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Indonesian rupiah")).toBeVisible();
    const partialNotes = await screen.findAllByText(
      "IDR balance not included until a display quote is configured",
    );
    await expect(partialNotes.length).toBeGreaterThan(0);
  },
};

export const LedgerFirstLongContent: Story = {
  args: { position: referenceLongContentPosition },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(
      await screen.findByText("Gauntlet Diversified Onchain Treasury Savings Strategy Prime"),
    ).toBeVisible();
    await expectMoneyValue(screen, "$1,234,567.89");
    await expectMoneyValue(screen, "$12,345,678.99");
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const LedgerFirstReducedMotion: Story = {
  args: { reducedMotion: true },
  play: async ({ canvasElement }) => {
    const tickers = [
      ...canvasElement.ownerDocument.querySelectorAll<HTMLElement>("[data-slot='money-ticker']"),
    ];
    await expect(tickers.length).toBeGreaterThan(0);
    for (const ticker of tickers) {
      await expect(ticker.getAttribute("data-animated")).toBe("false");
    }
  },
  parameters: {
    docs: {
      description: {
        story: "Deterministic reduced-motion fixture: every money value stays byte-identical and unanimated. Production still follows prefers-reduced-motion; retain separate real-browser media-emulation proof.",
      },
    },
  },
};
