import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import type { MorphoVaultCandidate } from "@/server/morpho/types";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { SavingsMoneyDialog } = await import("./savings-actions");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[0];

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const candidate: MorphoVaultCandidate = {
  version: "v1",
  vaultAddress: VAULT,
  name: "Configured USDC vault",
  symbol: "USDC vault",
  listed: true,
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  curatorAddress: null,
  grossApy: 0.04,
  netApy: 0.035,
  feeRate: 0.1,
  totalAssetsRaw: "100000000",
  liquidityRaw: "50000000",
  stateAsOf: "2026-09-08T12:00:00.000Z",
  blockNumber: "51026404",
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-08T12:00:01.000Z",
  },
};

function prepared(kind: "save-deposit" | "save-withdraw" = "save-deposit"): PreparedMoneyAction {
  return {
    id: "action-1",
    kind,
    title: "Deposit USDC",
    reviewHash: "hash",
    createdAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2099-09-09T00:00:00.000Z",
    calls: [],
    amounts: [],
    warnings: [],
    owner: {
      subject: "subject-a",
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

function page() {
  return within(document.body);
}

function typeAmount(digits: string) {
  for (const digit of digits) {
    fireEvent.click(page().getByRole("button", {
      name: digit === "." ? "Decimal point" : digit,
    }));
  }
}

afterEach(cleanup);

describe("SavingsMoneyDialog", () => {
  test("prepares a deposit through MoneyModal and keeps human confirm rows", async () => {
    const requests: Array<{ endpoint: string; input: unknown }> = [];
    render(
      <SavingsMoneyDialog
        open
        mode="deposit"
        session={session}
        candidate={candidate}
        availableLabel="$50.00 available"
        availableBaseUnits="50000000"
        prepareMoneyAction={async (endpoint, input) => {
          requests.push({ endpoint, input });
          return prepared();
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
        onClose={() => {}}
      />,
    );

    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(page().getByText("$50.00 available")).toBeTruthy();
    expect(page().queryByLabelText("Asset")).toBeNull();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByText("Deposit to Save")).toBeTruthy();
    expect(page().getByText("Configured USDC vault")).toBeTruthy();
    expect(page().getByText("3.50%")).toBeTruthy();
    expect(page().getByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(requests).toEqual([
      {
        endpoint: "/api/savings/actions",
        input: {
          kind: "deposit",
          vaultAddress: VAULT,
          amountBaseUnits: "1234567",
        },
      },
    ]);
  });

  test("retains limit errors from prepareMoneyAction", async () => {
    render(
      <SavingsMoneyDialog
        open
        mode="deposit"
        session={session}
        candidate={candidate}
        prepareMoneyAction={async () => {
          throw Object.assign(new Error("limit"), { status: 409 });
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
        onClose={() => {}}
      />,
    );

    typeAmount("5");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect((await page().findByRole("alert")).textContent).toContain(
      "exceeds the current onchain account balance or vault limit",
    );
  });

  test("surfaces a safe RPC error code instead of the opaque unavailable copy", async () => {
    render(
      <SavingsMoneyDialog
        open
        mode="deposit"
        session={session}
        candidate={candidate}
        prepareMoneyAction={async () => {
          throw Object.assign(new Error("unavailable"), {
            status: 502,
            code: "SAVINGS_ACTION_RPC",
            serverMessage: "Base RPC rejected a savings state read: execution reverted",
          });
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
        onClose={() => {}}
      />,
    );

    typeAmount("5");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect((await page().findByRole("alert")).textContent).toBe(
      "Base RPC rejected a savings state read: execution reverted (SAVINGS_ACTION_RPC) No transaction was submitted.",
    );
  });
});
