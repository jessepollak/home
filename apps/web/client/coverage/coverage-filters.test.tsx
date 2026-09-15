import "@/client/account/dom-test-harness";

import { afterAll, afterEach, describe, expect, jest, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { CoverageFilters } = await import("./coverage-filters");

const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
const submissions: Record<string, string>[] = [];

HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
  submissions.push(Object.fromEntries(new FormData(this)) as Record<string, string>);
};

const props = {
  values: { q: "", issuer: "", home: "", sort: "gdp" },
  issuerOptions: [
    { value: "documented", label: "Documented" },
    { value: "conditional", label: "Conditional" },
  ],
  homeOptions: [
    { value: "none", label: "No Home route" },
    { value: "live", label: "Live" },
  ],
};

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  submissions.length = 0;
});

afterAll(() => {
  HTMLFormElement.prototype.requestSubmit = nativeRequestSubmit;
});

describe("CoverageFilters", () => {
  test("debounces search GET submission and has no manual Apply or Reset controls", () => {
    jest.useFakeTimers();
    const view = render(<CoverageFilters {...props} />);
    const search = view.getByRole("textbox", { name: "Search" });

    fireEvent.input(search, { target: { value: "ind" } });
    expect(submissions).toHaveLength(0);
    jest.advanceTimersByTime(150);
    fireEvent.input(search, { target: { value: "india" } });
    jest.advanceTimersByTime(249);
    expect(submissions).toHaveLength(0);
    jest.advanceTimersByTime(1);

    expect(submissions).toEqual([{ q: "india", issuer: "", home: "", sort: "gdp" }]);
    expect(view.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(view.queryByRole("link", { name: "Reset" })).toBeNull();
  });

  test("submits select changes immediately with the complete URL-addressable query", () => {
    const view = render(<CoverageFilters {...props} values={{ q: "yen", issuer: "", home: "live", sort: "gdp" }} />);

    fireEvent.change(view.getByRole("combobox", { name: "Issuer route" }), {
      target: { value: "documented" },
    });

    expect(submissions).toEqual([{ q: "yen", issuer: "documented", home: "live", sort: "gdp" }]);
    expect(view.container.querySelector("form")?.getAttribute("method")).toBe("get");
    expect(view.container.querySelector("form")?.getAttribute("action")).toBe("/coverage");
  });
});
