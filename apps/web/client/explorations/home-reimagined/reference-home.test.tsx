import "@/client/account/dom-test-harness";
import { afterEach, describe, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import { ReferenceHome, type HomeTreatment } from "./reference-home";
import { reimaginedFundedState, reimaginedLongLocalizedState } from "./fixtures";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
afterEach(cleanup);

function text() { return document.body.textContent ?? ""; }

describe.each([undefined, "A", "B", "C"] as const)("Funded Home treatment %s (undefined is baseline)", (treatment: HomeTreatment | undefined) => {
  test("separates net, available cash and savings using the existing exact presenter", () => {
    render(<ReferenceHome treatment={treatment} />);
    expect(page().getByRole("region", { name: "Net position" }).textContent).toContain("$1,250.00");
    expect(page().getByRole("region", { name: "Available cash and funding" }).textContent).toContain("$250.00");
    expect(page().getByRole("region", { name: "Save" }).textContent).toContain("$1,000.00");
    expect(text()).toContain("Combined 4.04% APY");
    expect(text()).toContain("No debt");
    expect([...document.querySelectorAll("main button")]).toHaveLength(5);
    expect(page().getByRole("button", { name: "Fund" })).toBeDefined();
    expect(page().getByRole("button", { name: "Save $1,000.00 Combined 4.04% APY" })).toBeDefined();
    expect(page().getByRole("button", { name: "Buy" })).toBeDefined();
    expect(page().getByRole("button", { name: "Sell" })).toBeDefined();
    expect(page().getByRole("button", { name: "Borrow" })).toBeDefined();
    expect(page().queryByRole("button", { name: /^Open / })).toBeNull();
  });

  test("Save and Borrow each expose one labeled full-row control, with the visible row content inside it", async () => {
    render(<ReferenceHome treatment={treatment} />);
    const saveButton = page().getByRole("button", { name: "Save $1,000.00 Combined 4.04% APY" });
    expect(saveButton.textContent).toContain("$1,000.00");
    expect(saveButton.textContent).toContain("Combined 4.04% APY");
    expect(page().getByRole("region", { name: "Save" }).querySelectorAll("button")).toHaveLength(1);
    expect(page().getByRole("region", { name: "Borrow" }).querySelectorAll("button")).toHaveLength(1);
    expect(page().getByRole("region", { name: "Borrow" }).textContent).toContain("Borrow");
    expect(page().queryByRole("heading", { name: "Save" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Borrow" })).toBeNull();

    fireEvent.click(page().getByText("$1,000.00"));
    await page().findByRole("dialog");
    expect(text()).toContain("Save · composition preview");
    fireEvent.click(page().getByRole("button", { name: "Back to Home" }));

    fireEvent.click(page().getByRole("button", { name: "Borrow" }));
    await page().findByRole("dialog");
    expect(text()).toContain("Borrow · composition preview");
  });

  test("Activity navigation moves focus to the Activity heading", () => {
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    try {
      render(<ReferenceHome treatment={treatment} />);
      fireEvent.click(page().getByRole("button", { name: "Activity" }));
      expect(document.activeElement).toBe(page().getByRole("heading", { name: "Activity" }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("preserves the fixed plain-transfer history instead of claiming a savings deposit", () => {
    render(<ReferenceHome treatment={treatment} />);
    const rows = [...page().getByRole("region", { name: "Activity" }).querySelectorAll("li")];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("+250.00 USDC");
    expect(rows[1]?.textContent).toContain("Sent USDC");
    expect(rows[1]?.getAttribute("aria-label")).toContain("To 0x3333");
    expect(rows[2]?.textContent).toContain("+1,000.00 USDC");
    expect(text()).not.toContain("Deposited");
  });

  test.each(["Fund", "Save $1,000.00 Combined 4.04% APY", "Buy", "Sell", "Borrow", "Account"])("%s is an explicit fixture-only modal handoff, never a money mutation", async (name) => {
    const initialState = reimaginedFundedState();
    const before = JSON.stringify(initialState);
    render(<ReferenceHome treatment={treatment} initialState={initialState} />);
    fireEvent.click(page().getByRole("button", { name }));
    await page().findByRole("dialog");
    expect(text()).toContain("Fixture only. No money moves.");
    expect(text()).toContain("composition preview");
    expect(JSON.stringify(initialState)).toBe(before);
    const dialog = page().getByRole("dialog");
    fireEvent.click(dialog.querySelector("button")!);
    expect(text()).toContain("$1,250.00");
  });

  test("embedded comparison retains facts and controls without duplicate app landmarks", () => {
    const individual = render(<ReferenceHome treatment={treatment} />);
    const expectedText = text();
    individual.unmount();
    render(<ReferenceHome embedded treatment={treatment} />);
    expect(text()).toBe(expectedText);
    expect(page().queryByRole("main")).toBeNull();
    expect(page().queryByRole("navigation")).toBeNull();
    expect(page().queryByRole("region")).toBeNull();
    expect(page().getByRole("group", { name: "Net position" }).textContent).toContain("$1,250.00");
    expect(page().getByRole("button", { name: "Fund" })).toBeDefined();
  });

  test("large amounts retain precision and unquoted holding exclusions", () => {
    render(<ReferenceHome treatment={treatment} initialState={reimaginedLongLocalizedState()} />);
    expect(text()).toContain("$1,234,567.89");
    expect(text()).toContain("IDR");
    expect(text()).toContain("IDR balance is not included until a display quote is configured.");
  });
});
