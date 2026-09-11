import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useAccountWallet } from "@/features/account/cdp-client";
import {
  SAVE_QA_CLOCK_MS,
  SAVE_QA_GAUNTLET,
  SAVE_QA_STEAKHOUSE,
  createSaveQaPositions,
  createSaveQaPreparedAction,
  createSaveQaVaults,
} from "./fixtures";
import { SaveQaClient } from "./save-qa-client";

function AccountProbe() {
  const account = useAccountWallet();
  return <output data-testid="account-state">{account.status}:{account.ownerKey}</output>;
}

afterEach(() => cleanup());

describe("Save QA route contract", () => {
  test("uses one scenario clock and deterministic weighted fixtures", () => {
    const vaults = createSaveQaVaults("standard", SAVE_QA_CLOCK_MS);
    const positions = createSaveQaPositions("a", "weighted", SAVE_QA_CLOCK_MS) as {
      accountAddress: string;
      vaults: Array<{ vaultAddress: string; position: { assetsRaw: string } | null }>;
    };
    expect(Date.parse(vaults.source.fetchedAt)).toBeLessThanOrEqual(SAVE_QA_CLOCK_MS);
    expect(positions.vaults.find((entry) => entry.vaultAddress === SAVE_QA_GAUNTLET)?.position?.assetsRaw).toBe("100000000");
    expect(positions.vaults.find((entry) => entry.vaultAddress === SAVE_QA_STEAKHOUSE)?.position?.assetsRaw).toBe("300000000");
  });

  test("preparation validates the real endpoint and emits no executable calls", () => {
    const action = createSaveQaPreparedAction("a", "/api/savings/actions", {
      kind: "deposit",
      vaultAddress: SAVE_QA_GAUNTLET,
      amountBaseUnits: "1000000",
    });
    expect(action.kind).toBe("save-deposit");
    expect(action.calls).toEqual([]);
    expect(action.owner.subject).toBe("save-qa-subject-a");
    expect(() => createSaveQaPreparedAction("a", "/api/other", {})).toThrow();
  });

  test("starts disarmed, installs a scoped controller, mounts children only after arm, and cleans up", async () => {
    const view = render(
      <SaveQaClient>
        <AccountProbe />
      </SaveQaClient>,
    );

    expect(view.getByText(/Save QA is disarmed/)).toBeTruthy();
    expect(view.queryByTestId("account-state")).toBeNull();
    await waitFor(() => expect(window.saveQa).toBeDefined());
    expect(window.saveQa?.snapshot().counters.positionReads).toBe(0);

    act(() => window.saveQa?.arm());
    await waitFor(() => expect(view.getByTestId("account-state").textContent).toBe("verified:save-qa-owner-a"));

    view.unmount();
    expect(window.saveQa).toBeUndefined();
  });

  test("fails signing and execution methods closed with observable attempts", async () => {
    render(<SaveQaClient><AccountProbe /></SaveQaClient>);
    await waitFor(() => expect(window.saveQa).toBeDefined());
    act(() => window.saveQa?.arm());
    for (const method of ["check", "execute", "send", "sign-in", "sign"] as const) {
      await expect(window.saveQa!.forceFailClosed(method)).rejects.toThrow("SAVE_QA_FAIL_CLOSED");
    }
    const counters = window.saveQa!.snapshot().counters;
    expect(counters.checks).toBe(1);
    expect(counters.executions).toBe(1);
    expect(counters.sends).toBe(1);
    expect(counters.signIns).toBe(1);
    expect(counters.signatures).toBe(1);
  });
});
