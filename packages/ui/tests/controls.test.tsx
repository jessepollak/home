import "./dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createRef } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Heading, IconButton, Text } from "@home/ui";
import { PlusIcon } from "@home/ui/icons";

afterEach(cleanup);

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

  test("blank labels fail rather than rendering an unnamed icon control", () => {
    expect(() => renderToStaticMarkup(<IconButton icon={PlusIcon} aria-label=" " />)).toThrow("non-empty aria-label");
  });
});

test("visual roles never decide semantic elements or heading levels", () => {
  render(<><Heading level={3} textStyle="body" id="details">Details</Heading><Text as="span" textStyle="page-title">Not a heading</Text><Text as="strong" textStyle="secondary">Important</Text></>);
  expect(page().getByRole("heading", { level: 3 }).getAttribute("data-text-style")).toBe("body");
  expect(page().getByText("Not a heading").tagName).toBe("SPAN");
  expect(page().getByText("Important").tagName).toBe("STRONG");
  expect(page().getAllByRole("heading")).toHaveLength(1);
});

test("all core exports render to static HTML without a provider", () => {
  const html = renderToStaticMarkup(<><Heading level={2}>Server heading</Heading><Text textStyle="amount">€1.234.567,89</Text><Button loading>Keep name</Button><IconButton icon={PlusIcon} aria-label="Add example" /></>);
  expect(html).toContain("<h2");
  expect(html).toContain("€1.234.567,89");
  expect(html).toContain('aria-label="Add example"');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain("<style");
  expect(html).not.toContain("<link");
});
