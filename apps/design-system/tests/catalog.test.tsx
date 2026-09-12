import "./dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import Page from "../app/page";

afterEach(cleanup);

test("catalog renders real package exports and deterministic specimen controls", () => {
  const { container } = render(<Page />);
  const page = within(container);
  expect(page.getByRole("heading", { level: 1 }).textContent).toBe("Home UI foundation");
  expect(page.getByRole("heading", { level: 3, name: "A semantic h3 with body styling" }).getAttribute("data-text-style")).toBe("body");
  const button = page.getByRole("button", { name: "Primary" }) as HTMLButtonElement;
  expect(button.classList.contains("home-ui-button")).toBe(true);
  for (const role of ["amount", "row-value", "body"]) {
    const specimens = container.querySelectorAll(`[data-number-probe="${role}"] .home-ui-text`);
    expect(Array.from(specimens).map((sample) => sample.textContent)).toEqual(["111111", "888888", "000000"]);
    expect(Array.from(specimens).every((sample) => sample.getAttribute("data-text-style") === role)).toBe(true);
  }
  expect(container.querySelectorAll("[data-font-coverage]").length).toBe(3);
  expect(container.querySelector("[data-layout='stack']")?.classList.contains("home-ui-stack")).toBe(true);
  expect(container.querySelector("[data-layout='inline']")?.classList.contains("home-ui-inline")).toBe(true);
  expect(container.querySelector("[data-layout='inset']")?.classList.contains("home-ui-inset")).toBe(true);
  expect(container.querySelector("[data-layout='bleed']")?.classList.contains("home-ui-bleed")).toBe(true);
  expect(container.querySelector("[data-layout='custom']")?.getAttribute("data-space")).toBe("custom");
  const email = page.getByRole("textbox", { name: /Email address/ });
  const address = page.getByRole("textbox", { name: "Wallet address" });
  expect(email.getAttribute("aria-describedby")).toBe("catalog-email-hint");
  expect(email.hasAttribute("required")).toBe(true);
  expect(address.getAttribute("aria-invalid")).toBe("true");
  expect(address.getAttribute("aria-describedby")).toBe("catalog-address-error");
  expect(page.getByRole("combobox", { name: "Country" }).classList.contains("home-ui-select__control")).toBe(true);
  expect(page.getByRole("button", { name: "Paste" }).parentElement?.classList.contains("home-ui-field__action")).toBe(true);
  expect(container.querySelectorAll("[data-surface]")).toHaveLength(4);
  expect(container.querySelector("[data-surface='tinted-accent']")?.classList.contains("surface-tinted")).toBe(true);
  expect(container.querySelectorAll("[data-token]")).toHaveLength(19);
  expect(container.querySelectorAll("[data-token-kind='color']")).toHaveLength(11);
  expect(container.querySelectorAll("[data-token-kind='shadow']")).toHaveLength(2);
  expect(container.querySelectorAll("[data-token-kind='layer']")).toHaveLength(3);
  expect(container.querySelectorAll("[data-token-kind='easing']")).toHaveLength(3);
  const ticker = container.querySelector<HTMLElement>("[data-ticker-specimen]");
  expect(ticker?.getAttribute("aria-label")).toBe("$1,234.56");
  fireEvent.click(page.getByRole("button", { name: "Update balance ticker" }));
  expect(ticker?.getAttribute("aria-label")).toBe("$9,876.54");
  expect(page.getByRole("button", { name: "Confirm" }).hasAttribute("hapticfeedback")).toBe(false);
  const activationStatus = container.querySelector("output");
  fireEvent.click(button);
  expect(activationStatus?.textContent).toBe("Activations: 1");
  fireEvent.click(page.getByRole("checkbox", { name: "Disabled" }));
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(activationStatus?.textContent).toBe("Activations: 1");
  fireEvent.click(page.getByRole("checkbox", { name: "Disabled" }));
  fireEvent.click(page.getByRole("checkbox", { name: "Pressed" }));
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(page.getByRole("checkbox", { name: "Loading" }));
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.disabled).toBe(true);
  expect(page.getByRole("button", { name: "Add example" }).getAttribute("aria-busy")).toBe("true");
});

test("fallback, width, and 200% text are explicit and clean up on unmount", () => {
  const { container, unmount } = render(<Page />);
  const page = within(container);
  fireEvent.click(page.getByRole("checkbox", { name: "System font fallback" }));
  expect(container.querySelector("[data-font='fallback']")).not.toBeNull();
  fireEvent.change(page.getByRole("combobox", { name: "Specimen width" }), { target: { value: "320" } });
  expect(container.querySelector("[data-width='320']")).not.toBeNull();
  fireEvent.change(page.getByRole("combobox", { name: "Text size" }), { target: { value: "200" } });
  expect(document.documentElement.style.fontSize).toBe("200%");
  expect(page.getAllByText("$1,234,567,890.12").length).toBeGreaterThan(0);
  expect(container.querySelector("[data-ticker-specimen]")?.getAttribute("aria-label")).toBe("$1,234.56");
  expect(page.getByText("₹12,34,56,789.00")).not.toBeNull();
  unmount();
  expect(document.documentElement.style.fontSize).toBe("");
});
