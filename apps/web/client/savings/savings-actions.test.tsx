import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
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
  stateAsOf: "2026-09-12T12:00:00.000Z",
  blockNumber: "51026404",
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-12T12:00:01.000Z" },
};

function prepared(kind: "savings-deposit" | "savings-withdraw" = "savings-deposit"): PreparedMoneyAction {
  return {
    id: "action-1",
    kind,
    title: "Deposit USDC",
    createdAt: "2026-09-12T00:00:00.000Z",
    expiresAt: "2099-09-12T00:00:00.000Z",
    calls: [],
    amounts: [],
    warnings: [],
    owner: { subject: "subject-a", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  };
}
function typeAmount(digits: string) {
  for (const digit of digits) fireEvent.click(page().getByRole("button", { name: digit === "." ? "Decimal point" : digit }));
}
afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("SavingsMoneyDialog", () => {
  test("prepares a deposit through the unified actions endpoint", async () => {
    const requests: Array<{ kind: string; input: unknown }> = [];
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000"
        prepareMoneyAction={async (kind, input) => { requests.push({ kind, input }); return prepared(); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "savings-deposit", input: { kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1234567" } }]);
  });

  test("retries the same prepared action after an ambiguous dispatch", async () => {
    let executions = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => { executions += 1; if (executions === 1) throw new Error("ambiguous"); return { id: "action-1", status: "submitted" }; }}
        onClose={() => {}}
      />,
    );
    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    fireEvent.click(await page().findByRole("button", { name: "Retry" }));
    expect(executions).toBe(2);
  });

  test("surfaces typed prepare errors", async () => {
    for (const failure of [
    { name: "limit", error: Object.assign(new Error("limit"), { status: 409 }), message: "exceeds the current onchain account balance or vault limit" },
    { name: "rate limit", error: Object.assign(new Error("limited"), { status: 429, code: "SAVINGS_ACTION_RATE_LIMITED", serverMessage: "Base RPC is rate limited. Try again shortly." }), message: "Base RPC is rate limited. Try again shortly. No transaction was submitted." },
    { name: "RPC", error: Object.assign(new Error("unavailable"), { status: 502, code: "SAVINGS_ACTION_RPC", serverMessage: "Base RPC rejected a savings state read: execution reverted" }), message: "Base RPC rejected a savings state read: execution reverted (SAVINGS_ACTION_RPC) No transaction was submitted." },
    ]) {
      render(
        <SavingsMoneyDialog
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => { throw failure.error; }}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />,
      );
      typeAmount("5");
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      expect((await page().findByRole("alert")).textContent).toContain(failure.message);
      cleanup();
    }
  });
});
