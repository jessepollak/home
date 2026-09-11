import { afterEach, describe, expect, test } from "bun:test";
import {
  ADDRESS_A,
  AccountProbe,
  CdpAccountProvider,
  SessionHarness,
  TestJournalLock,
  baseSdk,
  cleanup,
  createBlockedAccountWalletClient,
  fireEvent,
  page,
  preparedMoneyAction,
  render,
  sessionFor,
  sessionResponse,
  waitFor,
} from "./cdp-client-test-harness";
import { ProviderHandleJournal } from "@/client/money-actions/provider-handle-journal";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("cdp client facade", () => {
  test("is inert when the public project configuration is missing", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <AccountProbe />
      </CdpAccountProvider>,
    );

    expect(page().getByTestId("status").textContent).toBe("signed-out");
    expect(page().getByTestId("availability").textContent).toBe("unconfigured");
    expect(page().getByTestId("configured").textContent).toBe("false");
    expect(page().getByTestId("address").textContent).toBe(
      "private-details-hidden",
    );
    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    expect(page().getByTestId("status").textContent).toBe("signed-out");
  });

  test("wipes presentation balance cache but preserves unacknowledged provider evidence on sign-out", async () => {
    window.localStorage.setItem("home.balances.v1:subject-a:0x1111:US", "{}");
    window.localStorage.setItem("home.balances.v1:other", "{}");
    window.localStorage.setItem("home.country.v1", "US");
    const journalAction = preparedMoneyAction("cdp-embedded", "2026-12-08T05:20:00.000Z");
    const journal = new ProviderHandleJournal({
      storage: window.localStorage,
      lock: new TestJournalLock(),
    });
    const captured = journal.retain(journalAction, {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${"9".repeat(64)}`,
    });
    expect((await journal.persist(captured.entry!)).persisted).toBe(true);
    const journalKey = Object.keys(window.localStorage).find((key) =>
      key.startsWith("home:money-action-provider-handle:v1:"),
    );
    expect(journalKey).toBeDefined();

    render(
      <SessionHarness
        sdk={baseSdk()}
        sessionFetch={async () => sessionResponse(sessionFor("subject-a", ADDRESS_A))}
      />,
    );
    await waitFor(() =>
      expect(page().getByTestId("address").textContent).toBe(ADDRESS_A),
    );

    fireEvent.click(page().getByRole("button", { name: "Probe sign out" }));
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("signed-out"),
    );
    expect(
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("home.balances.v1:"),
      ),
    ).toEqual([]);
    expect(window.localStorage.getItem("home.country.v1")).toBe("US");
    expect(window.localStorage.getItem(journalKey!)).not.toBeNull();
  });

  test("keeps a configured-but-down provider distinct from missing project ID", () => {
    const unconfigured = createBlockedAccountWalletClient("unconfigured");
    const providerDown = createBlockedAccountWalletClient(
      "provider-unavailable",
    );

    expect(unconfigured.projectConfigured).toBe(false);
    expect(unconfigured.signInAvailability).toBe("unconfigured");
    expect(unconfigured.message).toBeNull();
    expect(providerDown.projectConfigured).toBe(true);
    expect(providerDown.signInAvailability).toBe("provider-unavailable");
    expect(providerDown.message).toContain("Try again later");
    expect(providerDown.message).not.toContain("NEXT_PUBLIC_CDP_PROJECT_ID");
  });
});
