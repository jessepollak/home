import "./dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Button, EmptyState, Skeleton, StatusMessage, Toast, ToastViewport } from "@home/ui";

afterEach(cleanup);

describe("feedback primitives", () => {
  test("Skeleton exposes decorative shapes and grouped rows", () => {
    const view = render(
      <div>
        <Skeleton shape="circle" width="2rem" height="2rem" />
        <Skeleton shape="text" width="70%" rows={3} />
      </div>,
    );

    expect(view.container.querySelector('[data-shape="circle"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector('[data-rows="3"]')?.children).toHaveLength(3);
  });

  test("EmptyState and StatusMessage keep supplied actions and live roles", () => {
    const view = render(
      <div>
        <EmptyState title="No activity" description="Actions appear here." action={<Button>Start</Button>} />
        <StatusMessage tone="error" role="alert" title="Unavailable">Try again.</StatusMessage>
      </div>,
    );

    expect(view.getByText("No activity")).toBeTruthy();
    expect(view.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(view.getByRole("alert").getAttribute("data-tone")).toBe("error");
  });

  test("ToastViewport owns the live region and Toast owns manual dismissal", () => {
    let dismissals = 0;
    const view = render(
      <ToastViewport>
        <Toast duration={0} onDismiss={() => { dismissals += 1; }}>Saved</Toast>
      </ToastViewport>,
    );

    const viewport = view.getByRole("region", { name: "Notifications" });
    expect(viewport.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(view.getByRole("button", { name: "Dismiss notification" }));
    expect(dismissals).toBe(1);
  });
});
