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
    { value: "none", label: "Not integrated" },
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

    fireEvent.change(view.getByRole("combobox", { name: "1:1 onramp" }), {
      target: { value: "documented" },
    });

    expect(submissions).toEqual([{ q: "yen", issuer: "documented", home: "live", sort: "gdp" }]);
    expect(view.container.querySelector("form")?.getAttribute("method")).not.toBe("post");
    expect(view.container.querySelector("form")?.getAttribute("action")).toBe("/coverage");
  });

  test("syncs uncontrolled controls without replacing or blurring a focused select", () => {
    const view = render(<CoverageFilters {...props} values={{ q: "yen", issuer: "documented", home: "live", sort: "alphabetical" }} />);
    const search = view.getByRole("textbox", { name: "Search" });
    const issuer = view.getByRole("combobox", { name: "1:1 onramp" }) as HTMLSelectElement;
    expect((search as HTMLInputElement).value).toBe("yen");
    expect(issuer.value).toBe("documented");

    fireEvent.change(issuer, { target: { value: "conditional" } });
    issuer.focus();
    view.rerender(<CoverageFilters {...props} values={{ q: "peso", issuer: "conditional", home: "none", sort: "gdp" }} />);

    expect(view.getByRole("combobox", { name: "1:1 onramp" })).toBe(issuer);
    expect(document.activeElement).toBe(issuer);
    expect(issuer.value).toBe("conditional");
    expect((search as HTMLInputElement).value).toBe("peso");
    expect((view.getByRole("combobox", { name: "Integrated" }) as HTMLSelectElement).value).toBe("none");
    expect((view.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value).toBe("gdp");
  });

  test("does not overwrite a blurred search while its debounce is pending", () => {
    jest.useFakeTimers();
    const view = render(<CoverageFilters {...props} values={{ ...props.values, q: "old" }} />);
    const search = view.getByRole("textbox", { name: "Search" }) as HTMLInputElement;

    fireEvent.input(search, { target: { value: "new" } });
    search.blur();
    view.rerender(<CoverageFilters {...props} values={{ ...props.values, q: "stale" }} />);

    expect(search.value).toBe("new");
    jest.advanceTimersByTime(250);
    expect(submissions).toEqual([{ q: "new", issuer: "", home: "", sort: "gdp" }]);
  });

  test("popstate cancels pending search and synchronizes every control from the URL", () => {
    jest.useFakeTimers();
    const view = render(<CoverageFilters {...props} />);
    const search = view.getByRole("textbox", { name: "Search" }) as HTMLInputElement;

    fireEvent.input(search, { target: { value: "pending" } });
    window.history.pushState({}, "", "/coverage?q=back&issuer=conditional&home=none&sort=alphabetical");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(search.value).toBe("back");
    expect((view.getByRole("combobox", { name: "1:1 onramp" }) as HTMLSelectElement).value).toBe("conditional");
    expect((view.getByRole("combobox", { name: "Integrated" }) as HTMLSelectElement).value).toBe("none");
    expect((view.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value).toBe("alphabetical");
    jest.advanceTimersByTime(250);
    expect(submissions).toHaveLength(0);

    window.history.pushState({}, "", "/coverage?issuer=bogus&home=bogus&sort=bogus");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect((view.getByRole("combobox", { name: "1:1 onramp" }) as HTMLSelectElement).value).toBe("");
    expect((view.getByRole("combobox", { name: "Integrated" }) as HTMLSelectElement).value).toBe("");
    expect((view.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value).toBe("gdp");
  });
});
