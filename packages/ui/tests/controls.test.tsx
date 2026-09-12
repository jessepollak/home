import "./dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createRef } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bleed, Button, Field, Heading, IconButton, Inline, Input, Inset, Select, Stack, Text, haptic } from "@home/ui";
import { PlusIcon } from "@home/ui/icons";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "vibrate");
});

const page = () => within(document.body);

describe("native controls", () => {
  test("defaults to button, forwards native form props, events, and React 19 ref", () => {
    const ref = createRef<HTMLButtonElement>();
    const click = mock(() => {});
    render(<Button ref={ref} name="example" value="one" form="example-form" title="Native title" onClick={click}>Continue</Button>);
    const button = page().getByRole("button", { name: "Continue" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("form")).toBe("example-form");
    expect(button.getAttribute("name")).toBe("example");
    expect(button.getAttribute("value")).toBe("one");
    expect(button.getAttribute("title")).toBe("Native title");
    expect(ref.current).toBe(button as HTMLButtonElement);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("does not erase explicit submit/reset types or native ARIA", () => {
    render(<><Button type="submit" formNoValidate aria-describedby="help">Submit</Button><Button type="reset" aria-pressed="true">Reset</Button></>);
    expect(page().getByText("Submit").closest("button")?.getAttribute("type")).toBe("submit");
    expect(page().getByRole("button", { name: "Submit" }).hasAttribute("formnovalidate")).toBe(true);
    expect(page().getByRole("button", { name: "Submit" }).getAttribute("aria-describedby")).toBe("help");
    expect(page().getByRole("button", { name: "Reset", pressed: true }).getAttribute("type")).toBe("reset");
  });

  for (const mode of ["disabled", "loading"] as const) {
    test(`${mode} blocks activation while keeping the accessible name`, () => {
      const click = mock(() => {});
      const { rerender } = render(<Button {...{ [mode]: true }} onClick={click}>Continue</Button>);
      const button = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      button.click();
      expect(click).not.toHaveBeenCalled();
      if (mode === "loading") {
        expect(button.getAttribute("aria-busy")).toBe("true");
        expect(button.querySelector(".home-ui-button__spinner")?.getAttribute("aria-hidden")).toBe("true");
      }
      rerender(<Button onClick={click}>Continue</Button>);
      fireEvent.click(button);
      expect(click).toHaveBeenCalledTimes(1);
      expect(button.getAttribute("aria-busy")).toBeNull();
    });
  }

  test("icon buttons have a required action name, native ref and decorative 20/24px art", () => {
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(<IconButton ref={ref} icon={PlusIcon} aria-label="Add example" />);
    const button = page().getByRole("button", { name: "Add example" });
    const svg = button.querySelector("svg")!;
    expect(ref.current).toBe(button as HTMLButtonElement);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.querySelector("title")).toBeNull();
    expect(page().queryByRole("img")).toBeNull();
    rerender(<IconButton icon={PlusIcon} iconSize={24} aria-label="Add example" disabled />);
    expect(button.querySelector("svg")?.getAttribute("width")).toBe("24");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  test("input and select forward native props, refs, events, and adornment slots", () => {
    const inputRef = createRef<HTMLInputElement>();
    const selectRef = createRef<HTMLSelectElement>();
    const inputChange = mock(() => {});
    const selectChange = mock(() => {});
    render(<>
      <Input ref={inputRef} name="amount" inputMode="decimal" prefix="$" suffix={<button type="button">Clear</button>} onInput={inputChange} />
      <Select ref={selectRef} name="country" defaultValue="US" prefix="Region" suffix="⌄" onChange={selectChange}>
        <option value="US">United States</option>
        <option value="GB">United Kingdom</option>
      </Select>
    </>);
    const input = page().getByRole("textbox") as HTMLInputElement;
    const select = page().getByRole("combobox") as HTMLSelectElement;
    expect(inputRef.current).toBe(input);
    expect(selectRef.current).toBe(select);
    expect(input.name).toBe("amount");
    expect(input.inputMode).toBe("decimal");
    expect(select.name).toBe("country");
    expect(page().getByText("$").classList.contains("home-ui-control__prefix")).toBe(true);
    expect(page().getByRole("button", { name: "Clear" })).not.toBeNull();
    fireEvent.input(input, { target: { value: "12" } });
    fireEvent.change(select, { target: { value: "GB" } });
    expect(inputChange).toHaveBeenCalledTimes(1);
    expect(selectChange).toHaveBeenCalledTimes(1);
  });

  test("field wires labels, required state, help, errors, existing descriptions, and its action slot", () => {
    render(
      <Field
        label="Wallet address"
        htmlFor="wallet"
        hint="Base address"
        error="Enter a valid address"
        required
        action={<button type="button">Paste</button>}
      >
        <Input id="wallet" aria-describedby="external-help" />
      </Field>,
    );
    const input = page().getByRole("textbox", { name: /Wallet address/ }) as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("external-help wallet-hint wallet-error");
    expect(page().getByText("Base address").id).toBe("wallet-hint");
    expect(page().getByRole("alert").id).toBe("wallet-error");
    expect(page().getByRole("button", { name: "Paste" }).parentElement?.classList.contains("home-ui-field__action")).toBe(true);
  });

  test("blank labels fail rather than rendering an unnamed icon control", () => {
    expect(() => renderToStaticMarkup(<IconButton icon={PlusIcon} aria-label=" " />)).toThrow("non-empty aria-label");
  });

  test("haptic feedback is explicit and canceled actions stay silent", () => {
    const vibrate = mock(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    render(<>
      <Button>Regular</Button>
      <Button hapticFeedback="selection">Confirm</Button>
      <Button hapticFeedback="error" onClick={(event) => event.preventDefault()}>Canceled</Button>
    </>);
    fireEvent.click(page().getByRole("button", { name: "Regular" }));
    expect(vibrate).not.toHaveBeenCalled();
    fireEvent.click(page().getByRole("button", { name: "Confirm" }));
    expect(vibrate).toHaveBeenCalledWith(10);
    fireEvent.click(page().getByRole("button", { name: "Canceled" }));
    expect(vibrate).toHaveBeenCalledTimes(1);
    haptic("success");
    haptic("error");
    expect(vibrate).toHaveBeenNthCalledWith(2, [10, 30, 20]);
    expect(vibrate).toHaveBeenNthCalledWith(3, [20, 30, 20, 30, 20]);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    expect(haptic("selection")).toBe(false);
  });
});

test("visual roles never decide semantic elements or heading levels", () => {
  render(<><Heading level={3} textStyle="body" id="details">Details</Heading><Text as="span" textStyle="page-title">Not a heading</Text><Text as="strong" textStyle="secondary">Important</Text></>);
  expect(page().getByRole("heading", { level: 3 }).getAttribute("data-text-style")).toBe("body");
  expect(page().getByText("Not a heading").tagName).toBe("SPAN");
  expect(page().getByText("Important").tagName).toBe("STRONG");
  expect(page().getAllByRole("heading")).toHaveLength(1);
});

test("layout primitives forward native props and own token or custom spacing", () => {
  const ref = createRef<HTMLDivElement>();
  const { container } = render(
    <Stack ref={ref} id="stack" className="example" space="2">
      <Inline space="0"><Text>Inline</Text></Inline>
      <Inset space="6"><Bleed space={{ custom: "18px" }}>Bleed</Bleed></Inset>
    </Stack>,
  );
  const stack = container.querySelector("#stack") as HTMLDivElement;
  expect(ref.current).toBe(stack);
  expect(stack.className).toContain("home-ui-stack");
  expect(stack.className).toContain("example");
  expect(stack.getAttribute("data-space")).toBe("2");
  expect(stack.style.getPropertyValue("--home-ui-layout-space")).toBe("var(--home-ui-space-2)");
  expect(container.querySelector(".home-ui-inline")?.getAttribute("data-space")).toBe("0");
  expect(container.querySelector(".home-ui-inset")?.getAttribute("data-space")).toBe("6");
  const bleed = container.querySelector(".home-ui-bleed") as HTMLDivElement;
  expect(bleed.getAttribute("data-space")).toBe("custom");
  expect(bleed.style.getPropertyValue("--home-ui-layout-space")).toBe("18px");
});

test("all core exports render to static HTML without a provider", () => {
  const html = renderToStaticMarkup(<><Heading level={2}>Server heading</Heading><Text textStyle="amount">€1.234.567,89</Text><Button loading>Keep name</Button><IconButton icon={PlusIcon} aria-label="Add example" /><Field label="Email" htmlFor="email" hint="Work email"><Input id="email" type="email" /></Field><Select aria-label="Country"><option>United States</option></Select><Stack><Inline><Inset><Bleed>Layout</Bleed></Inset></Inline></Stack></>);
  expect(html).toContain("<h2");
  expect(html).toContain("€1.234.567,89");
  expect(html).toContain('aria-label="Add example"');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain("<style");
  expect(html).not.toContain("<link");
});
