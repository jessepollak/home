import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import { FieldError, FieldTitle } from "./field";
import { RadioGroup, RadioGroupOption } from "./radio-group";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

function TestGroup({ disabled = false, groupDisabled = false, error = false, onValueChange }: { disabled?: boolean; groupDisabled?: boolean; error?: boolean; onValueChange?: (value: string) => void }) {
  return (
    <div>
      <FieldTitle id="payment-method-title">Payment method</FieldTitle>
      <RadioGroup aria-labelledby="payment-method-title" aria-describedby={error ? "payment-method-error" : undefined} defaultValue="bank" disabled={groupDisabled} aria-invalid={error || undefined} onValueChange={onValueChange}>
        {[
          { id: "bank", label: "Bank transfer" },
          { id: "card", label: "Card" },
          { id: "cash", label: "Cash" },
        ].map(({ id, label }) => (
          <RadioGroupOption key={id} value={id} label={label} disabled={disabled && id === "card"} invalid={error} />
        ))}
      </RadioGroup>
      {error ? <FieldError id="payment-method-error">Choose a method.</FieldError> : null}
    </div>
  );
}

describe("RadioGroup", () => {
  test("has a named group and a single initial selection", () => {
    render(<TestGroup />);
    expect(page().getByRole("radiogroup", { name: "Payment method" })).toBeTruthy();
    expect(page().getByRole("radio", { name: "Bank transfer" }).getAttribute("aria-checked")).toBe("true");
    expect(page().getByRole("radio", { name: "Card" }).getAttribute("aria-checked")).toBe("false");
  });

  test("focus alone does not change the value; arrow keys move selection and disabled options are skipped", async () => {
    const onValueChange = mock(() => {});
    render(<TestGroup disabled onValueChange={onValueChange} />);
    const bank = page().getByRole("radio", { name: "Bank transfer" });
    const cash = page().getByRole("radio", { name: "Cash" });
    act(() => { bank.focus(); cash.focus(); });
    expect(cash.getAttribute("aria-checked")).toBe("false");
    expect(onValueChange).not.toHaveBeenCalled();
    act(() => { bank.focus(); });
    fireEvent.keyDown(bank, { key: "ArrowDown" });
    await waitFor(() => expect(cash.getAttribute("aria-checked")).toBe("true"));
    expect(page().getByRole("radio", { name: "Card" }).getAttribute("aria-checked")).toBe("false");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("cash", expect.anything());
    fireEvent.click(page().getByText("Card"));
    expect(cash.getAttribute("aria-checked")).toBe("true");
  });

  test("a disabled group does not allow selection", () => {
    const onValueChange = mock(() => {});
    render(<TestGroup groupDisabled onValueChange={onValueChange} />);
    fireEvent.click(page().getByText("Cash"));
    expect(page().getByRole("radio", { name: "Bank transfer" }).getAttribute("aria-checked")).toBe("true");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test("a label click selects an option and reports invalid state", () => {
    render(<TestGroup error />);
    expect(page().getByRole("radiogroup", { name: "Payment method" }).getAttribute("aria-invalid")).toBe("true");
    expect(page().getByRole("radiogroup", { name: "Payment method" }).getAttribute("aria-describedby")).toBe("payment-method-error");
    expect(page().getByRole("radio", { name: "Card" }).getAttribute("aria-invalid")).toBe("true");
    expect(page().getByRole("alert").textContent).toBe("Choose a method.");
    fireEvent.click(page().getByText("Card"));
    expect(page().getByRole("radio", { name: "Card" }).getAttribute("aria-checked")).toBe("true");
  });

  test("names an option by its label and describes it with its description", () => {
    render(
      <RadioGroup aria-label="Payment method" defaultValue="bank">
        <RadioGroupOption value="bank" label="Bank transfer" description="Available today" />
      </RadioGroup>,
    );
    const radio = page().getByRole("radio", { name: "Bank transfer" });
    const describedBy = radio.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("Available today");
    fireEvent.click(page().getByText("Available today"));
    expect(radio.getAttribute("aria-checked")).toBe("true");
  });
});
