import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { deferred } from "@/tests/helpers/async";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { HomeShellRoutingProvider, type HomeShellRouting } from "@/client/home/panel-routing";
import { TransferExecutionError } from "@/shared/transfers/types";
import { formatAddress } from "@/shared/formatting";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import type { SavingsJourneyProps, SavingsActionMode } from "./savings-actions";
import type { SavingsManagement } from "@/client/cash/savings-management";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { SavingsJourney } = await import("./savings-actions");
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
function resultRow(rowOwner: PreparedMoneyAction["owner"], status: "pending" | "confirmed" | "failed") {
  const action = prepared();
  return {
    id: action.id, kind: action.kind, status, owner: rowOwner,
    createdAt: action.createdAt, confirmedAt: action.createdAt,
    summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt },
  };
}
function amountInput(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected an Amount input");
  return element;
}
async function typeAmount(value: string) {
  fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value } });
}
afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

type AmountJourneyProps = Omit<SavingsJourneyProps, "entry" | "management" | "onSelectMode" | "onBackToManagement" | "mode" | "candidate"> & {
  mode: SavingsActionMode;
  candidate: MorphoVaultCandidate;
};

function AmountJourney(props: AmountJourneyProps) {
  return <SavingsJourney {...props} entry="amount" management={null} onSelectMode={() => {}} onBackToManagement={() => {}} />;
}

function ReducedAmountJourney(props: AmountJourneyProps) {
  return <SavingsDialogFixtureProvider value={{ motion: "reduced" }}><AmountJourney {...props} /></SavingsDialogFixtureProvider>;
}

function ReopenHarness() {
  const [open, setOpen] = useState(true);
  const [closed, setClosed] = useState(false);
  return (
    <>
      {!open ? <button onClick={() => setOpen(true)}>Reopen deposit dialog</button> : null}
      {closed ? <span>journey closed</span> : null}
      <AmountJourney
        open={open}
        mode="deposit"
        session={session}
        candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => setOpen(false)}
        onClosed={() => setClosed(true)}
      />
    </>
  );
}

describe("SavingsJourney amount entry", () => {
  test("deposit Max reports a failed USDC fee lookup and recovers on Retry", async () => {
    let failLookup = true;
    const feeLookupWait = { timeout: 5000 };
    render(<AmountJourney open mode="deposit" session={session} candidate={candidate}
      availableLabel="$50.00 available" availableBaseUnits="50000000"
      fetchAccountResource={async () => {
        if (failLookup) throw new Error("network unavailable");
        return { version: 1, usdcReserveBaseUnits: "20000" };
      }}
      prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })} onClose={() => {}} />);
    const alert = await page().findByRole("alert", {}, feeLookupWait);
    expect(alert.textContent).toContain("Couldn't check the network fee.");
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    // Recovery starts only once the settled failure is observable, so extra or reordered lookups cannot consume a failure budget.
    failLookup = false;
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(page().queryByRole("alert") === null).toBe(true), feeLookupWait);
    await waitFor(() => expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false), feeLookupWait);
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect((await page().findByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("49.98");
  });

  test("withdraw does not report an irrelevant USDC fee lookup failure", async () => {
    render(<AmountJourney open mode="withdraw" session={session} candidate={candidate}
      availableLabel="$50.00 available" availableBaseUnits="50000000"
      fetchAccountResource={async () => { throw new Error("network unavailable"); }}
      prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })} onClose={() => {}} />);
    await page().findByRole("textbox", { name: "Amount" });
    await waitFor(() => expect(getHomeQueryClient().isFetching()).toBe(0));
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("prepares a deposit through the unified actions endpoint", async () => {
    const requests: Array<{ kind: string; input: unknown }> = [];
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000" destinationLabel="Gauntlet USDC Prime · 4.10% APY"
        prepareMoneyAction={async (kind, input) => { requests.push({ kind, input }); return prepared("savings-deposit", "1234567"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    const amount = await page().findByRole("textbox", { name: "Amount" });
    const destination = await page().findByText("Gauntlet USDC Prime · 4.10% APY");
    expect(destination.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(destination.closest('[data-slot="alert"]')).toBeNull();
    await typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Deposit $1.234567" }).getAttribute("data-money-action-id")).toBe("action-1");
    expect(page().getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(prepared().owner.address)}` })).toBeTruthy();
    expect(document.body.textContent).toContain("Base (8453)");
    expect(document.body.textContent).toContain("Rate3.50% APY at last update");
    expect(document.body.textContent).toContain("Vault fee10%");
    expect(document.body.textContent).not.toContain("Share preview");
    expect(document.body.textContent).not.toContain("Minimum shares");
    expect(document.body.textContent).not.toContain("no minimum-shares protection");
    expect(requests).toEqual([{ kind: "savings-deposit", input: { kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1234567" } }]);
  });
  test("Enter continues a valid amount into review without dispatching it", async () => {
    const requests: unknown[] = [];
    let executions = 0;
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-deposit", "1234567"); }}
        executeMoneyAction={async () => { executions += 1; return { id: "action-1", status: "submitted" }; }}
        onClose={() => {}}
      />,
    );
    await typeAmount("1.234567");
    fireEvent.keyDown(page().getByRole("textbox", { name: "Amount" }), { key: "Enter" });
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1234567" }]);
    expect(executions).toBe(0);
  });

  test("explains an empty withdrawal balance before entry and blocks preparation", async () => {
    let prepareCalls = 0;
    render(
      <AmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0"
        prepareMoneyAction={async () => { prepareCalls += 1; return prepared("savings-withdraw"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await page().findByRole("textbox", { name: "Amount" });
    expect(page().getByRole("status").textContent).toBe("Nothing available to withdraw right now.");
    await typeAmount("0.10");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(page().getByRole("status").textContent).toBe("Nothing available to withdraw right now.");
    fireEvent.click(continueButton);
    expect(prepareCalls).toBe(0);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("explains an empty deposit balance before entry", async () => {
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0"
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await page().findByRole("textbox", { name: "Amount" });
    expect(page().getByRole("status").textContent).toBe("No USDC available to deposit.");
  });

  test("blocks an amount above a non-zero available deposit balance", async () => {
    let prepareCalls = 0;
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000"
        prepareMoneyAction={async () => { prepareCalls += 1; return prepared(); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("60");
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
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        availableLabel="$0.00 available" availableBaseUnits="0" availableStale
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-deposit", "60000000"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await page().findByRole("textbox", { name: "Amount" });
    expect(page().queryByRole("status")).toBeNull();
    await typeAmount("60");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(await page().findByRole("button", { name: "Deposit $60.00" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "60000000" }]);
  });

  test("defers a malformed available balance to server preparation", async () => {
    const requests: unknown[] = [];
    render(
      <AmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        availableLabel="$1.50 available" availableBaseUnits="1.5"
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-withdraw"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(await page().findByRole("button", { name: "Withdraw $1.00" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "withdraw", vaultAddress: VAULT, amountBaseUnits: "1000000" }]);
  });

  test("marks only the prepared Save withdrawal confirm control", async () => {
    render(
      <AmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
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
        <AmountJourney
          open mode={mode} session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared(mode === "deposit" ? "savings-deposit" : "savings-withdraw")}
          executeMoneyAction={async () => {
            executions += 1;
            throw Object.assign(new Error("Expired"), { status: 410, code: "ACTION_EXPIRED" });
          }}
          onClose={() => {}}
        />,
      );
      await typeAmount("1");
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
        <AmountJourney
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    const input = await view.findByRole("combobox", { name: "Asset" });
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
        <AmountJourney
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => { prepareCalls += 1; return prepared(); }}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    await typeAmount("5");
    expect(page().getByText("EURC is available for presentation review only", { exact: false })).toBeTruthy();
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    fireEvent.click(continueButton);
    expect(prepareCalls).toBe(0);
  });

  test("forces every number and drawer layer into deterministic reduced motion", async () => {
    const view = render(
      <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
        <AmountJourney
          open mode="deposit" session={session} candidate={candidate}
          availableLabel="$50.00 available" availableBaseUnits="50000000"
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />
      </SavingsDialogFixtureProvider>,
    );

    await typeAmount("1.234567");
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1.234567");
    expect(page().getByText("$50.00 available")).toBeTruthy();
    expect(view.container.ownerDocument.querySelector("[data-money-sheet]")?.hasAttribute("data-immediate")).toBe(true);
    expect(view.container.ownerDocument.querySelector("[data-slot='drawer-overlay']")?.hasAttribute("data-immediate")).toBe(true);
  });

  test("reopens the same controlled dialog after close", async () => {
    render(<ReopenHarness />);
    await page().findByRole("textbox", { name: "Amount" });
    fireEvent.click(await page().findByRole("button", { name: "Close deposit dialog" }));
    await page().findByText("journey closed");
    const reopen = await page().findByRole("button", { name: "Reopen deposit dialog" });
    fireEvent.click(reopen);
    await waitFor(() => expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy());
  });

  test("reopening a controlled dialog after review starts a fresh amount", async () => {
    function ReopenFromReview() {
      const [open, setOpen] = useState(true);
      const [closed, setClosed] = useState(false);
      return <>
        {!open ? <button onClick={() => setOpen(true)}>Reopen deposit dialog</button> : null}
        {closed ? <span>journey closed</span> : null}
        <AmountJourney open={open} mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => setOpen(false)} onClosed={() => setClosed(true)} />
      </>;
    }
    render(<ReopenFromReview />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
    await page().findByText("journey closed");
    fireEvent.click(await page().findByRole("button", { name: "Reopen deposit dialog" }));
    await page().findByRole("dialog", { name: "Deposit" });
    expect(amountInput(await page().findByRole("textbox", { name: "Amount" })).value).toBe("");
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
  });

  test("reopening a controlled dialog after a result starts a fresh amount", async () => {
    function ReopenFromResult() {
      const [open, setOpen] = useState(true);
      const [closed, setClosed] = useState(false);
      return <>
        {!open ? <button onClick={() => setOpen(true)}>Reopen deposit dialog</button> : null}
        {closed ? <span>journey closed</span> : null}
        <AmountJourney open={open} mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => setOpen(false)} onClosed={() => setClosed(true)} />
      </>;
    }
    render(<ReopenFromResult />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    expect(await page().findByRole("heading", { name: "Depositing $1.00 to Save" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
    await page().findByText("journey closed");
    fireEvent.click(await page().findByRole("button", { name: "Reopen deposit dialog" }));
    await page().findByRole("dialog", { name: "Deposit" });
    expect(amountInput(await page().findByRole("textbox", { name: "Amount" })).value).toBe("");
    expect(page().queryByRole("heading", { name: "Depositing $1.00 to Save" })).toBeNull();
  });

  test("Save review X closes once and Back returns exactly to the typed amount", async () => {
    let closes = 0;
    function Journey() {
      const [open, setOpen] = useState(true);
      return <AmountJourney open={open} mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => { closes++; setOpen(false); }} />;
    }
    render(<Journey />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(closes).toBe(1);
  });

  test("Save amount to review and Back keeps one dialog and refocuses amount", async () => {
    render(<>
      <button type="button">Save trigger</button>
      <AmountJourney open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />
    </>);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("button", { name: "Deposit $1.00" });
    const dialog = page().getByRole("dialog", { name: "Confirm" });
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(page().getByText("Save trigger"));
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(page().getByRole("textbox", { name: "Amount" }));
  });

  test("Back and a rejected action preserve the selected vault, amount, and owner", async () => {
    let prepares = 0;
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => { prepares += 1; return prepared(); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "rejected" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
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
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={() => ownerAPreparation}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));

    view.rerender(
      <ReducedAmountJourney
        open mode="deposit" session={sessionB} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => {
          ownerBRequests.push(input);
          return prepared("savings-deposit", "1000000", sessionB);
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await page().findByRole("textbox", { name: "Amount" });
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveOwnerA(prepared("savings-deposit", "1000000", session));
      await ownerAPreparation;
      await Promise.resolve();
    });
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();

    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
    expect(ownerBRequests).toEqual([{
      kind: "deposit",
      vaultAddress: VAULT,
      amountBaseUnits: "1000000",
    }]);
    view.unmount();
  });

const management: SavingsManagement = {
  address: VAULT,
  name: "Configured USDC vault",
  savedBaseUnits: "50000000",
  unreadable: false,
  absent: false,
  rateLabel: "3.50% APY",
  depositCandidate: candidate,
  withdrawCandidate: candidate,
  deposit: { enabled: true, reason: null },
  withdraw: { enabled: true, reason: null },
  facts: [],
  details: [],
  liquidityNote: null,
};

function ManagementHarness({ prepareMoneyAction }: {
  prepareMoneyAction: SavingsJourneyProps["prepareMoneyAction"];
}) {
  const [mode, setMode] = useState<SavingsActionMode | null>("deposit");
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setMode(null)}>Leave amount for tray</button>
      <SavingsJourney
        open={open}
        entry="management"
        management={management}
        mode={mode}
        session={session}
        candidate={candidate}
        prepareMoneyAction={prepareMoneyAction}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onSelectMode={(next) => setMode(next)}
        onBackToManagement={() => setMode(null)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

  test("keeps the amount step with a busy Continue until the preparation resolves", async () => {
    let resolveDeposit!: (action: PreparedMoneyAction) => void;
    let prepares = 0;
    render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={() => { prepares += 1; return new Promise<PreparedMoneyAction>((resolve) => { resolveDeposit = resolve; }); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    const continueButton = page().getByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);
    await waitFor(() => expect(continueButton.getAttribute("aria-busy")).toBe("true"));
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(page().queryByText("Prepared facts unavailable")).toBeNull();
    expect((page().getByRole("button", { name: "Close deposit dialog" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(continueButton);
    fireEvent.keyDown(page().getByRole("textbox", { name: "Amount" }), { key: "Enter" });
    expect(prepares).toBe(1);
    await act(async () => {
      resolveDeposit(prepared("savings-deposit", "1000000"));
      await Promise.resolve();
    });
    expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
  });

  test("preparing keeps focus on a read-only amount with Max disabled and ignores edits", async () => {
    let resolveDeposit!: (action: PreparedMoneyAction) => void;
    render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={() => new Promise<PreparedMoneyAction>((resolve) => { resolveDeposit = resolve; })}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    const input = page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    act(() => { input.focus(); });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    await typeAmount("2");
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(input.value).toBe("1");
    expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      resolveDeposit(prepared("savings-deposit", "1000000"));
      await Promise.resolve();
    });
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
  });

  test("keeps the amount step and reports a failed preparation there", async () => {
    let rejectDeposit!: (error: unknown) => void;
    render(
      <ReducedAmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={() => new Promise<PreparedMoneyAction>((_resolve, reject) => { rejectDeposit = reject; })}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    await act(async () => {
      rejectDeposit(Object.assign(new Error("limited"), { status: 429, code: "SAVINGS_ACTION_RATE_LIMITED", serverMessage: "Base RPC is rate limited. Try again shortly." }));
      await Promise.resolve();
    });
    expect((await page().findByRole("alert")).textContent).toContain("Base RPC is rate limited");
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBeNull();
    expect((page().getByRole("button", { name: "Close withdraw dialog" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("browser Back during a pending preparation leaves the management tray dismissible", async () => {
    let resolveDeposit!: (action: PreparedMoneyAction) => void;
    const pending = new Promise<PreparedMoneyAction>((resolve) => {
      resolveDeposit = resolve;
    });
    render(
      <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
        <ManagementHarness prepareMoneyAction={() => pending} />
      </SavingsDialogFixtureProvider>,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(page().getByText("Leave amount for tray"));
    const tray = await page().findByRole("dialog", { name: "Configured USDC vault" });
    const close = within(tray).getByRole("button", { name: "Close Configured USDC vault details" }) as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    await act(async () => {
      resolveDeposit(prepared("savings-deposit", "1000000"));
      await pending;
      await Promise.resolve();
    });
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
  });

  test("drops an in-flight deposit preparation when the journey switches to withdraw", async () => {
    let resolveDeposit!: (action: PreparedMoneyAction) => void;
    const depositPreparation = new Promise<PreparedMoneyAction>((resolve) => {
      resolveDeposit = resolve;
    });
    const requests: unknown[] = [];
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={() => depositPreparation}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    view.rerender(
      <ReducedAmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return prepared("savings-withdraw"); }}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await act(async () => {
      resolveDeposit(prepared("savings-deposit", "1000000"));
      await depositPreparation;
      await Promise.resolve();
    });
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    expect((await page().findByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Withdraw $1.00" })).toBeTruthy();
    expect(requests).toEqual([{ kind: "withdraw", vaultAddress: VAULT, amountBaseUnits: "1000000" }]);
    view.unmount();
  });

  test("allows a new withdrawal dispatch while an abandoned deposit dispatch is still pending", async () => {
    let releaseDeposit!: () => void;
    const depositDispatch = new Promise<{ id: string; status: "submitted" }>((resolve) => {
      releaseDeposit = () => resolve({ id: "action-1", status: "submitted" });
    });
    const withdrawals: string[] = [];
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1000000")}
        executeMoneyAction={() => depositDispatch as never}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    view.rerender(
      <ReducedAmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-withdraw", "1000000")}
        executeMoneyAction={async (action) => { withdrawals.push(action.kind); return { id: "action-2", status: "submitted" }; }}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw $1.00" }));
    expect(await page().findByRole("button", { name: "Done" })).toBeTruthy();
    expect(withdrawals).toEqual(["savings-withdraw"]);
    await act(async () => {
      releaseDeposit();
      await depositDispatch;
      await Promise.resolve();
    });
    view.unmount();
  });

  test("drops a submitted dispatch when the journey switches mode while the refresh is pending", async () => {
    let releaseRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshes = 0;
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1000000")}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onConfirmed={() => { refreshes += 1; return refresh; }}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await waitFor(() => expect(refreshes).toBe(1));
    view.rerender(
      <ReducedAmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-2", status: "submitted" })}
        onConfirmed={() => { refreshes += 1; return refresh; }}
        onClose={() => {}}
      />,
    );
    await act(async () => {
      releaseRefresh();
      await refresh;
      await Promise.resolve();
    });
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Done" })).toBeNull();
    expect(await page().findByRole("textbox", { name: "Amount" })).toBeTruthy();
    view.unmount();
  });

  test("drops an in-flight dispatch result after the journey switches mode", async () => {
    let settleDispatch!: () => void;
    const dispatch = new Promise<{ id: string; status: "submitted" }>((resolve) => {
      settleDispatch = () => resolve({ id: "action-1", status: "submitted" });
    });
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1000000")}
        executeMoneyAction={() => dispatch as never}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    view.rerender(
      <ReducedAmountJourney
        open mode="withdraw" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-2", status: "submitted" })}
        onClose={() => {}}
      />,
    );
    await act(async () => {
      settleDispatch();
      await dispatch;
      await Promise.resolve();
    });
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Done" })).toBeNull();
    expect(await page().findByRole("textbox", { name: "Amount" })).toBeTruthy();
    view.unmount();
  });

  test("does not call onConfirmed when the dispatch settles after unmount", async () => {
    const dispatch = deferred<Awaited<ReturnType<SavingsJourneyProps["executeMoneyAction"]>>>();
    let confirmed = 0;
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1000000")}
        executeMoneyAction={() => dispatch.promise}
        onConfirmed={() => { confirmed += 1; }}
        onClose={() => {}}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    view.unmount();
    await act(async () => {
      dispatch.resolve({ id: "action-1", status: "submitted" });
      await dispatch.promise;
      await Promise.resolve();
    });
    expect(confirmed).toBe(0);
  });

  test("clears a completed owner-A review and amount before owner B can confirm", async () => {
    const ownerBRequests: unknown[] = [];
    const view = render(
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared("savings-deposit", "1234567", session)}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    await typeAmount("1.234567");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.234567" })).toBeTruthy();
    expect(document.body.textContent).toContain("Base (8453)");

    view.rerender(
      <ReducedAmountJourney
        open mode="deposit" session={sessionB} candidate={candidate}
        prepareMoneyAction={async (_kind, input) => {
          ownerBRequests.push(input);
          return prepared("savings-deposit", "2000000", sessionB);
        }}
        executeMoneyAction={async () => ({ id: "action-2", status: "submitted" })}
        onClose={() => {}}
      />,
    );

    await page().findByRole("textbox", { name: "Amount" });
    expect(page().queryByRole("button", { name: "Deposit $1.234567" })).toBeNull();
    expect(document.body.textContent).not.toContain("Base (8453)");
    expect(document.body.textContent).not.toContain("$1.234567");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    await typeAmount("2");
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
      <ReducedAmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
        onClose={() => {}}
      />
    );
    const view = render(dialog);

    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();

    view.rerender(<></>);
    expect(page().queryByRole("dialog")).toBeNull();
    view.rerender(dialog);

    await page().findByRole("textbox", { name: "Amount" });
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
        <AmountJourney
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onConfirmed={async () => { throw new Error("refresh failed"); }}
          onClose={() => { closes += 1; }}
        />,
      );

      await typeAmount("1");
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));

      await page().findByRole("heading", { name: "Depositing $1.00 to Save" });
      expect(closes).toBe(0);
      expect(page().queryByRole("alert")).toBeNull();
      await waitFor(() => expect(reports).toHaveLength(1));
      expect(reports[0]?.input).toBe("/api/client-errors");
      expect(JSON.parse(String(reports[0]?.init?.body))).toMatchObject({
        name: "Error",
        message: "refresh failed",
      });
      fireEvent.click(page().getByRole("button", { name: "Done" }));
      expect(closes).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("retries the same prepared action after an ambiguous dispatch", async () => {
    let executions = 0;
    let closes = 0;
    render(
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => { executions += 1; if (executions === 1) throw new Error("ambiguous"); return { id: "action-1", status: "submitted" }; }}
        onClose={() => { closes += 1; }}
      />,
    );
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    fireEvent.click(await page().findByRole("button", { name: "Retry" }));
    await page().findByRole("heading", { name: "Depositing $1.00 to Save" });
    expect(closes).toBe(0);
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(closes).toBe(1);
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
      <AmountJourney
        open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => action}
        executeMoneyAction={async () => {
          executions += 1;
          return { id: "action-1", status: "submitted" };
        }}
        onClose={() => {}}
      />,
    );

    await typeAmount("1");
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
        <AmountJourney
          open mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => { throw failure.error; }}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onClose={() => {}}
        />,
      );
      await typeAmount("5");
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      expect((await page().findByRole("alert")).textContent).toContain(failure.message);
      cleanup();
    }
  });

  test("keeps one focused busy confirm control and ignores a second submit", async () => {
    let release!: (value: { id: string; status: "submitted" }) => void;
    let calls = 0;
    render(<AmountJourney open mode="deposit" session={session} candidate={candidate}
      prepareMoneyAction={async () => prepared()}
      executeMoneyAction={() => { calls += 1; return new Promise((resolve) => { release = resolve; }); }}
      onClose={() => {}} />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const confirm = await page().findByRole("button", { name: "Deposit $1.00" });
    confirm.focus();
    fireEvent.click(confirm);
    expect(page().getByRole("button", { name: "Deposit $1.00" })).toBe(confirm);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm).toBe(document.activeElement as HTMLElement);
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();
    expect((page().getByRole("button", { name: "Close deposit dialog" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(calls).toBe(1);
    await act(async () => release({ id: "action-1", status: "submitted" }));
    expect(await page().findByRole("heading", { name: "Depositing $1.00 to Save" })).toBeTruthy();
    expect(page().getByText("Submitted")).toBeTruthy();
    expect(page().getByText("Confirming on Base")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    expect((page().getByRole("button", { name: "Close deposit dialog" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("ignores another owner's matching id and follows this owner's confirmed row", async () => {
    let rowOwner = prepared().owner;
    let closes = 0;
    const fetchAccountResource = async () => ({ actions: [resultRow(rowOwner, "confirmed")] });
    render(<AmountJourney open mode="withdraw" session={session} candidate={candidate}
      prepareMoneyAction={async () => prepared("savings-withdraw")}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
      fetchAccountResource={fetchAccountResource} onClose={() => { closes += 1; }} />);
    rowOwner = prepared("savings-deposit", "1000000", sessionB).owner;
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw $1.00" }));
    expect(await page().findByRole("heading", { name: "Withdrawing $1.00 from Save" })).toBeTruthy();
    expect(page().getByText("Confirming on Base")).toBeTruthy();
    rowOwner = prepared().owner;
    await act(async () => { await getHomeQueryClient().invalidateQueries(); });
    expect(await page().findByRole("heading", { name: "Withdrew $1.00 from Save" })).toBeTruthy();
    expect(page().queryByText("Confirming on Base")).toBeNull();
    expect(closes).toBe(0);
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(closes).toBe(1);
  });

  test("a failed owner row offers a fresh review with the amount retained", async () => {
    let preparations = 0;
    render(<AmountJourney open mode="deposit" session={session} candidate={candidate}
      prepareMoneyAction={async () => { preparations += 1; return prepared(); }}
      executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
      fetchAccountResource={async () => ({ actions: [resultRow(prepared().owner, "failed")] })}
      onClose={() => {}} />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    expect(await page().findByRole("heading", { name: "Deposit didn't go through" })).toBeTruthy();
    expect(page().getByText("Your $1.00 is still in your account.")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(await page().findByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(page().queryByRole("button", { name: "Deposit $1.00" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
    expect(preparations).toBe(2);
  });

  test("typed failed execution shows a result instead of the old alert", async () => {
    render(<AmountJourney open mode="withdraw" session={session} candidate={candidate}
      prepareMoneyAction={async () => prepared("savings-withdraw")}
      executeMoneyAction={async () => ({ id: "action-1", status: "failed" })}
      onClose={() => {}} />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw $1.00" }));
    expect(await page().findByRole("heading", { name: "Withdrawal didn't go through" })).toBeTruthy();
    expect(page().getByText("Your $1.00 is still in Save.")).toBeTruthy();
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test.each(["submission-unknown", "dispatch-unknown"] as const)("%s never offers retry and opens Activity after closing", async (reason) => {
    const events: string[] = [];
    const routing = { openPanel: (panel: string) => { events.push(`panel:${panel}`); } } as HomeShellRouting;
    render(<HomeShellRoutingProvider value={routing}>
      <AmountJourney open mode="deposit" session={session} candidate={candidate}
        prepareMoneyAction={async () => prepared()}
        executeMoneyAction={async () => { throw new TransferExecutionError(reason); }}
        fetchAccountResource={async () => ({ actions: [resultRow(prepared().owner, "pending")] })}
        onClose={() => { events.push("close"); }} />
    </HomeShellRoutingProvider>);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    expect(await page().findByRole("heading", { name: "We can't confirm $1.00" })).toBeTruthy();
    expect(page().getByText("It may have gone through. Check Activity before trying again.")).toBeTruthy();
    expect(page().queryByRole("button", { name: /retry|try again/i })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "View in Activity" }));
    expect(events).toEqual(["close"]);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(events).toEqual(["close", "panel:activity"]);
  });
});

const { SavingsMoneyFlow } = await import("./savings-actions");
const { MoneyModal } = await import("@/client/money-modal");

describe("SavingsMoneyFlow embedded in a MoneyModal", () => {
  test("amount Back returns to the parent step while X exits the host", async () => {
    const events: string[] = [];
    function Journey() {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} immediate labelledBy="savings-action-title"
        onCancel={() => { events.push("exit"); setOpen(false); }} onClose={() => { events.push("closed"); }}>
        <SavingsMoneyFlow depth={1} mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => prepared()}
          executeMoneyAction={async () => ({ id: "action-1", status: "submitted" })}
          onBack={() => { events.push("back"); }} />
      </MoneyModal>;
    }
    render(<Journey />);
    await page().findByRole("textbox", { name: "Amount" });
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(events).toEqual(["back"]);
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(events).toEqual(["back", "exit", "closed"]);
  });

  test("deposit preparation, review, and confirmation work at depth 1; Done delegates to the embedding host", async () => {
    const events: string[] = [];
    const requests: unknown[] = [];
    let releasePreparation!: (action: PreparedMoneyAction) => void;
    const preparation = new Promise<PreparedMoneyAction>((resolve) => { releasePreparation = resolve; });
    render(<MoneyModal open immediate labelledBy="savings-action-title"
      onCancel={() => { events.push("exit"); }} onClose={() => { events.push("closed"); }}>
      <SavingsMoneyFlow depth={1} mode="deposit" session={session} candidate={candidate}
        availableLabel="$50.00 available" availableBaseUnits="50000000"
        prepareMoneyAction={async (_kind, input) => { requests.push(input); return preparation; }}
        executeMoneyAction={async (action) => { events.push(`confirm:${action.id}`); return { id: action.id, status: "submitted" }; }}
        onBack={() => { events.push("back"); }} onDone={() => { events.push("done"); }} />
    </MoneyModal>);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect((page().getByRole("button", { name: "Close deposit dialog" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { releasePreparation(prepared()); await preparation; });
    const confirm = await page().findByRole("button", { name: "Deposit $1.00" });
    expect(confirm.getAttribute("data-money-action-id")).toBe("action-1");
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByText("Vault fee")).toBeTruthy();
    expect(page().getByText("Base (8453)")).toBeTruthy();
    expect(requests).toEqual([{ kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1000000" }]);
    fireEvent.click(confirm);
    expect(await page().findByRole("heading", { name: "Depositing $1.00 to Save" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(events).toEqual(["confirm:action-1", "done"]);
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
  });

  test("an embedded deposit prepares and confirms without host action history", async () => {
    const noop = () => undefined;
    let prepares = 0;
    let executions = 0;
    function Host() {
      return <MoneyModal open immediate labelledBy="savings-action-title" onCancel={noop} onClose={noop}>
        <SavingsMoneyFlow depth={1} mode="deposit" session={session} candidate={candidate}
          prepareMoneyAction={async () => { prepares += 1; return prepared(); }}
          executeMoneyAction={async (action) => { executions += 1; return { id: action.id, status: "submitted" }; }} />
      </MoneyModal>;
    }
    render(<Host />);
    await typeAmount("1");
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $1.00" })).toBeTruthy();
    expect(prepares).toBe(1);
    const late = page().getByRole("button", { name: "Deposit $1.00" }) as HTMLButtonElement;
    expect(late.disabled).toBe(false);
    fireEvent.click(late);
    await waitFor(() => expect(executions).toBe(1));
  });

  test("a mode change during preparation restarts the embedded amount step", async () => {
    const preparation = deferred<PreparedMoneyAction>();
    function Host({ mode }: { mode: "deposit" | "withdraw" }) {
      return <MoneyModal open immediate labelledBy="savings-action-title" onCancel={() => {}} onClose={() => {}}>
        <SavingsMoneyFlow depth={1} mode={mode} session={session} candidate={candidate}
          prepareMoneyAction={() => preparation.promise}
          executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} />
      </MoneyModal>;
    }
    const view = render(<Host mode="deposit" />);
    await typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    view.rerender(<Host mode="withdraw" />);
    expect(amountInput(page().getByRole("textbox", { name: "Amount" })).value).toBe("");
    expect(page().queryByRole("button", { name: "Withdraw $1.00" })).toBeNull();
    await act(async () => {
      preparation.resolve(prepared());
      await Promise.resolve();
    });
    expect(amountInput(page().getByRole("textbox", { name: "Amount" })).value).toBe("");
    expect(page().queryByRole("button", { name: "Withdraw $1.00" })).toBeNull();
  });
});
