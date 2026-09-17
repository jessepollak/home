import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { Button } from "@/components/ui/button";
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
  const [dialogKey, setDialogKey] = useState(0);
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl items-center justify-center p-4">
      {!open ? (
        <Button
          type="button"
          onClick={() => {
            setDialogKey((key) => key + 1);
            setOpen(true);
          }}
        >
          Reopen {mode} dialog
        </Button>
      ) : null}
      <SavingsMoneyDialog
        key={dialogKey}
        open={open}
        mode={mode}
        session={session}
        candidate={storyCandidate}
        availableLabel="$250.00 available"
        balanceAgeLabel="Updated 4 min ago"
        availableBaseUnits="250000000"
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
  parameters: { viewport: { defaultViewport: "smallMobile" } },
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
  parameters: { viewport: { defaultViewport: "desktop" } },
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
    await expect(await screen.findByRole("button", { name: "Reopen deposit dialog" })).toBeVisible();
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
    viewport: { defaultViewport: "desktop" },
    docs: {
      description: {
        story: "Stable review target only. This story does not emulate prefers-reduced-motion; apply real browser media emulation during review.",
      },
    },
  },
};
