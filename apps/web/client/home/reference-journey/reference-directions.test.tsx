import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import {
  referenceActivity,
  referenceDebtPosition,
  referenceFundedPosition,
  referenceLoadingPosition,
  referenceUnavailableCashPosition,
  referenceUnavailableSavedPosition,
} from "./reference-fixtures";
import { presentReferencePosition, type ReferenceMoneyPosition } from "./reference-position";
import type { ReferenceDirectionId } from "./reference-directions-surface";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ReferenceDirectionsSurface } = await import("./reference-directions-surface");
const { ReferenceWorkspaceSave, ReferenceStatementSave } = await import(
  "./reference-directions-save"
);

const [STEAKHOUSE] = MORPHO_V1_CANDIDATE_ADDRESSES;
const DIRECTIONS: readonly ReferenceDirectionId[] = ["overview", "statement", "workspace"];

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

function text(): string {
  return document.body.textContent ?? "";
}

function navigation() {
  return page().getByRole("navigation", { name: "Main navigation" });
}

/**
 * Base UI leaves an activated tab panel mounted but inert instead of removing it, so
 * resolve each panel through its tab's `aria-controls` and assert inside that panel.
 */
function tabPanel(tab: HTMLElement): HTMLElement {
  const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
  expect(panel).not.toBeNull();
  return panel!;
}

function renderDirections(input: {
  direction: ReferenceDirectionId;
  initialSurface?: "home" | "save";
  position?: ReferenceMoneyPosition;
  reducedMotion?: boolean;
  onIntent?: (intent: string) => void;
}) {
  return render(
    <ReferenceDirectionsSurface
      direction={input.direction}
      initialSurface={input.initialSurface ?? "home"}
      position={input.position ?? referenceFundedPosition}
      activity={referenceActivity()}
      reducedMotion={input.reducedMotion}
      onIntent={input.onIntent}
    />,
  );
}

describe("reference direction examples", () => {
  for (const direction of DIRECTIONS) {
    test(`${direction} Home presents the same funded facts`, () => {
      renderDirections({ direction });

      expect(text()).toContain("Net position");
      expect(text()).toContain("$1,250.00");
      expect(text()).toContain("$250.00");
      expect(text()).toContain("$1,000.00");
      expect(text()).toContain("4.04% APY");
      // The reference hero must not repeat the available cash as a second hero line.
      expect(page().queryByText("Available to use $250.00")).toBeNull();
      expect(page().queryAllByRole("img", { name: "$1,250.00" })).toHaveLength(1);
    });

    test(`${direction} Home keeps a loading position from claiming values`, () => {
      renderDirections({ direction, position: referenceLoadingPosition });

      expect(text()).toContain("Net position");
      expect(text()).not.toContain("$1,250.00");
      expect(text()).not.toContain("$0.00");
    });
  }

  test("overview Home states cash once and keeps vault detail out of Home", () => {
    renderDirections({ direction: "overview" });

    expect(page().queryAllByRole("img", { name: "$250.00" })).toHaveLength(1);
    expect(page().queryByText("Gauntlet USDC Prime")).toBeNull();
    expect(page().queryByText("Re7 USDC")).toBeNull();
    expect(page().queryByText(/Borrow/)).toBeNull();
    expect(page().queryByText("Cash out")).toBeNull();
    expect(page().getByRole("button", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Send" })).toBeTruthy();
  });

  test("overview Home routes its actions through the shared intent contract", () => {
    const intents: string[] = [];
    renderDirections({ direction: "overview", onIntent: (intent) => intents.push(intent) });

    fireEvent.click(page().getByRole("button", { name: "Add money" }));
    fireEvent.click(page().getByRole("button", { name: "Send" }));

    expect(intents).toEqual(["add-money", "send"]);
  });

  test("both surfaces keep the production navigation context with Home active", () => {
    renderDirections({ direction: "overview" });

    const nav = navigation();
    expect(within(nav).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("button", { name: "Invest" }).getAttribute("aria-current")).toBeNull();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Open Save" }));

    expect(text()).toContain("Saved");
    expect(within(nav).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(text()).toContain("Net position");
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
  });

  test("overview Home opens the paired Save workspace on the same facts", () => {
    renderDirections({ direction: "overview" });

    fireEvent.click(page().getByRole("button", { name: "Open Save" }));

    expect(text()).toContain("Your vault");
    expect(text()).toContain("$1,000.00");
    expect(text()).toContain("Earning ~4.04%");
    expect(text()).toContain("4.10% APY");
    expect(page().getByRole("combobox", { name: "Vault" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Deposit to Gauntlet USDC Prime" })).toBeTruthy();
  });

  test("statement Home discloses cash and saved rows in place", () => {
    renderDirections({ direction: "statement" });

    const cashToggle = page().getByRole("button", { name: "Cash details" });
    const cashPanelId = cashToggle.getAttribute("aria-controls");
    expect(cashToggle.getAttribute("aria-expanded")).toBe("true");
    const cashPanel = document.getElementById(cashPanelId ?? "");
    expect(cashPanel?.hidden).toBe(false);
    expect(cashPanel?.contains(page().getByRole("button", { name: "Add money" }))).toBe(true);
    expect(cashPanel?.contains(page().getByRole("button", { name: "Send" }))).toBe(true);
    expect(cashPanel?.textContent).toContain("$250.00");

    const saveToggle = page().getByRole("button", { name: "Save details" });
    expect(saveToggle.getAttribute("aria-expanded")).toBe("false");
    const savePanel = document.getElementById(saveToggle.getAttribute("aria-controls") ?? "");
    expect(savePanel?.hidden).toBe(true);

    fireEvent.click(saveToggle);
    expect(saveToggle.getAttribute("aria-expanded")).toBe("true");
    expect(savePanel?.hidden).toBe(false);
    expect(page().getByRole("button", { name: /Open Gauntlet USDC Prime in Save/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Open Re7 USDC in Save/ })).toBeNull();

    // Collapsing the cash row takes its scoped actions with it.
    fireEvent.click(cashToggle);
    expect(cashToggle.getAttribute("aria-expanded")).toBe("false");
    expect(page().queryByRole("button", { name: "Add money" })).toBeNull();
  });

  test("tabbed Home keeps money facts behind the Money tab and Activity as a destination", () => {
    renderDirections({ direction: "workspace" });

    const moneyTab = page().getByRole("tab", { name: "Money" });
    const activityTab = page().getByRole("tab", { name: "Activity" });
    const moneyPanel = tabPanel(moneyTab);
    expect(moneyTab.getAttribute("aria-selected")).toBe("true");
    expect(within(moneyPanel).getByRole("button", { name: "Add money" })).toBeTruthy();
    expect(within(moneyPanel).queryByText("Gauntlet USDC Prime")).toBeNull();

    fireEvent.click(activityTab);

    const activityPanel = tabPanel(activityTab);
    expect(activityTab.getAttribute("aria-selected")).toBe("true");
    expect(
      within(activityPanel).getAllByRole("button", { name: /^Received / }).length,
    ).toBeGreaterThan(0);
    expect(within(activityPanel).queryByRole("button", { name: "Add money" })).toBeNull();
  });

  test("overview Save keeps one selected-vault workspace with scoped actions", () => {
    renderDirections({ direction: "overview", initialSurface: "save" });

    expect(text()).toContain("Gauntlet USDC Prime");
    expect(text()).toContain("4.10% APY");
    expect(text()).toContain("$750.00");
    expect(page().queryByRole("button", { name: "Deposit to Steakhouse USDC" })).toBeNull();

    const details = page().getByRole("button", { name: "Vault details" });
    const detailsPanel = document.getElementById("reference-workspace-vault-details");
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(detailsPanel?.hidden).toBe(true);

    // The scoped actions are visible in normal flow while the detail disclosure is closed.
    expect(page().getByRole("button", { name: "Deposit to Gauntlet USDC Prime" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Withdraw from Gauntlet USDC Prime" })).toBeTruthy();

    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(detailsPanel?.hidden).toBe(false);
    expect(detailsPanel?.textContent).toContain("Fee");
    expect(detailsPanel?.textContent).toContain("Curator");
    expect(detailsPanel?.textContent).toContain("10.00%");
    expect(page().getByRole("button", { name: "Deposit to Gauntlet USDC Prime" })).toBeTruthy();
  });

  test("overview Save follows the selected vault for its facts and action labels", () => {
    render(
      <ReferenceWorkspaceSave
        position={presentReferencePosition(referenceFundedPosition)}
        selectedVaultAddress={STEAKHOUSE}
        onSelectVault={() => {}}
      />,
    );

    expect(page().getByRole("combobox", { name: "Vault" }).textContent).toContain(
      "Change vault",
    );
    expect(text()).toContain("3.85% APY");
    expect(text()).toContain("$250.00");
    expect(page().getByRole("button", { name: "Deposit to Steakhouse USDC" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Withdraw from Steakhouse USDC" })).toBeTruthy();
  });

  test("statement Save moves the scoped actions to the disclosed vault", () => {
    renderDirections({ direction: "statement", initialSurface: "save" });

    const gauntletRow = page().getByRole("button", { name: "Gauntlet USDC Prime details" });
    expect(gauntletRow.getAttribute("aria-expanded")).toBe("true");
    expect(page().getByRole("button", { name: "Deposit to Gauntlet USDC Prime" })).toBeTruthy();

    const re7Row = page().getByRole("button", { name: "Re7 USDC details" });
    expect(re7Row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(re7Row);

    expect(re7Row.getAttribute("aria-expanded")).toBe("true");
    expect(gauntletRow.getAttribute("aria-expanded")).toBe("false");
    expect(page().queryByRole("button", { name: "Deposit to Gauntlet USDC Prime" })).toBeNull();
    expect(page().getByRole("button", { name: "Deposit to Re7 USDC" })).toBeTruthy();
    expect(
      (page().getByRole("button", { name: "Withdraw from Re7 USDC" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("statement Save keeps a withdrawn-vault selection closing its actions", () => {
    render(
      <ReferenceStatementSave
        position={presentReferencePosition(referenceUnavailableSavedPosition)}
        selectedVaultAddress={null}
        onSelectVault={() => {}}
      />,
    );

    expect(text()).toContain("Saved balance unavailable");
    expect(page().queryByRole("button", { name: /^Deposit/ })).toBeNull();
    expect(text()).not.toContain("$0.00");
  });

  test("tabbed Save keeps one selected target and a reachable all-vaults tab", () => {
    renderDirections({ direction: "workspace", initialSurface: "save" });

    const savingsTab = page().getByRole("tab", { name: "Your savings" });
    const allVaultsTab = page().getByRole("tab", { name: "All vaults" });
    const savingsPanel = tabPanel(savingsTab);
    expect(within(savingsPanel).getByText(/Selected · Gauntlet USDC Prime/)).toBeTruthy();
    expect(within(savingsPanel).queryByRole("radio", { name: /Re7 USDC/ })).toBeNull();
    expect(
      within(savingsPanel).getByRole("button", { name: "Deposit to Gauntlet USDC Prime" }),
    ).toBeTruthy();

    fireEvent.click(allVaultsTab);

    const allVaultsPanel = tabPanel(allVaultsTab);
    const re7Radio = within(allVaultsPanel).getByRole("radio", { name: /Re7 USDC/ });
    fireEvent.click(re7Radio);

    fireEvent.click(savingsTab);

    const reopenedSavings = tabPanel(savingsTab);
    expect(within(reopenedSavings).getByText(/Selected · Re7 USDC/)).toBeTruthy();
    expect(within(reopenedSavings).queryByRole("radio", { name: /Re7 USDC/ })).toBeNull();
    expect(within(reopenedSavings).getByRole("button", { name: "Deposit to Re7 USDC" })).toBeTruthy();
    expect(
      (
        within(reopenedSavings).getByRole("button", {
          name: "Withdraw from Re7 USDC",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("keeps an unavailable cash slice named instead of zero", () => {
    renderDirections({ direction: "overview", position: referenceUnavailableCashPosition });

    expect(text()).toContain("Cash balance unavailable");
    expect(page().queryByText("$0.00")).toBeNull();
    expect(text()).not.toContain("$1,250.00");
  });

  test("keeps positive debt visible and deducted from the net position", () => {
    renderDirections({ direction: "overview", position: referenceDebtPosition });

    expect(text()).toContain("Debt −$500.00");
    expect(text()).toContain("$750.00");
    expect(text()).toContain("Assets $1,250.00");
  });

  test("keeps unavailable saved truthful on the paired Save surface", () => {
    renderDirections({
      direction: "overview",
      initialSurface: "save",
      position: referenceUnavailableSavedPosition,
    });

    expect(text()).toContain("Saved balance unavailable");
    expect(page().queryByText("$0.00")).toBeNull();
    expect(page().queryByRole("button", { name: /^Deposit/ })).toBeNull();
  });

  test("reduced-motion override leaves every money value unanimated", () => {
    renderDirections({ direction: "overview", reducedMotion: true });

    const tickers = [...document.querySelectorAll<HTMLElement>("[data-slot='money-ticker']")];
    expect(tickers.length).toBeGreaterThan(0);
    for (const ticker of tickers) {
      expect(ticker.getAttribute("data-animated")).toBe("false");
    }
  });
});
