import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { Button } from "@/components/ui/button";
import type { MoneyAssetOption } from "@/client/money-modal";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import {
  SavingsMoneyDialog,
  type SavingsActionMode,
} from "./savings-actions";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const FIXTURE_NOW = "2026-09-10T12:04:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "storybook-savings-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const candidate: MorphoVaultCandidate = {
  version: "v1",
  vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[1],
  name: "Gauntlet USDC Prime",
  symbol: "gtUSDC",
  listed: true,
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  curatorAddress: null,
  grossApy: 0.046,
  netApy: 0.041,
  feeRate: 0.1,
  totalAssetsRaw: "1250000000000",
  liquidityRaw: "850000000000",
  stateAsOf: FIXTURE_NOW,
  blockNumber: "51026404",
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: FIXTURE_NOW,
  },
};

const simulatedFailureCandidate: MorphoVaultCandidate = {
  ...candidate,
  name: "Storybook simulated failure vault",
};

const currencyOptions = [
  {
    id: "usdc",
    label: "USDC",
    description: "US dollar",
    currency: "USD",
    mark: { assetKey: "usdc", name: "US dollar", symbol: "USDC", imageUrl: null, pending: false, currency: "USD" },
  },
  {
    id: "eurc",
    label: "EURC",
    description: "Euro",
    currency: "EUR",
    mark: { assetKey: "eurc", name: "Euro", symbol: "EURC", imageUrl: null, pending: false, currency: "EUR" },
  },
  {
    id: "idrx",
    label: "IDRX",
    description: "Indonesian rupiah",
    currency: "IDR",
    mark: { assetKey: "idrx", name: "Indonesian rupiah", symbol: "IDRX", imageUrl: null, pending: false, currency: "IDR" },
  },
] satisfies ReadonlyArray<MoneyAssetOption>;

function preparedAction(kind: string): PreparedMoneyAction {
  const actionKind = kind === "savings-withdraw"
    ? "savings-withdraw"
    : "savings-deposit";
  return {
    id: `storybook-${actionKind}`,
    kind: actionKind,
    title: actionKind === "savings-deposit" ? "Deposit USDC" : "Withdraw USDC",
    createdAt: "2026-09-10T12:03:00.000Z",
    expiresAt: "2099-09-10T12:03:00.000Z",
    calls: [],
    amounts: [],
    warnings: [],
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

const rejectedExecution: AccountWalletClient["executeMoneyAction"] = async (action) => ({
  id: action.id,
  status: "rejected",
});

const failedExecution: AccountWalletClient["executeMoneyAction"] = async (action) => ({
  id: action.id,
  status: "failed",
});

type DialogStorySurfaceProps = {
  mode?: SavingsActionMode;
  storyCandidate?: MorphoVaultCandidate;
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
};

function DialogStorySurface({
  mode = "deposit",
  storyCandidate = candidate,
  executeMoneyAction = rejectedExecution,
}: DialogStorySurfaceProps) {
  const [open, setOpen] = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState("usdc");
  const selectedAsset = currencyOptions.find((option) => option.id === selectedAssetId) ?? currencyOptions[0];
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl items-center justify-center p-4">
      {!open ? (
        <Button
          type="button"
          onClick={() => setOpen(true)}
        >
          Reopen {mode} dialog
        </Button>
      ) : null}
      <SavingsMoneyDialog
        open={open}
        mode={mode}
        session={session}
        candidate={storyCandidate}
        availableLabel={selectedAssetId === "idrx" ? "Rp 250 available" : selectedAssetId === "eurc" ? "€250.00 available" : "$250.00 available"}
        availableBaseUnits={selectedAssetId === "idrx" ? "25000" : "250000000"}
        assetId={selectedAssetId}
        assetLabel={selectedAsset.label}
        assetDecimals={selectedAssetId === "idrx" ? 2 : 6}
        assetOptions={currencyOptions}
        onAssetChange={setSelectedAssetId}
        prepareMoneyAction={prepareMoneyAction}
        executeMoneyAction={executeMoneyAction}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}

function PendingDialogStory() {
  const releaseRef = useRef<((result: OperationResult) => void) | null>(null);
  useEffect(() => () => {
    releaseRef.current?.({ id: "storybook-savings-deposit", status: "rejected" });
    releaseRef.current = null;
  }, []);
  const executeMoneyAction = useCallback<AccountWalletClient["executeMoneyAction"]>(
    (action) => new Promise((resolve) => {
      releaseRef.current = resolve;
      void action;
    }),
    [],
  );
  return <DialogStorySurface executeMoneyAction={executeMoneyAction} />;
}

async function enterAmountAndContinue(canvasElement: HTMLElement, digits = "25") {
  const screen = within(canvasElement.ownerDocument.body);
  for (const digit of digits) {
    await userEvent.click(await screen.findByRole("button", { name: digit }));
  }
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("dialog", { name: "Confirm" });
  return screen;
}

const meta = {
  id: "pilot-savings-money-dialog",
  title: "Pilot/Savings Money Dialog",
  component: DialogStorySurface,
  args: {
    mode: "deposit",
    storyCandidate: candidate,
    executeMoneyAction: rejectedExecution,
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof DialogStorySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AmountEntry: Story = {
  parameters: {
    docs: {
      description: {
        story: "The selector includes deterministic USD/USDC, EUR/EURC, and IDR/IDRX presentation fixtures. Non-USDC choices review selector and amount layout only; they do not claim a configured savings route.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const assetInput = await screen.findByRole("combobox", { name: "Asset" });
    const trigger = assetInput.parentElement?.querySelector("button");
    if (!trigger) throw new Error("Asset picker trigger is missing");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "EUR EURC" }));
    await expect(await screen.findByRole("combobox", { name: "Asset" })).toHaveValue("EUR");
    await expect(await screen.findByText("EURC is available for presentation review only", { exact: false })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(screen.queryByText(/Updated \d+ min ago/)).not.toBeInTheDocument();
  },
};

export const ValidationFailure: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    for (const digit of "999") {
      await userEvent.click(await screen.findByRole("button", { name: digit }));
    }
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "exceeds the current onchain account balance or vault limit",
    );
  },
};

export const Review: Story = {
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await expect(await screen.findByRole("button", { name: "Deposit $25.00" })).toBeVisible();
  },
};

export const Pending: Story = {
  render: () => <PendingDialogStory />,
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByText("Waiting for your wallet…")).toBeVisible();
  },
};

export const FailureRecovery: Story = {
  args: {
    storyCandidate: simulatedFailureCandidate,
    executeMoneyAction: failedExecution,
  },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "deposit did not succeed onchain",
    );
    await expect(await screen.findByText("Storybook simulated failure vault")).toBeVisible();
    const recoveryButtons = await screen.findAllByRole("button", { name: "Back" });
    await expect(recoveryButtons.length).toBeGreaterThan(0);
    await expect(recoveryButtons.at(-1)!).toBeEnabled();
  },
  parameters: { viewport: { defaultViewport: "mobile" } },
};

export const BackAndCancel: Story = {
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    const backButtons = await screen.findAllByRole("button", { name: "Back" });
    await expect(backButtons.length).toBeGreaterThan(0);
    await userEvent.click(backButtons.at(-1)!);
    await screen.findByRole("dialog", { name: "Deposit" });
    const closeButton = await screen.findByRole("button", { name: "Close deposit dialog" });
    await expect(closeButton).toBeEnabled();
    await userEvent.click(closeButton);
    const reopen = await screen.findByRole("button", { name: "Reopen deposit dialog" });
    await expect(reopen).toBeVisible();
    await userEvent.click(reopen);
    await expect(await screen.findByRole("dialog", { name: "Deposit" })).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story: "Use Back to return to amount entry, or close the dialog and use the canvas Reopen control to repeat the flow.",
      },
    },
  },
};

export const ReducedMotionReference: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile" },
    docs: {
      description: {
        story: "Stable review target only. This story does not emulate prefers-reduced-motion; apply real browser media emulation during review.",
      },
    },
  },
};
