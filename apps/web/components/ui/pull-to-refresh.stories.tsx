import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh, type PullToRefreshPhase } from "./pull-to-refresh";

function Preview({ phase }: { phase: PullToRefreshPhase }) {
  return <div className="relative h-24 w-80 overflow-hidden rounded-lg bg-muted"><PullToRefreshAction label="Refresh preview" refreshing={phase === "refreshing"} onRefresh={() => {}} /><PullToRefreshIndicator phase={phase} indicatorRef={(node) => {
    if (node) {
      node.style.opacity = phase === "idle" ? "0" : phase === "settling" ? "0.35" : "1";
      node.style.rotate = phase === "armed" ? "180deg" : "0deg";
    }
  }} /></div>;
}

function InteractivePreview({ onRefresh }: { onRefresh: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { phase, indicatorRef, actionRef } = usePullToRefresh({ scrollRef, contentRef, enabled: true, refreshing: false, onRefresh });
  return <div ref={scrollRef} aria-label="Refresh gesture preview" className="relative h-60 w-80 overflow-y-auto overscroll-contain rounded-lg bg-muted">
    <PullToRefreshAction label="Refresh preview" refreshing={false} onRefresh={onRefresh} actionRef={actionRef} />
    <PullToRefreshIndicator phase={phase} indicatorRef={indicatorRef} />
    <div ref={contentRef}>
      <div className="px-4 py-3 text-sm text-foreground" data-testid="gesture-target">Pull down to refresh</div>
      {Array.from({ length: 16 }, (_, index) => <div key={index} className="border-t border-border px-4 py-3 text-sm text-foreground">Item {index + 1}</div>)}
    </div>
  </div>;
}

const meta = {
  id: "ui-pull-to-refresh",
  title: "UI/Pull to Refresh",
  component: Preview,
  args: { phase: "idle" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Preview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Pulling: Story = { args: { phase: "pulling" } };
export const Armed: Story = { args: { phase: "armed" } };
export const Cancelled: Story = { args: { phase: "settling" } };
export const Refreshing: Story = {
  args: { phase: "refreshing" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Refresh preview" });
    const indicator = canvasElement.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
    await expect(action.textContent).toBe("");
    await expect(action).toHaveAttribute("aria-busy", "true");
    await expect(Math.max(action.getBoundingClientRect().width, action.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    await expect(indicator).toBeVisible();
  },
};
export const SettlingSuccess: Story = { args: { phase: "settling" } };

function dispatch(target: HTMLElement, name: string, y: number, end = false) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  const touch = { identifier: 1, clientX: 0, clientY: y, target };
  Object.defineProperties(event, {
    touches: { value: end ? [] : [touch] },
    changedTouches: { value: [touch] },
  });
  target.dispatchEvent(event);
}

export const Interactive: Story = {
  args: { phase: "idle" },
  render: () => <InteractivePreview onRefresh={interactiveRefresh} />,
  play: async ({ canvasElement }) => {
    interactiveRefresh.mockClear();
    const target = within(canvasElement).getByTestId("gesture-target");
    dispatch(target, "touchstart", 0);
    dispatch(target, "touchmove", 50);
    dispatch(target, "touchend", 50, true);
    await expect(interactiveRefresh).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByText("Pull down to refresh")).toBeVisible();
    const content = target.parentElement!;
    const transition = new Event("transitionend", { bubbles: true });
    Object.defineProperty(transition, "propertyName", { value: "transform" });
    content.dispatchEvent(transition);
    dispatch(target, "touchstart", 0);
    dispatch(target, "touchmove", 350);
    dispatch(target, "touchend", 350, true);
    await expect(interactiveRefresh).toHaveBeenCalledTimes(1);
  },
};

export const KeyboardFocus: Story = {
  args: { phase: "idle" },
  render: () => <InteractivePreview onRefresh={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Refresh preview" });
    const firstRow = canvas.getByTestId("gesture-target");
    const content = firstRow.parentElement!;
    const indicator = canvasElement.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
    await userEvent.tab();
    await expect(action).toHaveFocus();
    await expect(action.textContent).toBe("");
    await expect(action).toBeVisible();
    await expect(indicator).not.toBeVisible();
    await expect(action.getBoundingClientRect().toJSON()).toMatchObject({
      x: indicator.getBoundingClientRect().x,
      width: indicator.getBoundingClientRect().width,
      height: indicator.getBoundingClientRect().height,
    });
    await waitFor(() => expect(action.getBoundingClientRect().bottom).toBeLessThan(firstRow.getBoundingClientRect().top));
    action.blur();
    await waitFor(() => expect(new DOMMatrixReadOnly(content.style.transform).m42).toBe(0));
  },
};

const interactiveRefresh = fn();
