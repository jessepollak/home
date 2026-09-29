import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";

const { act, cleanup, render } = await import("@testing-library/react");
const { useAutoFitAmountText } = await import("./amount");

const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalBoundingRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) { this.targets.push(target); }
  disconnect() { this.targets.length = 0; }
  unobserve(target: Element) { this.targets.splice(this.targets.indexOf(target), 1); this.unobserved.push(target); }
  readonly unobserved: Element[] = [];

  deliver(target: Element, inlineSize: number, box: "content" | "border") {
    const entry = {
      target,
      contentBoxSize: box === "content" ? [{ inlineSize }] : [],
      borderBoxSize: box === "border" ? [{ inlineSize }] : [],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function FitHarness({ text }: { text: string }) {
  const { containerRef, sizerRef, fontSize, overflows } = useAutoFitAmountText<HTMLDivElement>(text);
  return <>
    <div ref={containerRef} style={{ fontSize, "--money-amount-min-size": "24px" } as React.CSSProperties} data-testid="fit-container">{text}</div>
    <span ref={sizerRef} style={{ fontSize: 36 }} data-testid="fit-sizer">{text}</span>
    <output data-testid="fit-result">{fontSize ?? "unset"}:{String(overflows)}</output>
  </>;
}

afterEach(() => {
  cleanup();
  if (originalResizeObserver) Object.defineProperty(globalThis, "ResizeObserver", originalResizeObserver);
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  if (originalBoundingRect) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalBoundingRect);
  else Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
  TestResizeObserver.instances.length = 0;
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
});

test("observed content and border widths fit before paint without mount geometry reads", () => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { throw new Error("unexpected clientWidth read"); } });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value() { throw new Error("unexpected bounding rect read"); } });
  let fontReadyReads = 0;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { get ready() { fontReadyReads += 1; return Promise.resolve(); }, addEventListener() {}, removeEventListener() {} },
  });
  const view = render(<FitHarness text="100" />);
  expect(fontReadyReads).toBe(0);
  const container = view.getByTestId("fit-container");
  const sizer = view.getByTestId("fit-sizer");
  const observer = TestResizeObserver.instances.find((instance) => instance.targets.includes(container))!;
  expect(view.getByTestId("fit-result").textContent).toBe("unset:false");
  act(() => observer.deliver(container, 300, "content"));
  expect(view.getByTestId("fit-result").textContent).toBe("unset:false");
  act(() => {
    observer.deliver(sizer, 400, "border");
    expect(view.getByTestId("fit-result").textContent).toBe("26.1:false");
  });
  act(() => observer.deliver(sizer, 500, "border"));
  expect(view.getByTestId("fit-result").textContent).toBe("24:true");
});

test("a text change refits from the next sizer delivery while retaining the container width", () => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  const view = render(<FitHarness text="100" />);
  const container = view.getByTestId("fit-container");
  const sizer = view.getByTestId("fit-sizer");
  const observer = TestResizeObserver.instances.find((instance) => instance.targets.includes(container))!;
  act(() => {
    observer.deliver(container, 300, "content");
    observer.deliver(sizer, 400, "border");
  });
  expect(view.getByTestId("fit-result").textContent).toBe("26.1:false");
  view.rerender(<FitHarness text="100,000" />);
  expect(view.getByTestId("fit-result").textContent).toBe("26.1:false");
  act(() => observer.deliver(sizer, 600, "border"));
  expect(view.getByTestId("fit-result").textContent).toBe("24:true");
});

test("a root style change defers its refit to the next observer delivery", async () => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  const view = render(<FitHarness text="100" />);
  const container = view.getByTestId("fit-container");
  const sizer = view.getByTestId("fit-sizer");
  const observer = TestResizeObserver.instances.find((instance) => instance.targets.includes(container))!;
  act(() => {
    observer.deliver(container, 300, "content");
    observer.deliver(sizer, 500, "border");
  });
  expect(view.getByTestId("fit-result").textContent).toBe("24:true");
  const unobservedBefore = observer.unobserved.length;
  try {
    container.style.setProperty("--money-amount-min-size", "30px");
    document.documentElement.classList.add("fit-theme");
    await act(async () => {});
    expect(view.getByTestId("fit-result").textContent).toBe("24:true");
    expect(observer.unobserved.slice(unobservedBefore)).toEqual([container]);
    expect(observer.targets).toContain(container);
    act(() => observer.deliver(container, 300, "content"));
    expect(view.getByTestId("fit-result").textContent).toBe("30:true");
  } finally {
    document.documentElement.classList.remove("fit-theme");
  }
});

test("without ResizeObserver the layout-effect fallback still fits", () => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: undefined });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 300; } });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() { return { width: 400 }; },
  });
  const view = render(<FitHarness text="100" />);
  expect(view.getByTestId("fit-result").textContent).toBe("26.1:false");
});
