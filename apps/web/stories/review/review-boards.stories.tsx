import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ReviewBoardView } from "./explorations/board/board";
import { parseBoard } from "./explorations/board/manifest";
import investJson from "./boards/invest-asset-page.json";
import savingsJson from "./boards/savings.json";

const invest = parseBoard(investJson);
const savings = parseBoard(savingsJson);
const fixture = parseBoard({
  id: "chrome-fixture", title: "Board chrome test", summary: "Empty document controls", sections: [
    { id: "first", title: "First section", frames: [
      { id: "one", story: "blank-one", label: "First frame", viewport: "mobile", change: "new", before: "blank-before" },
      { id: "two", story: "blank-two", label: "Second frame", viewport: "narrow", change: "unchanged" },
    ] },
  ],
});
const environment = {
  revision: import.meta.env.STORYBOOK_REVIEW_REVISION ?? "local",
  deployment: import.meta.env.STORYBOOK_REVIEW_DEPLOYMENT ?? "",
  branch: import.meta.env.STORYBOOK_REVIEW_BRANCH ?? "",
};
const meta = { id: "review-boards", title: "Review/Boards", component: ReviewBoardView, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReviewBoardView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InvestAssetPage: Story = { tags: ["!test"], args: { board: invest, ...environment } };
export const Savings: Story = { tags: ["!test"], args: { board: savings, ...environment } };
function ChromeFixture() {
  const [narrow, setNarrow] = useState(false);
  const [boardWidth, setBoardWidth] = useState<number>();
  return <div style={{ height: "100dvh", width: boardWidth }}>
    <button onClick={() => setBoardWidth(boardWidth === 700 ? 900 : 700)}>
      {boardWidth === 700 ? "Widen board width" : "Narrow board width"}
    </button>
    <button onClick={() => setNarrow(true)}>Test narrow layout</button>
    <button onClick={() => setBoardWidth(390)}>Set mobile width to 390</button>
    <button onClick={() => setBoardWidth(320)}>Set mobile width to 320</button>
    <ReviewBoardView board={fixture} revision="fixture" frameSource="blank" narrow={narrow} />
  </div>;
}
export const BoardChrome: Story = {
  args: { board: fixture, revision: "fixture", frameSource: "blank" },
  render: () => <ChromeFixture />,
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const board = screen.getByRole("main", { name: "Review board" });
    await userEvent.click(screen.getByRole("button", { name: "Fit board" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "both");
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("side")).toBe("both");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "after");
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await expect(screen.getByRole("button", { name: "Reset zoom to 100%" })).not.toHaveTextContent("100%");
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    board.focus();
    await userEvent.keyboard("{+}{-}01");
    await userEvent.click(screen.getByRole("button", { name: "Fit board" }));
    const zoomControl = screen.getByRole("button", { name: "Reset zoom to 100%" });
    const boardZoom = zoomControl.textContent;
    await userEvent.click(screen.getByRole("button", { name: "Expand outline" }));
    const outline = within(screen.getByRole("complementary", { name: "Outline" }));
    await userEvent.click(outline.getByRole("button", { name: /First frame.*new.*390/i }));
    await waitFor(() => expect(Number.parseInt(zoomControl.textContent ?? "0", 10))
      .toBeGreaterThan(Number.parseInt(boardZoom ?? "0", 10) + 5));
    const frameZoom = zoomControl.textContent;
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await expect(inspector).toHaveTextContent("blank-one");
    const secondOverlay = screen.getByRole("button", { name: /First section · Second frame · Unchanged/ });
    const secondBounds = secondOverlay.getBoundingClientRect();
    await userEvent.pointer([
      { target: secondOverlay, coords: { x: secondBounds.left + 20, y: secondBounds.top + 20 }, keys: "[MouseLeft>]" },
      { target: secondOverlay, coords: { x: secondBounds.left + 55, y: secondBounds.top + 20 } },
      { target: secondOverlay, keys: "[/MouseLeft]" },
    ]);
    await expect(inspector).toHaveTextContent("blank-one");
    await userEvent.click(secondOverlay);
    await expect(inspector).toHaveTextContent("blank-two");
    const overlay = screen.getByRole("button", { name: /First section · First frame · New/ });
    await userEvent.click(overlay);
    await expect(inspector).toHaveTextContent("blank-one");
    overlay.focus();
    const inactiveIframe = screen.getByTitle("First section · Second frame") as HTMLIFrameElement;
    await waitFor(() => expect(inactiveIframe.contentDocument?.body).toBeTruthy());
    const inactiveButton = inactiveIframe.contentDocument!.createElement("button");
    inactiveIframe.contentDocument!.body.append(inactiveButton);
    inactiveButton.focus();
    await waitFor(() => expect(overlay).toHaveFocus());
    await waitFor(() => expect(inactiveIframe.contentDocument?.hasFocus()).toBe(false));
    await userEvent.keyboard("{Enter}");
    await expect(screen.getByText("Interacting · Esc")).toBeVisible();
    const activeIframe = screen.getByTitle("First section · First frame") as HTMLIFrameElement;
    await waitFor(() => expect(activeIframe).toHaveFocus());
    const activeButton = activeIframe.contentDocument!.createElement("button");
    activeIframe.contentDocument!.body.append(activeButton);
    activeButton.focus();
    await waitFor(() => expect(activeIframe.contentDocument?.activeElement).toBe(activeButton));
    await expect(activeIframe).toHaveFocus();
    activeIframe.contentWindow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => expect(screen.getByText("Navigate")).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", {
      name: /First section · First frame · New/,
    })).toHaveFocus());
    for (const name of [/Open story/, /Open canvas/]) {
      const link = within(inspector).getByRole("link", { name });
      link.focus();
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      await expect(link.dispatchEvent(enter)).toBe(true);
      await expect(screen.getByText("Navigate")).toBeVisible();
      const plus = new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true });
      await expect(link.dispatchEvent(plus)).toBe(true);
    }
    screen.getByRole("button", { name: /First section · First frame · New/ }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(screen.getByText("Interacting · Esc")).toBeVisible();
    await userEvent.click(outline.getByRole("button", { name: /Second frame/i }));
    await waitFor(() => expect(screen.getByText("Navigate")).toBeVisible());
    await userEvent.click(outline.getByRole("button", { name: /First frame.*new.*390/i }));
    screen.getByRole("button", { name: /First section · First frame · New/ }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(screen.getByText("Interacting · Esc")).toBeVisible();
    const comparison = screen.getByRole("combobox", { name: "Before and after" });
    await userEvent.selectOptions(comparison, "before");
    await waitFor(() => expect(screen.getByText("Navigate")).toBeVisible());
    await userEvent.selectOptions(comparison, "after");
    screen.getByRole("button", { name: /First section · First frame · New/ }).focus();
    await userEvent.keyboard("-");
    await userEvent.keyboard("F");
    await waitFor(() => expect(zoomControl).toHaveTextContent(frameZoom ?? ""));
    await userEvent.keyboard("-");
    await userEvent.keyboard("2");
    await waitFor(() => expect(zoomControl).toHaveTextContent(frameZoom ?? ""));
    await userEvent.click(screen.getByRole("button", { name: "Narrow board width" }));
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Widen board width" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fit board" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: "Test narrow layout" }));
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("one");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Select frame" }), "two");
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await userEvent.click(screen.getByRole("button", { name: "Set mobile width to 390" }));
    const mobileOverlay = screen.getByRole("button", { name: /First section · Second frame · Unchanged/ });
    const mobileFrame = mobileOverlay.parentElement?.parentElement;
    const mobileCard = mobileFrame?.parentElement?.parentElement;
    if (!mobileFrame || !mobileCard) throw new Error("Mobile frame and card are required");
    await waitFor(() => expect(mobileFrame.getBoundingClientRect().width).toBeGreaterThan(0));
    const initialFrameWidth = mobileFrame.getBoundingClientRect().width;
    await userEvent.click(screen.getByRole("button", { name: "Set mobile width to 320" }));
    await waitFor(async () => {
      const frameBounds = mobileFrame.getBoundingClientRect();
      const cardBounds = mobileCard.getBoundingClientRect();
      await expect(frameBounds.width).toBeLessThan(initialFrameWidth);
      await expect(frameBounds.left).toBeGreaterThanOrEqual(cardBounds.left);
      await expect(frameBounds.right).toBeLessThanOrEqual(cardBounds.right);
    });
    const previous = screen.getByRole("button", { name: "Previous" });
    const header = board.parentElement?.querySelector("header");
    await userEvent.click(screen.getByRole("button", { name: "Open full width" }));
    const dialog = screen.getByRole("dialog", { name: "Second frame full width" });
    await expect(dialog).toBeVisible();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close full width" })).toHaveFocus());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await waitFor(() => expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true));
    await expect(previous.closest("[inert]")).not.toBeNull();
    await expect(header?.closest("[inert]")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open full width" })).toHaveFocus());
    await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
function withSearch(params: Record<string, string>) {
  const previous = location.href;
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  history.replaceState(history.state, "", url);
  return () => history.replaceState(history.state, "", previous);
}
export const StaleFrameLink: Story = {
  args: { board: fixture, revision: "fixture", frameSource: "blank", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "removed-frame", rev: "earlier" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("one");
    await expect(screen.getByText(/not on this revision/)).toBeVisible();
    await expect(screen.getByRole("button", { name: /First section · First frame · New/ })).toBeVisible();
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("frame")).toBe("one");
    await userEvent.click(screen.getByRole("button", { name: "Open full width" }));
    await expect(screen.getByRole("dialog", { name: "First frame full width" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  },
};
export const RestoredBeforeOnMobile: Story = {
  args: { board: fixture, revision: "fixture", frameSource: "blank", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "one", side: "both", variant: "before" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const comparison = within(screen.getByLabelText("Before and after"));
    await expect(comparison.getByRole("button", { name: "Before" })).toHaveAttribute("aria-pressed", "true");
    await expect(comparison.getByRole("button", { name: "Proposed" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(comparison.getByRole("button", { name: "Proposed" }));
    await expect(comparison.getByRole("button", { name: "Proposed" })).toHaveAttribute("aria-pressed", "true");
  },
};
let resolveIndex: ((entries: Record<string, unknown>) => void) | undefined;
export const MissingStoryWhileOpen: Story = {
  args: { board: fixture, revision: "fixture", frameSource: "story", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => {
    const restoreSearch = withSearch({ frame: "one" });
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("index.json")) return original(input, init);
      return new Promise<Response>((resolve) => {
        resolveIndex = (entries) => resolve(new Response(JSON.stringify({ entries })));
      });
    }) as typeof fetch;
    return () => { globalThis.fetch = original; resolveIndex = undefined; restoreSearch(); };
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const open = screen.getByRole("button", { name: "Open full width" });
    await userEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "First frame full width" });
    await expect(dialog).toBeVisible();
    await waitFor(() => expect(resolveIndex).toBeDefined());
    resolveIndex?.({ "blank-two": {} });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(open).toBeDisabled();
    await expect(screen.getByRole("combobox", { name: "Select frame" }).closest("[inert]")).toBeNull();
    await waitFor(() => expect(screen.getByRole("main", { name: "Review board" })).toHaveFocus());
  },
};
