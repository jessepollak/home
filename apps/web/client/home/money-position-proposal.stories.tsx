import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { MoneyPositionInput, MoneyPositionSlice } from "./money-position-model";
import {
  BorrowPositionHeaderProposal,
  MoneyPositionProductTiles,
  MoneyPositionProposal,
} from "./money-position-proposal";

const cash = (amountMinor: string): MoneyPositionSlice => ({
  id: "cash-usd",
  kind: "cash",
  label: "Cash",
  detail: "Available to use",
  amountMinor,
  status: "ready",
});

const saved = (amountMinor: string): MoneyPositionSlice => ({
  id: "saved-usdc",
  kind: "saved",
  label: "Saved",
  detail: "Earning 3.5% variable APY",
  amountMinor,
  status: "ready",
});

const invested = (amountMinor: string): MoneyPositionSlice => ({
  id: "invested-assets",
  kind: "invested",
  label: "Invested",
  detail: "Current market value",
  amountMinor,
  status: "ready",
});

const collateral = (amountMinor: string): MoneyPositionSlice => ({
  id: "collateral-cbbtc",
  kind: "collateral",
  label: "Bitcoin collateral",
  detail: "0.1250 cbBTC",
  amountMinor,
  status: "ready",
});

const card = (amountMinor: string): MoneyPositionSlice => ({
  id: "card-allocation",
  kind: "card",
  label: "Card allocation",
  detail: "Set aside for card spending",
  amountMinor,
  status: "ready",
});

const noDebt = {
  label: "Borrowed",
  detail: "No outstanding debt",
  amountMinor: "0",
  status: "ready",
} as const;

function position(
  slices: readonly MoneyPositionSlice[],
  debt: MoneyPositionInput["debt"] = noDebt,
): MoneyPositionInput {
  return {
    currency: "USD",
    quoteCurrencyMinorUnitScale: 2,
    regionId: "US",
    slices,
    debt,
  };
}

const completePosition = position(
  [cash("620000"), saved("540000"), invested("990000"), collateral("800000"), card("250000")],
  {
    label: "Borrowed",
    detail: "USDC debt · 4.8% variable APR",
    amountMinor: "700000",
    status: "ready",
  },
);

const staleProductPosition = position(
  [
    cash("620000"),
    { ...saved("540000"), status: "stale" },
    invested("990000"),
    { ...collateral("800000"), status: "stale" },
  ],
  {
    label: "Borrowed",
    detail: "USDC debt · 4.8% variable APR",
    amountMinor: "700000",
    status: "stale",
  },
);

const meta = {
  id: "proposal-money-position",
  title: "Proposals/Money Position",
  component: MoneyPositionProposal,
  args: {
    position: completePosition,
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    docs: {
      description: {
        component: "Production-component proposal for issue #634. No story performs requests or money actions.",
      },
    },
  },
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-muted p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof MoneyPositionProposal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Jesse-selected headline. Borrowed proceeds are offset by debt in net position. */
export const NetPosition: Story = {};

export const SaveAndBorrowTiles: Story = {
  render: ({ position }) => (
    <MoneyPositionProductTiles
      position={position}
      onOpenSave={() => undefined}
      onOpenBorrow={() => undefined}
    />
  ),
};

export const BorrowPositionHeader: Story = {
  render: ({ position }) => (
    <div className="mx-auto w-full max-w-2xl">
      <BorrowPositionHeaderProposal position={position} />
    </div>
  ),
};

export const StaleSaveAndBorrowTiles: Story = {
  args: { position: staleProductPosition },
  render: ({ position }) => (
    <MoneyPositionProductTiles
      position={position}
      onOpenSave={() => undefined}
      onOpenBorrow={() => undefined}
    />
  ),
};

export const StaleBorrowPositionHeader: Story = {
  args: { position: staleProductPosition },
  render: ({ position }) => (
    <div className="mx-auto w-full max-w-2xl">
      <BorrowPositionHeaderProposal position={position} />
    </div>
  ),
};

export const UnavailableBorrowPositionHeader: Story = {
  args: {
    position: position(
      [{
        ...collateral("0"),
        amountMinor: null,
        status: "unavailable",
        unavailableReason: "Collateral value could not be verified",
      }],
      {
        label: "Borrowed",
        detail: "USDC debt · 4.8% variable APR",
        amountMinor: "700000",
        status: "ready",
      },
    ),
  },
  render: ({ position }) => (
    <div className="mx-auto w-full max-w-2xl">
      <BorrowPositionHeaderProposal position={position} />
    </div>
  ),
};

export const Empty: Story = {
  args: {
    position: position([]),
    onAddMoney: () => undefined,
  },
};

export const CashOnly: Story = {
  args: { position: position([cash("125075")]) },
};

export const ZeroDecimalCurrency: Story = {
  args: {
    position: {
      currency: "CLP",
      quoteCurrencyMinorUnitScale: 0,
      regionId: "CL",
      slices: [{
        ...cash("123456789"),
        id: "cash-clp",
        detail: "Available Chilean pesos",
      }],
      debt: noDebt,
    },
  },
};

export const SavedOnly: Story = {
  args: { position: position([saved("842050")]) },
};

export const InvestedOnly: Story = {
  args: { position: position([invested("1264999")]) },
};

export const CollateralWithoutDebt: Story = {
  args: { position: position([collateral("800000")]) },
};

export const CollateralPlusDebt: Story = {
  args: {
    position: position(
      [cash("700000"), collateral("800000")],
      {
        label: "Borrowed",
        detail: "USDC debt · 4.8% variable APR",
        amountMinor: "700000",
        status: "ready",
      },
    ),
  },
};

export const FutureCardAllocation: Story = {
  args: { position: position([cash("175000"), card("25000")]) },
};

export const PartialUnavailable: Story = {
  args: {
    position: position(
      [
        cash("620000"),
        saved("540000"),
        {
          ...invested("0"),
          amountMinor: null,
          status: "unavailable",
          unavailableReason: "Investment prices could not be verified",
        },
        { ...collateral("800000"), status: "stale" },
      ],
      {
        label: "Borrowed",
        detail: "USDC debt · 4.8% variable APR",
        amountMinor: "700000",
        status: "ready",
      },
    ),
  },
};

export const Unavailable: Story = {
  args: {
    position: position(
      [{
        ...cash("0"),
        amountMinor: null,
        status: "unavailable",
        unavailableReason: "Cash balances could not be verified",
      }],
      {
        label: "Borrowed",
        detail: "Current debt",
        amountMinor: null,
        status: "unavailable",
        unavailableReason: "Borrow positions could not be verified",
      },
    ),
  },
};

export const LongValuesAndLabels: Story = {
  args: {
    position: position(
      [
        {
          ...cash("123456789012"),
          label: "International multi-currency operating cash reserve",
          detail: "Available after the next verified settlement window",
        },
        {
          ...collateral("99999999999"),
          label: "Long-term Bitcoin collateral allocation",
          detail: "99,999,999,999.9999 cbBTC",
        },
      ],
      {
        label: "Borrowed across verified credit positions",
        detail: "Variable-rate debt",
        amountMinor: "50000000000",
        status: "ready",
      },
    ),
  },
  parameters: { viewport: { defaultViewport: "mobile" } },
};
