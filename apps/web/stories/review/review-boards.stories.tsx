import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ReviewBoardView } from "./explorations/board/board";
import { parseBoard } from "./explorations/board/manifest";
import { readReviewBuild, type ReviewBuild } from "./explorations/board/review-build";
import borrowIllustrationJson from "./boards/borrow-illustration.json";
import savingsJson from "./boards/savings.json";

const build = readReviewBuild(import.meta.env);
const savings = parseBoard(savingsJson);
const borrowIllustration = parseBoard(borrowIllustrationJson);
const fixture = parseBoard({
  id: "chrome-fixture", title: "Board chrome test", summary: "Empty document controls", sections: [
    { id: "first", title: "First section", frames: [
      { id: "one", story: "blank-one", label: "First frame", viewport: "mobile", change: "new", before: "blank-before" },
      { id: "two", story: "blank-two", label: "Second frame", viewport: "narrow", change: "unchanged" },
    ] },
  ],
});
const fixtureBuild: ReviewBuild = {
  revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null,
};
const meta = { id: "review-boards", title: "Review/Boards", component: ReviewBoardView, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReviewBoardView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Changes: Story = { tags: ["!test", "review-board"], args: { board: "changes", build } };
export const Savings: Story = { tags: ["!test", "review-board"], args: { board: savings, build } };
export const BorrowIllustration: Story = { tags: ["!test", "review-board"], args: { board: borrowIllustration, build } };
export const CommentsFollowCanvas: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank" },
  render: (args) => <div style={{ height: "100dvh", width: 1400 }}><ReviewBoardView {...args} /></div>,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const host = doc.createElement("vercel-live-feedback");
    host.style.cssText = "position: fixed; inset: 0; pointer-events: none; clip-path: circle(50%)";
    let scrollEvents = 0;
    const onScroll = () => { scrollEvents += 1; };
    doc.defaultView!.addEventListener("scroll", onScroll);
    doc.body.append(host);
    try {
      const screen = within(doc.body);
      const canvas = doc.querySelector<HTMLElement>("[data-review-canvas]");
      if (!canvas) throw new Error("Board canvas is required");
      const expectedClip = () => {
        const { top, right, bottom, left } = canvas.getBoundingClientRect();
        return `inset(${Math.max(0, top)}px ${Math.max(0, innerWidth - right)}px ${Math.max(0, innerHeight - bottom)}px ${Math.max(0, left)}px)`;
      };
      await waitFor(() => expect(host.style.clipPath).toBe(expectedClip()));
      await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      await waitFor(() => expect(scrollEvents).toBeGreaterThan(0));
      const outline = screen.getByRole("button", { name: "Outline" });
      await userEvent.click(outline);
      await waitFor(() => expect(host.style.clipPath).toBe(expectedClip()));
    } finally {
      doc.defaultView!.removeEventListener("scroll", onScroll);
      host.remove();
    }
  },
};
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
    <ReviewBoardView board={fixture} build={fixtureBuild} frameSource="blank" narrow={narrow} />
  </div>;
}
async function interactOnMobile(screen: ReturnType<typeof within>) {
  const action = screen.getByRole("button", { name: "Interact" });
  await waitFor(() => expect(action).toBeEnabled());
  await userEvent.click(action);
  await expect(action).toHaveTextContent("Close");
  await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  return action;
}
export const BoardChrome: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank" },
  render: () => <ChromeFixture />,
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const screen = within(doc.body);
    const board = screen.getByRole("main", { name: "Review board" });
    const frameOverlay = (name: RegExp) => screen.getByRole("button", { name });
    const zoomPercent = (text: string | null) => Number.parseInt(text ?? "0", 10);
    await userEvent.click(screen.getByRole("button", { name: "Fit board" }));
    const mac = /Mac|iPhone|iPad|iPod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.userAgent);
    const modifier = mac ? "Meta" : "Control";
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "both");
    await expect(new URL(doc.location.href).searchParams.get("side")).toBe("both");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "after");
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await expect(screen.getByRole("button", { name: "Reset zoom to 100%" })).not.toHaveTextContent("100%");
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    board.focus();
    await userEvent.keyboard("{+}{-}01");
    await userEvent.click(screen.getByRole("button", { name: "Fit board" }));
    const zoomControl = screen.getByRole("button", { name: "Reset zoom to 100%" });
    const boardZoom = zoomControl.textContent;
    const outlineToggle = screen.getByRole("button", { name: "Outline" });
    const inspectorToggle = screen.getByRole("button", { name: "Inspector" });
    const outlineShown = outlineToggle.getAttribute("aria-pressed") === "true";
    await expect(screen.queryByRole("complementary", { name: "Outline" }) !== null).toBe(outlineShown);
    if (!outlineShown) await userEvent.click(outlineToggle);
    await expect(outlineToggle).toHaveAttribute("aria-pressed", "true");
    await expect(inspectorToggle).toHaveAttribute("aria-pressed", "true");
    const outline = within(screen.getByRole("complementary", { name: "Outline" }));
    const firstSection = within(outline.getByRole("group", { name: "First section" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "before");
    await expect(new URL(doc.location.href).searchParams.get("side")).toBe("before");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Before and after" }), "both");
    await userEvent.click(firstSection.getByRole("button", { name: /Second frame.*320/i }));
    await waitFor(() => expect(new URL(doc.location.href).searchParams.get("side")).toBeNull());
    const afterFrame = frameOverlay(/First section · Second frame · Unchanged/);
    const canvasBounds = doc.querySelector<HTMLElement>("[data-review-canvas]")?.getBoundingClientRect();
    if (!canvasBounds) throw new Error("Board canvas is required");
    await waitFor(async () => {
      const bounds = afterFrame.getBoundingClientRect();
      await expect(Math.abs((bounds.left + bounds.right) / 2 - (canvasBounds.left + canvasBounds.right) / 2)).toBeLessThan(3);
    });
    await expect(screen.getByRole("combobox", { name: "Before and after" })).toHaveValue("after");
    await expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("blank-two");
    await userEvent.click(firstSection.getByRole("button", { name: /First frame.*new.*390/i }));
    await waitFor(() => expect(zoomPercent(zoomControl.textContent))
      .toBeGreaterThan(zoomPercent(boardZoom) + 5));
    const frameZoom = zoomControl.textContent;
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await expect(inspector).toHaveTextContent("blank-one");
    const secondOverlay = frameOverlay(/First section · Second frame · Unchanged/);
    const secondBounds = secondOverlay.getBoundingClientRect();
    await userEvent.pointer([
      { target: secondOverlay, coords: { x: secondBounds.left + 20, y: secondBounds.top + 20 }, keys: "[MouseLeft>]" },
      { target: secondOverlay, coords: { x: secondBounds.left + 55, y: secondBounds.top + 20 } },
      { target: secondOverlay, keys: "[/MouseLeft]" },
    ]);
    await expect(inspector).toHaveTextContent("blank-one");
    await userEvent.click(secondOverlay);
    await expect(inspector).toHaveTextContent("blank-two");
    const overlay = frameOverlay(/First section · First frame · New/);
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
    await expect(screen.getByText(/^Interacting with/))
      .toHaveTextContent("Interacting with First frame · Esc to exit");
    const activeIframe = screen.getByTitle("First section · First frame") as HTMLIFrameElement;
    await waitFor(() => expect(activeIframe).toHaveFocus());
    const activeButton = activeIframe.contentDocument!.createElement("button");
    activeIframe.contentDocument!.body.append(activeButton);
    activeButton.focus();
    await waitFor(() => expect(activeIframe.contentDocument?.activeElement).toBe(activeButton));
    await expect(activeIframe).toHaveFocus();
    activeIframe.contentWindow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => expect(screen.queryByText(/^Interacting with/)).not.toBeInTheDocument());
    await waitFor(() => expect(frameOverlay(/First section · First frame · New/)).toHaveFocus());
    for (const name of [/Open story/, /Open canvas/]) {
      const link = within(inspector).getByRole("link", { name });
      link.focus();
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      await expect(link.dispatchEvent(enter)).toBe(true);
      await expect(screen.queryByText(/^Interacting with/)).not.toBeInTheDocument();
      const plus = new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true });
      await expect(link.dispatchEvent(plus)).toBe(true);
    }
    frameOverlay(/First section · First frame · New/).focus();
    await userEvent.keyboard("{Enter}");
    await expect(screen.getByText(/^Interacting with/)).toBeVisible();
    await userEvent.click(outline.getByRole("button", { name: /Second frame/i }));
    await waitFor(() => expect(screen.queryByText(/^Interacting with/)).not.toBeInTheDocument());
    await userEvent.click(firstSection.getByRole("button", { name: /First frame.*new.*390/i }));
    frameOverlay(/First section · First frame · New/).focus();
    await userEvent.keyboard("{Enter}");
    const chip = screen.getByText(/^Interacting with/);
    await expect(chip).toBeVisible();
    const chipCanvas = doc.querySelector<HTMLElement>("[data-review-canvas]")!.getBoundingClientRect();
    await waitFor(async () => {
      const frame = screen.getByTitle("First section · First frame").getBoundingClientRect();
      const bounds = chip.getBoundingClientRect();
      const expected = Math.min(chipCanvas.right - 8 - bounds.width / 2,
        Math.max(chipCanvas.left + 8 + bounds.width / 2, (frame.left + frame.right) / 2));
      await expect(Math.abs((bounds.left + bounds.right) / 2 - expected)).toBeLessThan(2);
      await expect(bounds.bottom).toBeLessThanOrEqual(frame.top - 20 - 8 + 1);
    });
    const comparison = screen.getByRole("combobox", { name: "Before and after" });
    await userEvent.selectOptions(comparison, "before");
    await waitFor(() => expect(screen.queryByText(/^Interacting with/)).not.toBeInTheDocument());
    await userEvent.selectOptions(comparison, "after");
    board.focus();
    await userEvent.keyboard("-");
    await userEvent.keyboard("F");
    await waitFor(() => expect(zoomControl).toHaveTextContent(frameZoom ?? ""));
    await userEvent.keyboard("-");
    await userEvent.keyboard("2");
    await waitFor(() => expect(zoomControl).toHaveTextContent(frameZoom ?? ""));
    await userEvent.keyboard("-");
    await userEvent.keyboard("{Shift>}2{/Shift}");
    await waitFor(() => expect(zoomControl).toHaveTextContent(frameZoom ?? ""));
    const surface = doc.querySelector<HTMLElement>("[data-review-canvas]");
    if (!surface) throw new Error("Board canvas is required");
    const wheel = (init: WheelEventInit) => {
      const bounds = surface.getBoundingClientRect();
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true,
        clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, ...init });
      surface.dispatchEvent(event);
      return event;
    };
    const first = frameOverlay(/First section · First frame · New/);
    await Promise.all(surface.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const start = first.getBoundingClientRect();
    const expectFrameAt = (left: number, top: number) => waitFor(async () => {
      const bounds = first.getBoundingClientRect();
      await expect(bounds.left).toBeCloseTo(left, 0);
      await expect(bounds.top).toBeCloseTo(top, 0);
    });
    await expect(wheel({ deltaX: 30, deltaY: 40 }).defaultPrevented).toBe(true);
    await expectFrameAt(start.left - 30, start.top - 40);
    wheel({ deltaY: 3, deltaMode: 1, shiftKey: true });
    await expectFrameAt(start.left - 78, start.top - 40);
    await expect(zoomControl).toHaveTextContent(frameZoom ?? "");
    await expect(wheel({ deltaY: -20, ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(zoomPercent(zoomControl.textContent)).toBeGreaterThan(zoomPercent(frameZoom)));
    const pinchedZoom = zoomControl.textContent;
    await expect(wheel({ deltaY: 20, metaKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(zoomPercent(zoomControl.textContent)).toBeLessThan(zoomPercent(pinchedZoom)));
    await userEvent.keyboard("{Shift>}1{/Shift}");
    await waitFor(() => expect(zoomPercent(zoomControl.textContent)).toBeLessThan(zoomPercent(frameZoom)));
    const fitAllZoom = zoomControl.textContent;
    await userEvent.keyboard(`{${modifier}>}0{/${modifier}}`);
    await waitFor(() => expect(zoomControl).toHaveTextContent("100%"));
    await userEvent.click(screen.getByRole("button", { name: "Fit board" }));
    await waitFor(() => expect(zoomControl).toHaveTextContent(fitAllZoom ?? ""));
    await userEvent.dblClick(frameOverlay(/First section · Second frame · Unchanged/));
    await expect(screen.getByText(/^Interacting with/)).toHaveTextContent("Interacting with Second frame");
    await expect(inspector).toHaveTextContent("blank-two");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(/^Interacting with/)).not.toBeInTheDocument());
    const canvasWidth = surface.getBoundingClientRect().width;
    const outlinePanel = () => screen.queryByRole("complementary", { name: "Outline" });
    const inspectorPanel = () => screen.queryByRole("complementary", { name: "Inspector" });
    await Promise.all(surface.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const frameLeft = first.getBoundingClientRect().left;
    board.focus();
    await userEvent.keyboard("[[");
    await expect(outlineToggle).toHaveAttribute("aria-pressed", "false");
    await expect(outlinePanel()).not.toBeInTheDocument();
    await expect(inspectorPanel()).toBeVisible();
    await expect(first.getBoundingClientRect().left).toBeCloseTo(frameLeft, 0);
    await userEvent.keyboard("]");
    await expect(inspectorToggle).toHaveAttribute("aria-pressed", "false");
    await expect(inspectorPanel()).not.toBeInTheDocument();
    await waitFor(() => expect(surface.getBoundingClientRect().width).toBeGreaterThan(canvasWidth));
    await expect(first.getBoundingClientRect().left).toBeCloseTo(frameLeft, 0);
    await userEvent.click(inspectorToggle);
    await expect(inspectorToggle).toHaveAttribute("aria-pressed", "true");
    await expect(inspectorPanel()).toBeVisible();
    await expect(outlinePanel()).not.toBeInTheDocument();
    await userEvent.keyboard("[[");
    await expect(outlinePanel()).toBeVisible();
    await expect(first.getBoundingClientRect().left).toBeCloseTo(frameLeft, 0);
    board.focus();
    await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`);
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    const search = within(palette).getByRole("combobox", { name: "Search board navigation" });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard("second frame");
    await waitFor(() => expect(within(palette).getAllByRole("option")[0]).toHaveTextContent("Second frame"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument());
    await expect(new URL(doc.location.href).searchParams.get("frame")).toBe("two");
    await expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("blank-two");
    await waitFor(() => expect(board.contains(doc.activeElement)).toBe(true));
    within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("button", { name: "Fit frame" }).focus();
    await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`);
    await userEvent.keyboard("tgl insp");
    const options = within(await screen.findByRole("dialog", { name: "Command palette" })).getAllByRole("option");
    await expect(options[0]).toHaveTextContent("Toggle inspector");
    await userEvent.keyboard("{Enter}");
    await expect(inspectorToggle).toHaveAttribute("aria-pressed", "false");
    await expect(outlineToggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(board.contains(doc.activeElement) && doc.activeElement !== doc.body).toBe(true));
    board.focus();
    await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`);
    await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument());
    await waitFor(() => expect(board.contains(doc.activeElement)).toBe(true));
    await userEvent.keyboard("?");
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const group of ["Canvas", "Selection", "Panels", "General"])
      await expect(within(help).getByRole("heading", { name: group })).toBeVisible();
    await expect(within(help).getByText("Toggle outline")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument());
    await userEvent.keyboard("]");
    await expect(screen.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Narrow board width" }));
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Widen board width" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fit board" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: "Test narrow layout" }));
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("one");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Select frame" }), "two");
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await userEvent.click(screen.getByRole("button", { name: "Set mobile width to 390" }));
    const mobileOverlay = frameOverlay(/First section · Second frame · Unchanged/);
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
    const header = board.parentElement?.querySelector("header");
    const headerText = header?.textContent;
    const nav = screen.getByRole("navigation", { name: "Frame navigation" });
    const heights = [...nav.querySelectorAll("button, select")].map((control) => control.getBoundingClientRect().height);
    await expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    await expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    const action = await interactOnMobile(screen);
    const activeMobileFrame = screen.getByTitle("First section · Second frame");
    await expect(activeMobileFrame).not.toHaveAttribute("inert");
    await waitFor(() => expect(activeMobileFrame).toHaveFocus());
    await expect(header?.textContent).toBe(headerText);
    await expect(header?.closest("[inert]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(action).toHaveTextContent("Interact"));
    await waitFor(() => expect(action).toHaveFocus());
    await expect(screen.getByTitle("First section · Second frame")).toHaveAttribute("inert");
    await interactOnMobile(screen);
    await userEvent.click(action);
    await expect(action).toHaveTextContent("Interact");
    for (const name of ["Previous", "Select frame", "Next", "Interact"])
      await expect(within(nav).getByRole(name === "Select frame" ? "combobox" : "button", { name })).toBeVisible();
    await expect(within(board).getByText("First section · 320×700")).toBeVisible();
  },
};

export const DoubleTapInteractsOnMobile: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "two" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const overlay = await screen.findByRole("button", { name: /First section · Second frame · Unchanged/ });
    const action = screen.getByRole("button", { name: "Interact" });
    await waitFor(() => expect(action).toBeEnabled());
    const bounds = overlay.getBoundingClientRect();
    const at = (x: number, y: number) => ({ target: overlay, keys: "[TouchA]", coords: { x: bounds.left + x, y: bounds.top + y } });
    await userEvent.pointer([at(20, 20)]);
    await expect(await screen.findByText("Double-tap to interact")).toBeVisible();
    await expect(action).toHaveTextContent("Interact");
    await expect(screen.getByTitle("First section · Second frame")).toHaveAttribute("inert");
    await userEvent.pointer([at(120, 160), at(126, 166)]);
    await waitFor(() => expect(action).toHaveTextContent("Close"));
    await expect(screen.queryByText("Double-tap to interact")).not.toBeInTheDocument();
    await expect(screen.getByTitle("First section · Second frame")).not.toHaveAttribute("inert");
    await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(action).toHaveTextContent("Interact"));
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("frame")).toBe("two");
  },
};

export const FrameClicks: Story = {
  tags: ["!test"],
  args: { board: fixture, build: fixtureBuild, frameSource: "blank" },
  render: (args) => <div style={{ height: "100dvh", width: 1400 }}>
    <ReviewBoardView {...args} />
  </div>,
};
function withSearch(params: Record<string, string>) {
  const previous = location.href;
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  history.replaceState(history.state, "", url);
  return () => history.replaceState(history.state, "", previous);
}
export const StaleFrameLink: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "removed-frame", rev: "earlier" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.getByRole("combobox", { name: "Select frame" })).toHaveValue("one");
    await expect(screen.getByText(/not on this revision/)).toBeVisible();
    await expect(screen.getByRole("button", { name: /First section · First frame · New/ })).toBeVisible();
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("frame")).toBe("one");
    const action = await interactOnMobile(screen);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(action).toHaveTextContent("Interact"));
  },
};
export const RestoredBeforeOnMobile: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank", narrow: true },
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
export const UnavailableBeforeLinkFallsBack: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "two", side: "both", variant: "before" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await expect(screen.queryByLabelText("Before and after")).not.toBeInTheDocument();
    await waitFor(() => expect(new URL(location.href).searchParams.get("variant")).toBeNull());
  },
};
export const BeforeDisabledWithoutComparison: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "blank" },
  render: (args) => <div style={{ height: "100dvh", width: 1400 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => withSearch({ frame: "two" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const sides = await screen.findByRole("combobox", { name: "Before and after" });
    await expect(within(sides).getByRole("option", { name: "Before" })).toBeDisabled();
    await expect(sides).toHaveValue("after");
  },
};
export const MissingStoryExcluded: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "story", narrow: true },
  render: (args) => <div style={{ height: "100dvh", width: 390 }}><ReviewBoardView {...args} /></div>,
  beforeEach: () => {
    const restoreSearch = withSearch({ frame: "one" });
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("index.json")) return original(input, init);
      return Promise.resolve(new Response(JSON.stringify({ entries: {
        "blank-two": { id: "blank-two", type: "story" },
      } })));
    }) as typeof fetch;
    return () => { globalThis.fetch = original; restoreSearch(); };
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("combobox", { name: "Select frame" })).toHaveValue("two");
    await expect(screen.queryByRole("option", { name: /First frame/ })).not.toBeInTheDocument();
    await expect(screen.getByText(/not on this revision/)).toBeVisible();
    const action = await interactOnMobile(screen);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(action).toHaveTextContent("Interact"));
  },
};
const changedFixture = parseBoard({
  id: "changed-fixture", title: "Changed outline test", summary: "Changed frames first", sections: [
    { id: "intro", title: "Intro", frames: [{ id: "plain", story: "fixture-plain--default", label: "Plain frame", viewport: "mobile", change: "unchanged" }] },
    { id: "later", title: "Later section", frames: [{ id: "edited", story: "fixture-edited--default", label: "Edited frame", viewport: "narrow", change: "unchanged" }] },
  ],
});
export const ChangedFramesFirst: Story = {
  args: {
    board: changedFixture, frameSource: "story",
    build: { ...fixtureBuild, pr: 999, changedFiles: ["apps/web/client/edited.tsx"], addedFiles: [] },
  },
  render: (args) => <div style={{ height: "100dvh", width: 1400 }}><ReviewBoardView {...args} /></div>,
  parameters: { a11y: { test: "error" } },
  beforeEach: () => {
    const restoreSearch = withSearch({ frame: "plain" });
    const original = globalThis.fetch;
    const entry = (id: string, file: string) => ({ id, title: "Fixture", name: "Default", importPath: `./client/${file}.stories.tsx`, type: "story" });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("index.json")) return original(input, init);
      return Promise.resolve(new Response(JSON.stringify({ entries: {
        "fixture-plain--default": entry("fixture-plain--default", "plain"),
        "fixture-edited--default": entry("fixture-edited--default", "edited"),
      } })));
    }) as typeof fetch;
    return () => { globalThis.fetch = original; restoreSearch(); };
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const outline = await screen.findByRole("complementary", { name: "Outline" });
    const groups = within(outline).getAllByRole("group");
    await expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Changed in this PR", "Intro", "Later section"]);
    const changed = within(groups[0]);
    await expect(changed.getAllByRole("button")).toHaveLength(1);
    await expect(changed.getByRole("button", { name: /Edited frame.*changed.*320/i })).toBeVisible();
    await expect(within(groups[1]).getByRole("button", { name: /Plain frame/ })).not.toHaveTextContent(/unchanged/i);
    await userEvent.click(changed.getByRole("button", { name: /Edited frame/ }));
    await waitFor(() => expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("frame")).toBe("edited"));
    await expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("fixture-edited--default");
    await waitFor(() => expect(changed.getByRole("button", { name: /Edited frame/ })).toHaveAttribute("aria-current", "true"));
  },
};
export const IndexUnavailable: Story = {
  args: { board: fixture, build: fixtureBuild, frameSource: "story" },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("index.json") ? Promise.resolve(new Response("", { status: 404 })) : original(input, init)) as typeof fetch;
    return () => { globalThis.fetch = original; };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Couldn.t load this build.s story list/)).toBeVisible();
    await expect(canvasElement.querySelector("iframe")).toBeNull();
  },
};

const navigationFixture = parseBoard({
  id: "navigation", title: "Navigation test", summary: "Board navigation controls", sections: [
    { id: "first", title: "First section", frames: [
      { id: "one", story: "blank-one", label: "First frame", viewport: "mobile", change: "new" },
    ] },
    { id: "second", title: "Second section", frames: [
      { id: "three", story: "blank-three", label: "Third frame", viewport: "mobile", change: "new" },
    ] },
  ],
});
const navigationCalls: { url: string; newTab: boolean }[] = [];
export const BoardNavigation: Story = {
  args: { board: navigationFixture, build: fixtureBuild, frameSource: "blank" },
  render: (args) => <div style={{ height: "100dvh", width: 1400 }}>
    <ReviewBoardView {...args} storyIndex={{
      "review-boards--savings": { id: "review-boards--savings", name: "Savings", title: "Review/Boards",
        importPath: "board", type: "story", tags: ["review-board"] },
      "account-settings--default": { id: "account-settings--default", name: "Account Settings",
        title: "Account/Settings", importPath: "settings", type: "story" },
    }} onNavigate={(url, newTab) => {
      navigationCalls.push({ url, newTab });
      if (!newTab) history.replaceState(history.state, "", new URL(url, location.href));
    }} />
  </div>,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const screen = within(doc.body);
    const original = doc.location.href;
    const board = screen.getByRole("main", { name: "Review board" });
    navigationCalls.length = 0;
    const modifier = /Mac|iPhone|iPad|iPod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.userAgent) ? "Meta" : "Control";
    try {
      board.focus();
      await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`);
      const palette = await screen.findByRole("dialog", { name: "Command palette" });
      const search = within(palette).getByRole("combobox", { name: "Search board navigation" });
      await waitFor(() => expect(search).toHaveFocus());
      for (const name of ["Commands", "Frames", "Sections", "Boards"])
        await expect(within(palette).getByRole("group", { name })).toBeVisible();
      await userEvent.keyboard("Account Settings");
      await expect(within(palette).getByRole("group", { name: "Stories" })).toBeVisible();
      await waitFor(() => expect(within(palette).getAllByRole("option")[0]).toHaveTextContent("Account Settings"));
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(new URL(doc.location.href).searchParams.get("path"))
        .toBe("/story/account-settings--default"));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument());
      await expect(navigationCalls.at(-1)).toEqual({ url: "./?path=%2Fstory%2Faccount-settings--default", newTab: false });
      board.focus();
      await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`);
      const newTabPalette = await screen.findByRole("dialog", { name: "Command palette" });
      const newTabSearch = within(newTabPalette).getByRole("combobox", { name: "Search board navigation" });
      await waitFor(() => expect(newTabSearch).toHaveFocus());
      await userEvent.keyboard("Account Settings");
      await waitFor(() => expect(within(newTabPalette).getByRole("group", { name: "Stories" })).toBeVisible());
      await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
      await waitFor(() => expect(navigationCalls.at(-1)).toEqual({ url: "./?path=%2Fstory%2Faccount-settings--default", newTab: true }));
      board.focus();
      await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
      await waitFor(() => expect(new URL(doc.location.href).searchParams.get("frame")).toBe("three"));
      await expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("blank-three");
      board.focus();
      await userEvent.keyboard("?");
      await expect(within(await screen.findByRole("dialog", { name: "Keyboard shortcuts" }))
        .getByText("Next section")).toBeVisible();
      await userEvent.keyboard("{Escape}");
    } finally {
      history.replaceState(history.state, "", original);
    }
  },
};
