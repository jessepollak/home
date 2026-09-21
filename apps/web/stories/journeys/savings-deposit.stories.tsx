import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { HttpResponse, http } from "msw";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { SavingsExperience } from "@/client/savings/savings-experience";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type {
  MorphoVaultCandidate,
  MorphoVaultsResult,
} from "@/shared/savings/types";

// Reference journey story: page-level UI composed from production components,
// with the production `/api/savings/vaults` fetch served by MSW and a `play`
// function that walks the money flow. See docs/design-system.md for the
// discover -> compose -> run-story-tests -> capture-proof loop.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const FIXTURE_TIME = "2026-09-10T12:04:00.000Z";
const FIXTURE_NOW = Date.parse(FIXTURE_TIME);
const fixedNow = () => FIXTURE_NOW;
const [STEAKHOUSE, GAUNTLET] = MORPHO_V1_CANDIDATE_ADDRESSES;
const SELECTED_VAULT = STEAKHOUSE;

const session: VerifiedAccountSession = {
  user: { subject: "storybook-savings-journey-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function candidate(
  vaultAddress: MorphoVaultCandidate["vaultAddress"],
  name: string,
  netApy: number,
  curatorAddress: MorphoVaultCandidate["curatorAddress"] = null,
): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress,
    name,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress,
    grossApy: netApy + 0.005,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1250000000000",
    liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z",
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-10T12:00:00.000Z",
    },
  };
}

const steakhouse = candidate(STEAKHOUSE, "Steakhouse USDC", 0.0385);
const gauntlet = candidate(GAUNTLET, "Gauntlet USDC Prime", 0.041);

// The only network boundary in the flow: the production vault-metadata fetch.
const vaultsFixture: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [gauntlet, steakhouse],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-10T12:00:00.000Z",
  },
  stale: false,
};

type VaultPosition = {
  vaultAddress: string;
  position: { assetsRaw: string } | null;
};

const fundedPositions: VaultPosition[] = MORPHO_V1_CANDIDATE_ADDRESSES.map(
  (vaultAddress) => ({
    vaultAddress,
    position: {
      assetsRaw: vaultAddress === GAUNTLET
        ? "987654321"
        : vaultAddress === STEAKHOUSE
          ? "123456789"
          : "0",
    },
  }),
);

function preparedAction(
  vault: MorphoVaultCandidate,
  amountBaseUnits: string,
): PreparedMoneyAction {
  return {
    id: "storybook-journey-savings-deposit",
    kind: "savings-deposit",
    title: "Deposit USDC",
    createdAt: "2026-09-10T12:03:00.000Z",
    expiresAt: "2099-09-10T12:03:00.000Z",
    calls: [],
    amounts: [
      {
        assetId: "usdc",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits,
        direction: "spend",
      },
      {
        assetId: "vault",
        symbol: "vault shares",
        decimals: 18,
        amountBaseUnits: "24000000000000000000",
        direction: "receive",
        estimated: true,
      },
    ],
    warnings: [],
    metadata: {
      product: "savings",
      operation: "deposit",
      vaultAddress: vault.vaultAddress,
      vaultName: vault.name,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "250000000",
      previewSharesBaseUnits: "24000000000000000000",
      shareDecimals: 18,
      exchangeConstraint: "deposit-preview-no-minimum-shares",
      discoveryRate: {
        status: "current",
        netApy: String(vault.netApy),
        fetchedAt: FIXTURE_TIME,
        stateAsOf: FIXTURE_TIME,
      },
      source: {
        blockNumber: "51026404",
        blockHash: `0x${"ab".repeat(32)}`,
        blockTimestamp: "1789041840",
      },
    },
    owner: {
      subject: session.user.subject,
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: session.accountProvider,
    },
  };
}

// The wallet boundary stays injected: Storybook owns no signer, and the
// journey asserts the exact action the production flow prepared and dispatched.
const journey = {
  prepared: [] as Array<{ endpoint: string; input: unknown }>,
  dispatched: [] as PreparedMoneyAction[],
};

function resetJourney() {
  journey.prepared.length = 0;
  journey.dispatched.length = 0;
}

const prepareMoneyAction = async (
  endpoint: string,
  input: unknown,
): Promise<PreparedMoneyAction> => {
  journey.prepared.push({ endpoint, input });
  return preparedAction(steakhouse, "25000000");
};

const executeMoneyAction = async (
  action: PreparedMoneyAction,
): Promise<OperationResult> => {
  journey.dispatched.push(action);
  return { id: action.id, status: "confirmed" };
};

function SavingsJourneySurface() {
  return (
    <PresentationRegionProvider regionId="US">
      <main className={`${shellContentFrameClassName} py-4`}>
        <SavingsExperience
          session={session}
          now={fixedNow}
          availableUsdcBaseUnits="250000000"
          balancePositions={fundedPositions}
          balanceStatus="ready"
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
        />
      </main>
    </PresentationRegionProvider>
  );
}

const meta = {
  id: "journeys-savings-deposit",
  title: "Journeys/Savings Deposit",
  component: SavingsJourneySurface,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    msw: {
      handlers: [
        http.get("/api/savings/vaults", () => HttpResponse.json(vaultsFixture)),
      ],
    },
  },
} satisfies Meta<typeof SavingsJourneySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Deposit: Story = {
  play: async ({ canvasElement }) => {
    resetJourney();
    const document = canvasElement.ownerDocument;
    const screen = within(document.body);

    // Vault metadata arrives over the production `/api/savings/vaults` fetch,
    // served here by the story's MSW handler.
    const gauntletRow = await screen.findByRole("radio", {
      name: /Gauntlet USDC Prime/,
    });
    const steakhouseRow = await screen.findByRole("radio", {
      name: /Steakhouse USDC/,
    });
    await expect(within(gauntletRow).getByText("4.10%")).toBeVisible();
    await expect(within(steakhouseRow).getByText("3.85%")).toBeVisible();

    await userEvent.click(steakhouseRow);
    await expect(
      await screen.findByRole("radio", { name: /Steakhouse USDC/ }),
    ).toHaveAttribute("aria-checked", "true");
    const detailsId = `vault-${SELECTED_VAULT}-details`;
    await expect(
      await screen.findByRole("radio", { name: /Steakhouse USDC/ }),
    ).toHaveAttribute("aria-controls", detailsId);
    const details = document.getElementById(detailsId);
    if (details === null) throw new Error("Vault details did not render");
    await expect(within(details).getByText("Fee")).toBeVisible();
    await expect(within(details).getByText("10.00%")).toBeVisible();

    // Deposit $25.00 from the savings screen into the selected vault.
    await userEvent.click(await screen.findByRole("button", { name: "Deposit" }));
    const depositDialog = await screen.findByRole("dialog", { name: "Deposit" });
    for (const digit of "25") {
      await userEvent.click(
        await within(depositDialog).findByRole("button", { name: digit }),
      );
    }
    await userEvent.click(
      await within(depositDialog).findByRole("button", { name: "Continue" }),
    );

    // Review shows the exact action facts before dispatch.
    const confirmDialog = await screen.findByRole("dialog", { name: "Confirm" });
    const amountRow = within(confirmDialog)
      .getAllByRole("definition")
      .find((node) => node.textContent === "$25.00");
    await expect(amountRow).toBeVisible();
    await expect(within(confirmDialog).getByText("Steakhouse USDC")).toBeVisible();
    await expect(within(confirmDialog).getByText("Base (8453)")).toBeVisible();
    await expect(
      within(confirmDialog).getByRole("button", { name: "Deposit $25.00" }),
    ).toBeVisible();
    await expect(journey.prepared).toEqual([
      {
        endpoint: "savings-deposit",
        input: {
          kind: "deposit",
          vaultAddress: SELECTED_VAULT,
          amountBaseUnits: "25000000",
        },
      },
    ]);

    await userEvent.click(
      within(confirmDialog).getByRole("button", { name: "Deposit $25.00" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(journey.dispatched).toHaveLength(1);
    await expect(journey.dispatched[0]?.metadata).toMatchObject({
      product: "savings",
      vaultAddress: SELECTED_VAULT,
    });
    await expect(journey.dispatched[0]?.amounts[0]?.amountBaseUnits).toBe("25000000");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Deposit" })).toBe(document.activeElement),
    );
  },
};
