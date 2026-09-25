import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { Progress } = await import("./progress");

afterEach(cleanup);

describe("Progress", () => {
  test("names a determinate count and announces the count rather than a percentage", () => {
    const view = render(<Progress label="Identity check" value={2} max={3} />);
    const progressbar = view.getByRole("progressbar", { name: "Identity check" });

    expect(progressbar.getAttribute("aria-valuenow")).toBe("2");
    expect(progressbar.getAttribute("aria-valuemin")).toBe("0");
    expect(progressbar.getAttribute("aria-valuemax")).toBe("3");
    expect(progressbar.getAttribute("aria-valuetext")).toBe("2 of 3");
    expect(view.getByText("2 of 3")).toBeTruthy();
  });

  test("fills the track in proportion to the count", () => {
    const view = render(<Progress label="Identity check" value={2} max={3} />);
    const indicator = view.container.querySelector<HTMLElement>("[data-slot='progress-indicator']");

    expect(Number.parseFloat(indicator?.style.width ?? "")).toBeCloseTo(66.67, 1);
  });

  test("marks progress complete when the count reaches max", () => {
    const view = render(<Progress label="Identity check" value={3} max={3} />);
    const progressbar = view.getByRole("progressbar", { name: "Identity check" });

    expect(progressbar.hasAttribute("data-complete")).toBe(true);
    expect(progressbar.getAttribute("aria-valuetext")).toBe("3 of 3");
    expect(view.container.querySelector<HTMLElement>("[data-slot='progress-indicator']")?.style.width).toBe("100%");
  });

  test("does not fabricate a count while loading", () => {
    const view = render(<Progress label="Identity check" value={null} max={3} />);
    const progressbar = view.getByRole("progressbar", { name: "Identity check" });

    expect(progressbar.hasAttribute("aria-valuenow")).toBe(false);
    expect(progressbar.getAttribute("aria-valuetext")).toBe("indeterminate progress");
    expect(progressbar.hasAttribute("data-indeterminate")).toBe(true);
    expect(view.queryByText(/of 3/)).toBeNull();
  });
});
