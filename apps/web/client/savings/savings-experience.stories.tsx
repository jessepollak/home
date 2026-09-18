import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { RegionId } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type {
  MorphoVaultCandidate,
  MorphoVaultsResult,
} from "@/shared/savings/types";
import { SavingsExperience } from "./savings-experience";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const FIXTURE_TIME = "2026-09-10T12:04:00.000Z";
const FIXTURE_NOW = Date.parse(FIXTURE_TIME);
const fixedNow = () => FIXTURE_NOW;
const [STEAKHOUSE, GAUNTLET, THIRD_VAULT] = MORPHO_V1_CANDIDATE_ADDRESSES;

const session: VerifiedAccountSession = {
  user: { subject: "storybook-savings-owner" },
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
const gauntlet = candidate(
  GAUNTLET,
  "Gauntlet USDC Prime",
  0.041,
  "0x1234567890abcdef1234567890abcdef12345678",
);

const fixedVaults: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [steakhouse, gauntlet],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-10T12:00:00.000Z",
  },
  stale: false,
};

const longLabelVaults: MorphoVaultsResult = {
  ...fixedVaults,
  candidates: [
    {
      ...steakhouse,
      name: "Steakhouse International Canonical USDC Savings Reserve",
      symbol: "International canonical USDC savings reserve receipt",
    },
    {
      ...gauntlet,
      name: "Gauntlet Diversified Onchain Treasury Savings Strategy Prime",
      symbol: "Diversified onchain treasury savings strategy receipt",
    },
  ],
};

type VaultPosition = {
  vaultAddress: string;
  position: { assetsRaw: string } | null;
};

function positions(
  amounts: Partial<Record<string, string | null>> = {},
): VaultPosition[] {
  return MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
    vaultAddress,
    position: amounts[vaultAddress] === null
      ? null
      : { assetsRaw: amounts[vaultAddress] ?? "0" },
  }));
}

const fundedPositions = positions({
  [GAUNTLET]: "987654321",
  [STEAKHOUSE]: "123456789",
  [THIRD_VAULT]: "0",
});
const emptyPositions = positions();
const partialPositions = positions({
  [GAUNTLET]: "42000000",
  [STEAKHOUSE]: null,
  [THIRD_VAULT]: "0",
});

function preparedAction(kind: string): PreparedMoneyAction {
  const actionKind = kind === "savings-withdraw"
    ? "savings-withdraw"
    : "savings-deposit";
  return {
    id: `storybook-experience-${actionKind}`,
    kind: actionKind,
    title: actionKind === "savings-deposit" ? "Deposit USDC" : "Withdraw USDC",
    createdAt: "2026-09-10T12:03:00.000Z",
    expiresAt: "2099-09-10T12:03:00.000Z",
    calls: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000", direction: actionKind === "savings-deposit" ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "24000000000000000000", direction: actionKind === "savings-deposit" ? "receive" : "spend", estimated: true },
    ],
    warnings: [],
    metadata: {
      product: "savings",
      operation: actionKind === "savings-deposit" ? "deposit" : "withdraw",
      vaultAddress: GAUNTLET,
      vaultName: gauntlet.name,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "250000000",
      previewSharesBaseUnits: "24000000000000000000",
      shareDecimals: 18,
      exchangeConstraint: actionKind === "savings-deposit" ? "deposit-preview-no-minimum-shares" : "withdraw-exact-assets-or-revert",
      discoveryRate: { status: "current", netApy: "0.041", fetchedAt: FIXTURE_TIME, stateAsOf: FIXTURE_TIME },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" },
    },
    owner: {
      subject: session.user.subject,
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: session.accountProvider,
    },
  };
}

const prepareMoneyAction: AccountWalletClient["prepareMoneyAction"] = async (kind) =>
  preparedAction(kind);
const executeMoneyAction: AccountWalletClient["executeMoneyAction"] = async (action) => ({
  id: action.id,
  status: "rejected",
});

type SavingsStorySurfaceProps = {
  regionId: RegionId;
  metadata: MorphoVaultsResult;
  balanceStatus: "loading" | "ready" | "error";
  balancePositions: VaultPosition[] | null;
  availableUsdcBaseUnits: string | null;
};

function SavingsStorySurface({
  regionId,
  metadata,
  balanceStatus,
  balancePositions,
  availableUsdcBaseUnits,
}: SavingsStorySurfaceProps) {
  return (
    <PresentationRegionProvider regionId={regionId}>
      <main className={`${shellContentFrameClassName} py-4`}>
        <SavingsExperience
          initialData={metadata}
          session={session}
          now={fixedNow}
          availableUsdcBaseUnits={availableUsdcBaseUnits}
          balancePositions={balancePositions}
          balanceStatus={balanceStatus}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={executeMoneyAction}
          onBack={() => {}}
        />
      </main>
    </PresentationRegionProvider>
  );
}

const meta = {
  id: "pilot-savings-experience",
  title: "Pilot/Savings Experience",
  component: SavingsStorySurface,
  args: {
    regionId: "US",
    metadata: fixedVaults,
    balanceStatus: "ready",
    balancePositions: fundedPositions,
    availableUsdcBaseUnits: "250000000",
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof SavingsStorySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Funded: Story = {};

export const VerifiedEmpty: Story = {
  args: {
    balancePositions: emptyPositions,
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};

export const Loading: Story = {
  args: {
    balanceStatus: "loading",
    balancePositions: null,
  },
};

export const StaleRates: Story = {
  args: {
    metadata: { ...fixedVaults, stale: true },
  },
  parameters: {
    docs: {
      description: {
        story: "A retained discovery snapshot is visibly stale and offers an explicit retry without upgrading its APY.",
      },
    },
  },
};

export const UnavailablePartial: Story = {
  args: {
    balancePositions: partialPositions,
  },
  parameters: {
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story: "One verified vault position remains visible while another is unavailable; the aggregate is intentionally shown as unavailable rather than invented.",
      },
    },
  },
};

export const LongLocalizedContent: Story = {
  args: {
    regionId: "BR",
    metadata: longLabelVaults,
    balancePositions: fundedPositions,
  },
  parameters: {
    viewport: { defaultViewport: "smallMobile" },
    docs: {
      description: {
        story: "Brazil is supplied explicitly as the supported non-US presentation region. Only fixture vault labels are lengthened; production copy is unchanged.",
      },
    },
  },
};
