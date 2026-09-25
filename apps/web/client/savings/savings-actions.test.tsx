import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatAddress } from "@/shared/formatting";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import type { SavingsMoneyDialogProps } from "./savings-actions";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SavingsMoneyDialog } = await import("./savings-actions");
const { SavingsDialogFixtureProvider } = await import("./savings-dialog-fixture");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[0];
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const sessionB: VerifiedAccountSession = {
  user: { subject: "subject-b" },
  smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 },
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

function prepared(
  kind: "savings-deposit" | "savings-withdraw" = "savings-deposit",
  amountBaseUnits = "1000000",
  owner: VerifiedAccountSession = session,
): PreparedMoneyAction {
  const deposit = kind === "savings-deposit";
  return {
    id: "action-1",
    kind,
    title: "Deposit USDC",
    createdAt: "2026-09-12T00:00:00.000Z",
    expiresAt: "2099-09-12T00:00:00.000Z",
    calls: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: deposit ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: amountBaseUnits.padEnd(18, "0"), direction: deposit ? "receive" : "spend", estimated: true },
    ],
    warnings: ["warning prose is not review authority"],
    metadata: {
      product: "savings",
      operation: deposit ? "deposit" : "withdraw",
      vaultAddress: VAULT,
      vaultName: candidate.name,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "500000000",
      previewSharesBaseUnits: amountBaseUnits.padEnd(18, "0"),
      shareDecimals: 18,
      exchangeConstraint: deposit ? "deposit-minimum-shares-or-revert" : "withdraw-exact-assets-or-revert",
      ...(deposit ? { minimumSharesBaseUnits: amountBaseUnits.padEnd(18, "0") } : {}),
      discoveryRate: { status: "stale", netApy: "0.035", fetchedAt: "2026-09-12T12:00:01.000Z", stateAsOf: "2026-09-12T12:00:00.000Z" },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789214400" },
    },
    owner: {
      subject: owner.user.subject,
      address: owner.smartAccount!.address,
      chainId: 8453,
      accountProvider: owner.accountProvider,
    },
  };
}
function typeAmount(value: string) {
  fireEvent.change(page().getByRole("textbox", { name: "Amount" }), { target: { value } });
}
afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

function ReducedSavingsMoneyDialog(props: SavingsMoneyDialogProps) {
  return (
    <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
      <SavingsMoneyDialog {...props} />
    </SavingsDialogFixtureProvider>
  );
}

function ReopenHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open ? <button onClick={() => setOpen(true)}>Reopen deposit dialog</button> : null}
      <SavingsMoneyDialog
        open={open}
        mode="deposit"
        session={session}
        candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe("SavingsMoneyDialog", () => {
  test("deposit Max reports a failed USDC fee lookup and recovers on Retry", async () => {
    let requests = 0;
    render(<SavingsMoneyDialog open mode="deposit" session={session} candidate={candidate}
      availableLabel="$50.00 available" availableBaseUnits="50000000"
      fetchAccountResource={async () => {
        requests++;
        if (requests <= 3) throw new Error("network unavailable");
        return { version: 1, usdcReserveBaseUnits: "20000" };
      }}
      prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })} onClose={() => {}} />);
    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("Couldn't check the network fee.");
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(page().queryByRole("alert") === null).toBe(true));
    await waitFor(() => expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("49.98");
    expect(requests).toBe(4);
  });

  test("withdraw does not report an irrelevant USDC fee lookup failure", async () => {
    render(<SavingsMoneyDialog open mode="withdraw" session={session} candidate={candidate}
      availableLabel="$50.00 available" availableBaseUnits="50000000"
      fetchAccountResource={async () => { throw new Error("network unavailable"); }}
      prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })} onClose={() => {}} />);
    await waitFor(() => expect(getHomeQueryClient().isFetching()).toBe(0));
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("prepares a deposit through the unified actions endpoint", async () => {
    const requests: Array<{ kind: string; input: unknown }> = [];
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000"
        prepareMoneyAction={async (kind, input) => { requests.push({ kind, input }); return prepared("savings-deposit", "1234567"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Deposit $1.234567" }).getAttribute("data-money-action-id")).toBe("action-1");
    expect(page().getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(prepared().owner.address)}` })).toBeTruthy();
    expect(document.body.textContent).toContain("Base (8453)");
    expect(document.body.textContent).toContain("3.50% · stale");
    expect(document.body.textContent).toContain("10% (current)");
    expect(document.body.textContent).toContain("Minimum shares");
    expect(document.body.textContent).toContain("Minimum shares0.1234567 vault shares");
    expect(document.body.textContent).not.toContain("no minimum-shares protection");
    expect(requests).toEqual([{ kind: "savings-deposit", input: { kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1234567" } }]);
  });
  test("Enter continues a valid amount into review without dispatching it", async () => {
    const requests: unknown[] = [];
    let executions = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-deposit", "1234567"); }}
        executeMoneyAction={async () => { executions += 1; return { id: "action-1", status: "submitted" }; }}
        onClose={() => {}}
      />,
    );
    typeAmount("1.234567");
    fireEvent.keyDown(page().getByRole("textbox", { name: "Amount" }), { key: "Enter" });
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1234567" }]);
    expect(executions).toBe(0);
  });

  test("explains an empty withdrawal balance before entry and blocks preparation", () => {
    let prepareCalls = 0;
    render(
      <SavingsMoneyDialog
        open mode="withdraw" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0"
        prepareMoneyAction={async () => { prepareCalls += 1; return prepared("savings-withdraw"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    expect(page().getByRole("status").textContent).toBe("Nothing saved to withdraw.");
    typeAmount("0.10");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(page().getByRole("status").textContent).toBe("Nothing saved to withdraw.");
    fireEvent.click(continueButton);
    expect(prepareCalls).toBe(0);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("explains an empty deposit balance before entry", () => {
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0"
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    expect(page().getByRole("status").textContent).toBe("No USDC available to deposit.");
  });

  test("blocks an amount above a non-zero available deposit balance", () => {
    let prepareCalls = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000"
        prepareMoneyAction={async () => { prepareCalls += 1; return prepared(); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    typeAmount("60");
    const input = page().getByRole("textbox", { name: "Amount" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(page().getByText("Only $50.00 available")).toBeTruthy();
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    fireEvent.click(continueButton);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(prepareCalls).toBe(0);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("defers a stale available balance to server preparation", async () => {
    const requests: unknown[] = [];
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0" availableStale
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-deposit", "60000000"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    expect(page().queryByRole("status")).toBeNull();
    typeAmount("60");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(await page().findByRole("button", { name: "Deposit $60.00" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "60000000" }]);
  });

  test("defers a malformed available balance to server preparation", async () => {
    const requests: unknown[] = [];
    render(
      <SavingsMoneyDialog
        open mode="withdraw" session={session} candidate={candidate}
        availableLabel="$1.50 available" availableBaseUnits="1.5"
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-withdraw"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    typeAmount("1");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(await page().findByRole("button", { name: "Withdraw $1.00" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "withdraw", vaultAddress: VAULT, amountBaseUnits: "1000000" }]);
  });

  test("marks only the prepared Save withdrawal confirm control", async () => {
    render(
      <SavingsMoneyDialog
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    typeAmount("1");
    expect(page().getByRole("button", { name: "Continue" }).hasAttribute("data-money-action-id")).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const confirm = await page().findByRole("button", { name: "Withdraw $1.00" });
    expect(confirm.getAttribute("data-money-action-id")).toBe("action-1");
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(prepared("savings-withdraw").owner.address)}` })).toBeTruthy();
    expect(page().getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
  });

  test("removes the Save confirm marker when the server expires a prepared action", async () => {
    for (const mode of ["deposit", "withdraw"] as const) {
      let executions = 0;
      render(
        <SavingsMoneyDialog
          open mode={mode} session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared(mode === "deposit" ? "savings-deposit" : "savings-withdraw")}
          executeMoneyAction={async () => {
            executions += 1;
            throw Object.assign(new Error("Expired"), { status: 410, code: "ACTION_EXPIRED" });
          }}
          onClose={() => {}}
        />,
      );
      typeAmount("1");
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      const label = `${mode === "deposit" ? "Deposit" : "Withdraw"} $1.00`;
      const confirm = await page().findByRole("button", { name: label });
      expect(confirm.getAttribute("data-money-action-id")).toBe("action-1");
      fireEvent.click(confirm);
      expect((await page().findByRole("alert")).textContent).toBe(`This ${mode} expired. Go back and continue again.`);
      const expiredConfirm = page().getByRole("button", { name: label }) as HTMLButtonElement;
      expect(expiredConfirm.disabled).toBe(true);
      expect(expiredConfirm.hasAttribute("data-money-action-id")).toBe(false);
      expect(page().queryByRole("button", { name: "Retry" })).toBeNull();
      expect(executions).toBe(1);
      fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      expect((await page().findByRole("button", { name: label })).getAttribute("data-money-action-id")).toBe("action-1");
      cleanup();
    }
  });

  test("offers deterministic currency fixtures through the shared asset picker", async () => {
    let selected = "";
    const view = render(
      <SavingsDialogFixtureProvider value={{
        assetOptions: [
          { id: "usdc", label: "USDC", description: "US dollar", currency: "USD" },
          { id: "eurc", label: "EURC", description: "Euro", currency: "EUR" },
          { id: "idrx", label: "IDRX", description: "Indonesian rupiah", currency: "IDR" },
        ],
        onAssetChange: (assetId) => { selected = assetId; },
      }}>
        <SavingsMoneyDialog
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    const input = view.getByRole("combobox", { name: "Asset" });
    const trigger = input.parentElement?.querySelector("button");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    fireEvent.click(await view.findByRole("option", { name: "EUR EURC" }));
    expect(selected).toBe("eurc");
  });

  test("never routes a presentation-only currency through the configured USDC candidate", async () => {
    let prepareCalls = 0;
    render(
      <SavingsDialogFixtureProvider value={{
        assetId: "eurc",
        assetLabel: "EURC",
        assetDecimals: 6,
        assetOptions: [
          { id: "usdc", label: "USDC", description: "US dollar", currency: "USD" },
          { id: "eurc", label: "EURC", description: "Euro", currency: "EUR" },
        ],
        onAssetChange: () => {},
      }}>
        <SavingsMoneyDialog
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => { prepareCalls += 1; return prepared(); }}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    typeAmount("5");
    expect(page().getByText("EURC is available for presentation review only", { exact: false })).toBeTruthy();
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    fireEvent.click(continueButton);
    expect(prepareCalls).toBe(0);
  });

  test("forces every number and drawer layer into deterministic reduced motion", () => {
    const view = render(
      <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
        <SavingsMoneyDialog
          open mode="deposit" session={session} candidate={candidate}
          availableLabel="$50.00 available" availableBaseUnits="50000000"
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    typeAmount("1.234567");
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1.234567");
    expect(page().getByText("$50.00 available")).toBeTruthy();
    expect(view.container.ownerDocument.querySelector("[data-money-sheet]")?.hasAttribute("data-immediate")).toBe(true);
    expect(view.container.ownerDocument.querySelector("[data-slot='drawer-overlay']")?.hasAttribute("data-immediate")).toBe(true);
  });

  test("reopens the same controlled dialog after close", async () => {
    render(<ReopenHarness />);
    fireEvent.click(await page().findByRole("button", { name: "Close deposit dialog" }));
    const reopen = await page().findByRole("button", { name: "Reopen deposit dialog" });
    fireEvent.click(reopen);
    await waitFor(() => expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy());
  });

  test("Back and a rejected action preserve the selected vault, amount, and owner", async () => {
    let prepares = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => { prepares += 1; return prepared(); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "rejected" })}
        onClose={() => {}}
      />,
    );
    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    expect((await page().findByRole("alert")).textContent).toContain("wallet request was rejected");
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(await page().findByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
    expect(prepares).toBe(2);
  });

  test("drops an in-flight owner-A preparation after relogin", async () => {
    let resolveOwnerA!: (action: PreparedMoneyAction) => void;
    const ownerAPreparation = new Promise<PreparedMoneyAction>((resolve) => {
      resolveOwnerA = resolve;
    });
    const ownerBRequests: unknown[] = [];
    const view = render(
      <ReducedSavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={() => ownerAPreparation}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByText("Waiting for your wallet…");

    view.rerender(
      <ReducedSavingsMoneyDialog
        open mode="deposit" session={sessionB} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => {
          ownerBRequests.push(input);
          return prepared("savings-deposit", "1000000", sessionB);
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveOwnerA(prepared("savings-deposit", "1000000", session));
      await ownerAPreparation;
      await Promise.resolve();
    });
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();

    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
    expect(ownerBRequests).toEqual([{
      kind: "deposit",
      vaultAddress: VAULT,
      amountBaseUnits: "1000000",
    }]);
    view.unmount();
  });

  test("clears a completed owner-A review and amount before owner B can confirm", async () => {
    const ownerBRequests: unknown[] = [];
    const view = render(
      <ReducedSavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1234567", session)}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(document.body.textContent).toContain("Base (8453)");

    view.rerender(
      <ReducedSavingsMoneyDialog
        open mode="deposit" session={sessionB} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => {
          ownerBRequests.push(input);
          return prepared("savings-deposit", "2000000", sessionB);
        }}
        executeMoneyAction={async () => ({ id: "action-2", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    expect(page().queryByRole("button", { name: "Deposit $1.234567" })).toBeNull();
    expect(document.body.textContent).not.toContain("Base (8453)");
    expect(document.body.textContent).not.toContain("$1.234567");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    typeAmount("2");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $2.00" })).toBeTruthy();
    expect(document.body.textContent).toContain("Base (8453)");
    expect(ownerBRequests).toEqual([{
      kind: "deposit",
      vaultAddress: VAULT,
      amountBaseUnits: "2000000",
    }]);
  });

  test("does not restore a completed review after sign-out and sign-in", async () => {
    const dialog = (
      <ReducedSavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />
    );
    const view = render(dialog);

    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();

    view.rerender(<></>);
    expect(page().queryByRole("dialog")).toBeNull();
    view.rerender(dialog);

    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    expect(document.body.textContent).not.toContain("Base (8453)");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("reports a failing onConfirmed without relabeling the dispatched action", async () => {
    const previousFetch = globalThis.fetch;
    const reports: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      reports.push({ input: String(input), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    let closes = 0;
    try {
      render(
        <SavingsMoneyDialog
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onConfirmed={async () => { throw new Error("refresh failed"); }}
          onClose={() => { closes += 1; }}
        />,
      );

      typeAmount("1");
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));

      await waitFor(() => expect(closes).toBe(1));
      expect(page().queryByRole("alert")).toBeNull();
      expect(reports).toHaveLength(1);
      expect(reports[0]?.input).toBe("/api/client-errors");
      expect(JSON.parse(String(reports[0]?.init?.body))).toMatchObject({
        name: "Error",
        message: "refresh failed",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("retries the same prepared action after an ambiguous dispatch", async () => {
    let executions = 0;
    let closes = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => { executions += 1; if (executions === 1) throw new Error("ambiguous"); return { id: "action-1", status: "submitted" }; }}
        onClose={() => { closes += 1; }}
      />,
    );
    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    fireEvent.click(await page().findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(closes).toBe(1));
    expect(executions).toBe(2);
  });

  test("disables confirm when prepared savings metadata becomes unavailable", async () => {
    const action = prepared();
    const validMetadata = action.metadata;
    let reads = 0;
    Object.defineProperty(action, "metadata", {
      configurable: true,
      get: () => {
        reads += 1;
        return reads === 1
          ? validMetadata
          : { ...validMetadata, source: { blockNumber: "invalid" } };
      },
    });
    let executions = 0;
    render(
      <SavingsMoneyDialog
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => action}
        executeMoneyAction={async () => {
          executions += 1;
          return { id: "action-1", status: "submitted" };
        }}
        onClose={() => {}}
      />,
    );

    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const confirm = await page().findByRole("button", { name: "Deposit $1.00" }) as HTMLButtonElement;

    expect(document.body.textContent).toContain("Prepared facts unavailable");
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(executions).toBe(0);
  });

  test("surfaces typed prepare errors", async () => {
    for (const failure of [
    { name: "network fee", error: Object.assign(new Error("unfunded"), { status: 409, code: "NETWORK_FEE_UNFUNDED", serverMessage: "Add USDC to cover the network fee." }), message: "Add USDC to cover the network fee." },
    { name: "network fee unavailable", error: Object.assign(new Error("unavailable"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }), message: "The network fee could not be checked. Try again." },
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
