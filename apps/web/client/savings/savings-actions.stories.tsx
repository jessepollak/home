import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { TransferExecutionError } from "@/shared/transfers/types";
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
import { SavingsMoneyDialog, type SavingsActionMode } from "./savings-actions";
import {
  SavingsDialogFixtureProvider,
  type SavingsDialogMotion,
} from "./savings-dialog-fixture";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const FIXTURE_NOW = "2026-09-10T12:04:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "storybook-savings-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const candidate: MorphoVaultCandidate = {
  version: "v1",
  vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
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

function preparedAction(
  kind: string,
  vault: MorphoVaultCandidate = candidate,
): PreparedMoneyAction {
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
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000", direction: actionKind === "savings-deposit" ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "24000000000000000000", direction: actionKind === "savings-deposit" ? "receive" : "spend", estimated: true },
    ],
    networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 },
    warnings: [],
    metadata: {
      product: "savings",
      operation: actionKind === "savings-deposit" ? "deposit" : "withdraw",
      vaultAddress: vault.vaultAddress,
      vaultName: vault.name,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "250000000",
      previewSharesBaseUnits: "24000000000000000000",
      shareDecimals: 18,
      exchangeConstraint: actionKind === "savings-deposit" ? "deposit-minimum-shares-or-revert" : "withdraw-exact-assets-or-revert",
      ...(actionKind === "savings-deposit" ? { minimumSharesBaseUnits: "23976000000000000000" } : {}),
      discoveryRate: { status: "stale", netApy: "0.041", fetchedAt: FIXTURE_NOW, stateAsOf: FIXTURE_NOW },
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

const rejectedExecution: AccountWalletClient["executeMoneyAction"] = async (action) => ({
  id: action.id,
  status: "rejected",
});

const submittedExecution: AccountWalletClient["executeMoneyAction"] = async (action) => ({ id: action.id, status: "submitted" });

const expiredExecution: AccountWalletClient["executeMoneyAction"] = async () => {
  throw Object.assign(new Error("Expired"), { code: "ACTION_EXPIRED" });
};

const ambiguousExecution: AccountWalletClient["executeMoneyAction"] = async () => {
  throw new TransferExecutionError("submission-unknown");
};

function storyActions(status: "pending" | "confirmed" | "failed"): AccountWalletClient["fetchAccountResource"] {
  return async () => ({ actions: [{ id: "storybook-savings-deposit", status, owner: preparedAction("savings-deposit").owner }] });
}

type DialogStorySurfaceProps = {
  mode?: SavingsActionMode;
  motion?: SavingsDialogMotion;
  storyCandidate?: MorphoVaultCandidate;
  availableLabel?: string;
  availableBaseUnits?: string;
  fetchAccountResource?: AccountWalletClient["fetchAccountResource"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
};

function DialogStorySurface({
  mode = "deposit",
  motion = "system",
  storyCandidate = candidate,
  availableLabel,
  availableBaseUnits,
  fetchAccountResource,
  executeMoneyAction = rejectedExecution,
}: DialogStorySurfaceProps) {
  const [open, setOpen] = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState("usdc");
  const selectedAsset = currencyOptions.find((option) => option.id === selectedAssetId) ?? currencyOptions[0];
  const prepareStoryAction: AccountWalletClient["prepareMoneyAction"] = async (kind) =>
    preparedAction(kind, storyCandidate);
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
      <SavingsDialogFixtureProvider value={{
        motion,
        assetId: selectedAssetId,
        assetLabel: selectedAsset.label,
        assetDecimals: selectedAssetId === "idrx" ? 2 : 6,
        assetOptions: currencyOptions,
        onAssetChange: setSelectedAssetId,
      }}>
        <SavingsMoneyDialog
          open={open}
          mode={mode}
          session={session}
          candidate={storyCandidate}
          availableLabel={availableLabel ?? (selectedAssetId === "idrx" ? "Rp 250 available" : selectedAssetId === "eurc" ? "€250.00 available" : "$250.00 available")}
          availableBaseUnits={availableBaseUnits ?? (selectedAssetId === "idrx" ? "25000" : "250000000")}
          prepareMoneyAction={prepareStoryAction}
          fetchAccountResource={fetchAccountResource}
          executeMoneyAction={executeMoneyAction}
          onClose={() => setOpen(false)}
        />
      </SavingsDialogFixtureProvider>
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
  getHomeQueryClient().clear();
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), digits);
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
    motion: "system",
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

export const AmountExceedsAvailable: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), "999");
    await expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(await screen.findByText("Only $250.00 available")).toBeVisible();
    await expect(screen.getByRole("textbox", { name: "Amount" })).toHaveAttribute("aria-invalid", "true");
    await expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const WithdrawNothingSaved: Story = {
  args: {
    mode: "withdraw",
    availableLabel: "$0.00 available",
    availableBaseUnits: "0",
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("dialog", { name: "Withdraw" })).toBeVisible();
    await expect(await screen.findByText("Nothing saved to withdraw.")).toBeVisible();
    await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), "0.10");
    await expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(await screen.findByText("Nothing saved to withdraw.")).toBeVisible();
    await expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const Review: Story = {
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await expect(await screen.findByRole("button", { name: "Deposit $25.00" })).toBeVisible();
    await expect(await screen.findByText("Network fee")).toBeVisible();
    await expect(await screen.findByText("Up to 0.02 USDC · ≈ $0.02")).toBeVisible();
  },
};

export const Submitting: Story = {
  render: () => <PendingDialogStory />,
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    const confirm = await screen.findByRole("button", { name: "Deposit $25.00" });
    confirm.focus();
    await userEvent.click(confirm);
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm).toBe(canvasElement.ownerDocument.activeElement);
    await expect(screen.queryByText("Waiting for your wallet…")).not.toBeInTheDocument();
    await expect(await screen.findByRole("button", { name: "Close deposit dialog" })).toBeDisabled();
  },
};

export const Delayed: Story = {
  args: { executeMoneyAction: submittedExecution, fetchAccountResource: storyActions("pending") },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "Depositing $25.00 to Save" })).toBeVisible();
    await expect(await screen.findByText("Submitted")).toBeVisible();
    await expect(await screen.findByText("Confirming on Base")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "View in Activity" })).toBeVisible();
  },
};

export const Rejected: Story = {
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("The wallet request was rejected.");
    for (const back of await screen.findAllByRole("button", { name: "Back" })) await expect(back).toBeEnabled();
    await expect(screen.queryByRole("button", { name: "View in Activity" })).not.toBeInTheDocument();
  },
};

export const Expired: Story = {
  args: { executeMoneyAction: expiredExecution },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("This deposit expired. Go back and continue again.");
    await expect(await screen.findByRole("button", { name: "Deposit $25.00" })).toBeDisabled();
  },
};

export const Failed: Story = {
  args: {
    storyCandidate: simulatedFailureCandidate,
    executeMoneyAction: submittedExecution,
    fetchAccountResource: storyActions("failed"),
  },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "Deposit didn't go through" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Try again" })).toBeVisible();
  },
  parameters: { viewport: { defaultViewport: "mobile" } },
};

export const Confirmed: Story = {
  args: { executeMoneyAction: submittedExecution, fetchAccountResource: storyActions("confirmed") },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "Deposited $25.00 to Save" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Done" })).toBeVisible();
  },
};

export const Ambiguous: Story = {
  args: { executeMoneyAction: ambiguousExecution, fetchAccountResource: storyActions("pending") },
  play: async ({ canvasElement }) => {
    const screen = await enterAmountAndContinue(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Deposit $25.00" }));
    await expect(await screen.findByRole("heading", { name: "We can't confirm $25.00" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "View in Activity" })).toBeVisible();
    await expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
  },
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
  args: { motion: "reduced" },
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    const screen = within(document.body);
    const expectReducedSurface = async () => {
      const input = await screen.findByRole("textbox", { name: "Amount" });
      await expect(input).toHaveAttribute("inputmode", "decimal");
      await expect(await screen.findByText("$250.00 available")).toBeVisible();
      await expect(document.querySelector("[data-money-sheet]")).toHaveAttribute("data-immediate");
    };

    await screen.findByRole("dialog", { name: "Deposit" });
    await expectReducedSurface();
    await userEvent.click(await screen.findByRole("button", { name: "Close deposit dialog" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reopen deposit dialog" }));
    await screen.findByRole("dialog", { name: "Deposit" });
    await expectReducedSurface();
  },
  parameters: {
    viewport: { defaultViewport: "mobile" },
    docs: {
      description: {
        story: "Deterministic reduced-motion review fixture: the alternate unit does not animate across close and reopen; editable and available amounts are plain text. Production still follows prefers-reduced-motion; retain separate real-browser media-emulation proof.",
      },
    },
  },
};
