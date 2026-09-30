import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SupportContextChip } from "./support-context-chip";
import { ProfileMark } from "@/components/profile-mark";
import { SupportMessageBubble } from "@/components/ui/support-message";

afterEach(cleanup);

describe("support messages", () => {
  test("a pending customer message exposes its delivery state", () => {
    const view = render(<SupportMessageBubble author="customer" side="customer" delivery="sending">Where is my order?</SupportMessageBubble>);
    expect(view.getByText("Where is my order?")).toBeTruthy();
    expect(view.getByRole("status").textContent).toBe("Sending…");
  });

  test("a failed message can retry", () => {
    let attempts = 0;
    const view = render(<SupportMessageBubble author="customer" side="customer" delivery="failed" onRetry={() => { attempts++; }}>Please help</SupportMessageBubble>);
    expect(view.getByRole("status").textContent).toBe("Not sent");
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(attempts).toBe(1);
  });

  test("assistant and person replies carry distinct author labels, including continued replies", () => {
    const assistant = render(<SupportMessageBubble author="assistant" side="customer">I can help</SupportMessageBubble>);
    expect(assistant.getByText("Assistant")).toBeTruthy();
    cleanup();
    const continued = render(<SupportMessageBubble author="operator" side="customer" continued>Still here</SupportMessageBubble>);
    expect(continued.getByText("Support")).toBeTruthy();
  });

test("every message announces its speaker", () => {
  const bubble = render(<SupportMessageBubble author="operator" side="customer">We can help</SupportMessageBubble>);
  expect(bubble.getByText("Support")).toBeTruthy();
  const own = render(<SupportMessageBubble author="customer" side="customer">Where is my order?</SupportMessageBubble>);
  expect(own.getByText("You")).toBeTruthy();
});

  test("profile mark announces the unread support count", () => {
    const view = render(<ProfileMark status="ready" supportUnreadCount={2} />);
    expect(view.getByRole("button", { name: "Account, 2 unread support messages" })).toBeTruthy();
    view.rerender(<ProfileMark status="ready" supportUnreadCount={null} />);
    expect(view.getByRole("button", { name: "Account" })).toBeTruthy();
  });

  test("a funding context has no exposed reference identifier", () => {
    const view = render(<SupportContextChip context={{ kind: "funding_order", id: "private-order-id" }} />);
    expect(view.getByText("About your add money order")).toBeTruthy();
    expect(view.queryByText("private-order-id")).toBeNull();
  });
});
