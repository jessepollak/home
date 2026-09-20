import { describe, expect, test } from "bun:test";
import type { ExplorationMoneyState } from "./money-state";
import {
  appendMovement,
  currentMovements,
  entryCountLabel,
  movementAmountLabel,
  movementStatusLabel,
  movementTitle,
  presentExplorationActivity,
  presentExplorationPosition,
  presentMovementReceipt,
  presentUnresolvedMovement,
  settleMovement,
} from "./money-state";
import {
  REIMAGINED_SAVE_AMOUNT_BASE_UNITS,
  reimaginedConfirmedState,
  reimaginedFundedState,
  reimaginedLoadingState,
  reimaginedEmptyState,
  reimaginedFailedState,
  reimaginedLongLocalizedState,
  reimaginedMovement,
  reimaginedPendingState,
  reimaginedSavedUnavailableState,
  reimaginedUnknownState,
} from "./fixtures";

/**
 * Money model tests for the Home reimagined exploration ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * These assert the facts a person would see and the money rules that must not break: exact
 * balances, a confirmed-only balance move, an incomplete total that stays incomplete, and an
 * outcome that is never invented.
 */

const MOVEMENT_ID = "movement-the-visible-one";

function withPendingMovement(state = reimaginedFundedState()) {
  return appendMovement(
    state,
    reimaginedMovement({ id: MOVEMENT_ID, amountBaseUnits: REIMAGINED_SAVE_AMOUNT_BASE_UNITS }),
  );
}

describe("presentExplorationPosition", () => {
  test("states net position, available to use, saved total, weighted rate, and vault rows", () => {
    const view = presentExplorationPosition(reimaginedFundedState());

    expect(view.status).toBe("ready");
    expect(view.netPositionLabel).toBe("$1,250.00");
    expect(view.availableLabel).toBe("$250.00");
    expect(view.savedLabel).toBe("$1,000.00");
    expect(view.apyLabel).toBe("4.04% APY");
    expect(view.debtLabel).toBeNull();
    expect(view.debtSettled).toBe(true);
    expect(view.fundedVaults).toBe(2);
    expect(view.vaults.map((vault) => [vault.shortName, vault.amountLabel, vault.apyLabel])).toEqual([
      ["Gauntlet", "$750.00", "4.10% APY"],
      ["Steakhouse", "$250.00", "3.85% APY"],
      ["Re7", "$0.00", "3.51% APY"],
    ]);
    expect(view.reconciliationLabel).toBe(
      "$250.00 available + $1,000.00 saved − $0.00 debt",
    );
    expect(view.notes).toEqual([]);
  });

  test("keeps an unavailable slice out of the total and says which one is missing", () => {
    const view = presentExplorationPosition(reimaginedSavedUnavailableState());

    expect(view.status).toBe("partial");
    expect(view.netPositionLabel).toBeNull();
    expect(view.availableLabel).toBe("$250.00");
    expect(view.savedLabel).toBeNull();
    expect(view.notes.join(" ")).toContain("Saved balance is unavailable");
  });

  test("renders loading as loading rather than as zero", () => {
    const view = presentExplorationPosition(reimaginedLoadingState());

    expect(view.status).toBe("loading");
    expect(view.netPositionLabel).toBeNull();
    expect(view.availableLabel).toBeNull();
    expect(view.savedLabel).toBeNull();
  });

  test("a verified empty read is zero, not missing", () => {
    const view = presentExplorationPosition(reimaginedEmptyState());

    expect(view.status).toBe("ready");
    expect(view.netPositionLabel).toBe("$0.00");
    expect(view.availableLabel).toBe("$0.00");
    expect(view.savedLabel).toBe("$0.00");
    expect(view.savedFunded).toBe(false);
    expect(view.notes).toEqual([]);
  });

  test("keeps large balances exact and names a holding outside the total", () => {
    const view = presentExplorationPosition(reimaginedLongLocalizedState());

    expect(view.availableLabel).toBe("$1,234,567.89");
    expect(view.savedLabel).toBe("$11,111,111.10");
    expect(view.netPositionLabel).toBe("$12,345,678.99");
    expect(view.notes.join(" ")).toContain("IDR balance is not included");
    expect(view.cashRows.map((row) => [row.name, row.countedInTotal])).toEqual([
      ["US dollar", true],
      ["Indonesian rupiah", false],
    ]);
    const usdRow = view.cashRows.find((row) => row.name === "US dollar");
    expect(usdRow?.amountLabel).toBe("$1,234,567.89");
    // The IDR row is presented by the shared currency formatter, spaces included.
    const idrRow = view.cashRows.find((row) => row.name === "Indonesian rupiah");
    expect(idrRow?.amountLabel.startsWith("Rp")).toBe(true);
    expect(idrRow?.amountLabel).toContain("123,456,789,012.34");
    expect(view.vaults[0]?.name).toBe(
      "Gauntlet Diversified Onchain Treasury Savings Strategy Core",
    );
    expect(view.vaults[0]?.amountLabel).toBe("$9,876,543.21");
  });
});

describe("settleMovement", () => {
  test("a confirmed deposit moves exactly its amount and leaves the net position unchanged", () => {
    const pendingState = withPendingMovement();
    expect(presentExplorationPosition(pendingState).availableLabel).toBe("$250.00");
    expect(presentExplorationPosition(pendingState).savedLabel).toBe("$1,000.00");

    const settled = settleMovement(
      pendingState,
      MOVEMENT_ID,
      { status: "confirmed", transactionHash: `0x${"cd".repeat(32)}` },
      "2026-09-19T12:04:30.000Z",
    );
    const view = presentExplorationPosition(settled);

    expect(view.availableLabel).toBe("$150.00");
    expect(view.savedLabel).toBe("$1,100.00");
    expect(view.netPositionLabel).toBe("$1,250.00");
    // The weighted rate is recomputed from the moved balances, not carried over.
    expect(view.apyLabel).toBe("4.04% APY");
    const gauntlet = view.vaults.find((vault) => vault.shortName === "Gauntlet");
    expect(gauntlet?.amountLabel).toBe("$850.00");
    expect(settled.movements[0]?.status).toBe("confirmed");
  });

  test("pending, failed, and unknown outcomes never move money", () => {
    for (const status of ["pending", "failed", "unknown"] as const) {
      const settled = settleMovement(
        withPendingMovement(),
        MOVEMENT_ID,
        { status },
        "2026-09-19T12:04:30.000Z",
      );
      const view = presentExplorationPosition(settled);
      expect({ status, available: view.availableLabel }).toEqual({
        status,
        available: "$250.00",
      });
      expect({ status, saved: view.savedLabel }).toEqual({ status, saved: "$1,000.00" });
      expect(settled.movements[0]?.status).toBe(status);
    }
  });

  test("a second outcome for the same movement cannot move money twice", () => {
    const settled = settleMovement(
      withPendingMovement(),
      MOVEMENT_ID,
      { status: "confirmed" },
      "2026-09-19T12:04:30.000Z",
    );
    const settledAgain = settleMovement(
      settled,
      MOVEMENT_ID,
      { status: "confirmed" },
      "2026-09-19T12:04:35.000Z",
    );

    expect(presentExplorationPosition(settledAgain).availableLabel).toBe("$150.00");
    expect(presentExplorationPosition(settledAgain).savedLabel).toBe("$1,100.00");
    expect(settledAgain.movements[0]?.resolvedAt).toBe("2026-09-19T12:04:30.000Z");
  });

  test("an unknown movement id leaves the state untouched", () => {
    const state = withPendingMovement();
    expect(settleMovement(state, "not-a-movement", { status: "confirmed" }, "2026-09-19T12:04:30.000Z")).toBe(state);
  });
});

describe("presentExplorationActivity", () => {
  test("keeps chain history settled and a recorded movement in its own status", () => {
    const view = presentExplorationActivity(withPendingMovement());

    expect(view.needsAttention).toBe(1);
    expect(view.unresolved).toHaveLength(1);
    expect(view.unresolved[0]?.status).toBe("pending");
    expect(view.settled).toHaveLength(3);
    // A movement is not a debit: the amount matches the activity rows' token notation
    // without claiming the money left the account.
    expect(view.entries[0]?.amountLabel).toBe("100.00 USDC");
    expect(view.entries.map((entry) => entry.groupKey)).toEqual([
      "2026-09-19",
      "2026-09-19",
      "2026-09-18",
      "2026-09-18",
    ]);
    expect(view.groups.map((group) => [group.key, group.label, group.entries.length])).toEqual([
      ["2026-09-19", "Sep 19", 2],
      ["2026-09-18", "Sep 18", 2],
    ]);
    expect(view.settled[0]?.title).toBe("Received USDC");
    // Chain history keeps the production transfer presentation, symbol included.
    expect(view.settled[0]?.amountLabel).toBe("+250.00 USDC");
    expect(view.settled[0]?.detail).toContain("From 0x2222");
  });
});

describe("movement presentation", () => {
  test("the recorded action's title follows its outcome", () => {
    const titles = (["pending", "failed", "unknown", "confirmed"] as const).map((status) => [
      status,
      movementTitle(reimaginedMovement({ status })),
    ]);

    expect(titles).toEqual([
      ["pending", "Depositing to Gauntlet USDC Core vault"],
      ["failed", "Deposit to Gauntlet USDC Core vault failed"],
      ["unknown", "Deposit to Gauntlet USDC Core vault unconfirmed"],
      ["confirmed", "Saved to Gauntlet USDC Core vault"],
    ]);
    expect(movementStatusLabel("unknown")).toBe("Unknown");
    expect(movementAmountLabel("100000000", "US")).toBe("100.00 USDC");
  });

  test("an unsettled movement never carries a signed or debited amount", () => {
    for (const status of ["pending", "failed", "unknown"] as const) {
      const entry = presentExplorationActivity(
        appendMovement(reimaginedFundedState(), reimaginedMovement({ status })),
      ).entries[0];
      expect({ status, amount: entry?.amountLabel }).toEqual({ status, amount: "100.00 USDC" });
      expect(entry?.amountLabel.startsWith("−")).toBe(false);
      expect(entry?.amountLabel.startsWith("+")).toBe(false);
    }
  });

  test("a recorded deposit says Recorded, so Confirmed is not repeated beside the status", () => {
    const view = presentExplorationActivity(reimaginedConfirmedState());
    const entry = view.entries.find((candidate) => candidate.movementId !== null);

    expect(entry?.statusLabel).toBe("Confirmed");
    expect(entry?.detail.startsWith("Recorded ")).toBe(true);
    expect(entry?.detail).not.toContain("Confirmed");
  });

  test("the receipt carries time, reference, status, and neutral amount", () => {
    const confirmed = reimaginedConfirmedState().movements[0]!;
    const receipt = presentMovementReceipt(confirmed, "US");

    expect(receipt.statusLabel).toBe("Confirmed");
    expect(receipt.referenceLabel).toMatch(/^0x[0-9a-f]{8}…[0-9a-f]{8}$/);
    expect(receipt.amountLabel).toBe("100.00 USDC");
    expect(receipt.destinationName).toBe("Gauntlet USDC Core vault");
    expect(receipt.timeLabel).not.toBe("—");
  });

  test("an unsettled receipt states that no transaction reference exists yet", () => {
    const receipt = presentMovementReceipt(reimaginedFailedState().movements[0]!, "US");

    expect(receipt.statusLabel).toBe("Failed");
    expect(receipt.referenceLabel).toBe("Not issued");
  });

  test("entry counts are pluralized", () => {
    expect(entryCountLabel(1)).toBe("1 entry");
    expect(entryCountLabel(3)).toBe("3 entries");
  });
});

describe("presentUnresolvedMovement", () => {
  test("a failed deposit offers a deliberate retry with the exact vault and amount", () => {
    const state = reimaginedFailedState();
    const summary = presentUnresolvedMovement(state);

    expect(summary?.status).toBe("failed");
    expect(summary?.safeNextStep).toBe("retry");
    expect(summary?.title).toBe("A $100.00 deposit didn't go through");
    // The body reports facts; the failure is stated once, in the title.
    expect(summary?.description).not.toContain("failed");
    expect(summary?.description).toContain("Your available balance is unchanged.");
    expect(summary?.amountLabel).toBe("$100.00");
    expect(summary?.amountBaseUnits).toBe("100000000");
    expect(summary?.vaultAddress).toBe(state.movements[0]?.vaultAddress);
  });

  test("an unknown outcome refuses to retry", () => {
    const state = reimaginedUnknownState();
    const summary = presentUnresolvedMovement(state);

    expect(summary?.status).toBe("unknown");
    expect(summary?.safeNextStep).toBe("activity");
    expect(summary?.title).toBe("A $100.00 deposit is unconfirmed");
    expect(summary?.description).toContain("No confirmation came back");
    expect(summary?.description.match(/check Activity/g)).toHaveLength(1);
  });

  test("a settling deposit says the balance has not changed", () => {
    const state = reimaginedPendingState();
    const summary = presentUnresolvedMovement(state);

    expect(summary?.status).toBe("pending");
    expect(summary?.description).toContain("Your available balance has not changed.");
  });

  test("no unresolved movement means no notice", () => {
    const state = reimaginedFundedState();
    expect(presentUnresolvedMovement(state)).toBeNull();
  });

  test("the unknown notice points at the entry itself when it is already on the ledger", () => {
    const state = reimaginedUnknownState();
    const onHome = presentUnresolvedMovement(state);
    const inLedger = presentUnresolvedMovement(state, { context: "activity" });

    expect(onHome?.description).toContain("check Activity before sending");
    expect(inLedger?.description).toContain("review this entry before sending");
    expect(inLedger?.description).not.toContain("check Activity");
  });
});

describe("retrying a failed movement", () => {
  const failedState = reimaginedFailedState();
  const failedMovement = failedState.movements[0]!;

  function withRetry(status: "pending" | "confirmed" | "unknown"): ExplorationMoneyState {
    // A retry is a new record, appended newest-first exactly as the flow records it.
    return appendMovement(
      failedState,
      reimaginedMovement({
        id: `${failedMovement.id}-retry`,
        status,
        recordedAt: "2026-09-19T12:04:01.000Z",
        transactionHash: status === "confirmed" ? failedMovement.transactionHash : null,
      }),
    );
  }

  test("a newer retry for the same vault and amount supersedes the failure", () => {
    const retrying = withRetry("pending");
    const summary = presentUnresolvedMovement(retrying);

    expect(summary?.status).toBe("pending");
    expect(summary?.title).toBe("A $100.00 deposit is still settling");
    expect(summary?.safeNextStep).toBe("activity");
    // The failure it superseded is still in the ledger.
    expect(retrying.movements).toHaveLength(2);
    expect(retrying.movements[1]?.status).toBe("failed");
    expect(presentExplorationActivity(retrying).entries.some((entry) => entry.status === "failed")).toBe(true);
  });

  test("a confirmed retry leaves nothing unresolved while the failure stays as history", () => {
    const confirmed = withRetry("confirmed");
    const activity = presentExplorationActivity(confirmed);

    expect(presentUnresolvedMovement(confirmed)).toBeNull();
    expect(activity.unresolved).toHaveLength(1);
    expect(activity.unresolved[0]?.status).toBe("failed");
    expect(presentExplorationPosition(confirmed).availableLabel).toBe("$250.00");
  });

  test("an unknown retry supersedes the failure with its own outcome", () => {
    const summary = presentUnresolvedMovement(withRetry("unknown"));

    expect(summary?.status).toBe("unknown");
    expect(summary?.safeNextStep).toBe("activity");
  });

  test("a retry of a different amount does not supersede the failure", () => {
    const otherAmount = appendMovement(
      failedState,
      reimaginedMovement({
        id: `${failedMovement.id}-other`,
        status: "pending",
        amountBaseUnits: "200000000",
        recordedAt: "2026-09-19T12:04:01.000Z",
      }),
    );
    const summary = presentUnresolvedMovement(otherAmount);

    expect(summary?.status).toBe("failed");
    expect(summary?.amountLabel).toBe("$100.00");
    expect(summary?.safeNextStep).toBe("retry");
  });

  test("only the latest attempt of a pair speaks for it", () => {
    const twice = appendMovement(withRetry("pending"), reimaginedMovement({
      id: `${failedMovement.id}-retry-2`,
      status: "failed",
      recordedAt: "2026-09-19T12:04:02.000Z",
    }));
    const current = currentMovements(twice.movements);

    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(`${failedMovement.id}-retry-2`);
    expect(presentUnresolvedMovement(twice)?.status).toBe("failed");
    expect(twice.movements).toHaveLength(3);
  });

  test("the ledger keeps every attempt, newest attempt first", () => {
    const twice = appendMovement(withRetry("pending"), reimaginedMovement({
      id: `${failedMovement.id}-retry-2`,
      status: "confirmed",
      recordedAt: "2026-09-19T12:04:02.000Z",
    }));
    const movementEntries = presentExplorationActivity(twice).entries.filter(
      (entry) => entry.movementId !== null,
    );

    expect(movementEntries.map((entry) => entry.status)).toEqual(["confirmed", "pending", "failed"]);
  });
});
