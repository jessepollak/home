import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import type { MorphoVaultCandidate } from "@/server/morpho/types";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { SavingsActions } = await import("./savings-actions");

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

afterEach(cleanup);

describe("SavingsActions", () => {
  test("uses the authenticated account transport with an exact six-decimal amount and retains limit errors", async () => {
    const requests: Array<{ path: string; options: unknown }> = [];
    render(
      <SavingsActions
        session={session}
        candidates={[candidate]}
        fetchAccountResource={async (path, options) => {
          requests.push({ path, options });
          throw Object.assign(new Error("limit"), { status: 409 });
        }}
      />,
    );

    fireEvent.change(within(document.body).getByLabelText("Vault"), {
      target: { value: VAULT },
    });
    fireEvent.change(within(document.body).getByLabelText("USDC amount"), {
      target: { value: "1.234567" },
    });
    fireEvent.click(within(document.body).getByRole("button", { name: "Review deposit" }));

    expect((await within(document.body).findByRole("alert")).textContent).toContain(
      "exceeds the current onchain account balance or vault limit",
    );
    expect(requests).toEqual([
      {
        path: "/api/savings/actions",
        options: {
          method: "POST",
          body: {
            kind: "deposit",
            vaultAddress: VAULT,
            amountBaseUnits: "1234567",
          },
        },
      },
    ]);
    expect(within(document.body).getByText("3.50%")).toBeTruthy();
    expect(within(document.body).getByText("10.00%")).toBeTruthy();
  });

  test("surfaces a safe RPC error code instead of the opaque unavailable copy", async () => {
    render(
      <SavingsActions
        session={session}
        candidates={[candidate]}
        fetchAccountResource={async () => {
          throw Object.assign(new Error("unavailable"), {
            status: 502,
            code: "SAVINGS_ACTION_RPC",
            serverMessage: "Base RPC rejected a savings state read: execution reverted",
          });
        }}
      />,
    );

    fireEvent.change(within(document.body).getByLabelText("Vault"), {
      target: { value: VAULT },
    });
    fireEvent.change(within(document.body).getByLabelText("USDC amount"), {
      target: { value: "5" },
    });
    fireEvent.click(within(document.body).getByRole("button", { name: "Review deposit" }));

    expect((await within(document.body).findByRole("alert")).textContent).toBe(
      "Base RPC rejected a savings state read: execution reverted (SAVINGS_ACTION_RPC) No transaction was submitted.",
    );
  });
});
