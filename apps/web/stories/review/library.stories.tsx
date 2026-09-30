import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readReviewBuild, type ReviewBuild, type StoryIndexEntry } from "./explorations/board/review-build";
import { LibraryView } from "./explorations/library/library";

const build = readReviewBuild(import.meta.env);
const INITIAL_MODULE_TIMEOUT = 20_000;

const story = (id: string, title: string, name: string, importPath: string): StoryIndexEntry =>
  ({ id, title, name, importPath, type: "story" });
const buttonStories = "./components/ui/button.stories.tsx";
const fixtureEntries = [
  story("ui-button--default", "UI/Button", "Default", buttonStories),
  story("ui-button--variants", "UI/Button", "Variants", buttonStories),
  story("ui-button--sizes", "UI/Button", "Sizes", buttonStories),
  story("ui-button--loading", "UI/Button", "Loading", buttonStories),
  story("ui-badge--default", "UI/Badge", "Default", "./components/ui/badge.stories.tsx"),
  story("ui-address-field--empty", "UI/Address Field", "Empty", "./components/address-field.stories.tsx"),
  story("review-boards--changes", "Review/Boards", "Changes", "./stories/review/review-boards.stories.tsx"),
];
const indexOf = (entries: StoryIndexEntry[]) => Object.fromEntries(entries.map((entry) => [entry.id, entry]));
const fixtureIndex = indexOf(fixtureEntries);
const restoredIndex = fixtureIndex;
const fixtureBuild: ReviewBuild = {
  revision: "fixture", deployment: "", branch: "", repo: null, pr: null,
  changedFiles: ["apps/web/components/ui/button.tsx"],
};

async function installPreview(canvas: ReturnType<typeof within>, title: string, id: string, controlled = false) {
  const iframe = await canvas.findByTitle(title) as HTMLIFrameElement;
  await waitFor(() => expect(iframe.contentDocument?.readyState).toBe("complete"));
  const view = iframe.contentWindow as unknown as { __STORYBOOK_PREVIEW__?: unknown };
  const doc = iframe.contentDocument!;
  const paint = (args: Record<string, unknown>) => {
    doc.body.replaceChildren(Object.assign(doc.createElement("output"), {
      textContent: Object.entries(args).map(([key, value]) => `${key}=${String(value)}`).join(" "),
    }));
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const channel = {
    on: (event: string, listener: (payload: unknown) => void) => {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(listener);
      listeners.set(event, handlers);
    },
    off: (event: string, listener: (payload: unknown) => void) => { listeners.get(event)?.delete(listener); },
  };
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const render = { id, phase: "finished", story: { id } };
  let args: Record<string, unknown> = {};
  let theme = "light";
  let pending: (() => void) | undefined;
  const updates: string[] = [];
  const complete = () => { const next = pending; pending = undefined; next?.(); };
  const update = (kind: string) => {
    updates.push(kind);
    render.phase = "loading";
    emit("storyRenderPhaseChanged", { storyId: id, newPhase: "loading" });
    pending = () => {
      paint(args);
      doc.documentElement.setAttribute("data-theme", theme);
      render.phase = "finished";
      emit("storyRendered", id);
    };
    if (!controlled) iframe.ownerDocument.defaultView!.requestAnimationFrame(complete);
  };
  paint(args);
  Object.assign(view, {
    __STORYBOOK_ADDONS_CHANNEL__: channel,
    __STORYBOOK_PREVIEW__: {
      currentRender: render,
      onUpdateArgs: ({ updatedArgs }: { updatedArgs: Record<string, unknown> }) => {
        args = { ...args, ...updatedArgs };
        update("args");
        return Promise.resolve();
      },
      onUpdateGlobals: ({ globals }: { globals: Record<string, unknown> }) => {
        theme = String(globals.theme);
        update("globals");
        return Promise.resolve();
      },
    },
  });
  iframe.dispatchEvent(new Event("load"));
  return { doc, iframe, complete, updates };
}

const meta = {
  id: "review-library",
  title: "Review/Library",
  component: LibraryView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LibraryView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {
  tags: ["!test"],
  args: { build },
  render: (args, { globals }) => <LibraryView {...args} theme={typeof globals.theme === "string" ? globals.theme : "light"} />,
};

const section = (canvas: ReturnType<typeof within>, name: string) =>
  within(canvas.getByRole("heading", { name: new RegExp(`^${name}`) })).getByRole("button");
const search = (canvasElement: HTMLElement) => new URL(canvasElement.ownerDocument.location.href).searchParams;

export const Workspace: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error", context: { exclude: ["[data-library-story]"] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const list = await canvas.findByRole("listbox", { name: "Components" });
    await expect(canvas.getByText("1 change")).toBeVisible();
    const options = within(list).getAllByRole("option");
    await expect(options.map((option) => option.getAttribute("aria-label")))
      .toEqual(["Badge, 1 story", "Button, 4 stories, changed in this build"]);
    await expect(await canvas.findByRole("heading", { name: "Default" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();

    options[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(options[1]).toHaveAttribute("aria-selected", "true");
    await expect(options[1]).toHaveFocus();
    for (const name of ["Default", "Variants", "Sizes"]) {
      await expect(await canvas.findByRole("heading", { name })).toBeVisible();
    }
    await expect(await canvas.findByRole("button", { name: "Destructive" })).toBeVisible();
    await expect(canvas.queryByRole("form")).not.toBeInTheDocument();

    const themed = await installPreview(canvas, "Button · Loading", "ui-button--loading");
    await waitFor(() => expect(canvas.queryByText("Loading Loading…")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(themed.doc.documentElement).toHaveAttribute("data-theme", "dark"));
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(await canvas.findByRole("button", { name: "Destructive" })).toBeVisible();

    await userEvent.click(section(canvas, "Default"));
    await expect(section(canvas, "Default")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("form", { name: "Button · Default props" })).toBeVisible();
    await expect(canvas.queryByText("On click")).not.toBeInTheDocument();
    const label = canvas.getByRole("textbox", { name: "Children" });
    await userEvent.clear(label);
    await userEvent.type(label, "Send");
    await expect(await canvas.findByRole("button", { name: "Send" })).toBeVisible();
    await expect(search(canvasElement).get("component")).toBe("ui-button");
    await expect(search(canvasElement).get("story")).toBe("ui-button--default");
    await expect(JSON.parse(search(canvasElement).get("props") ?? "{}")).toEqual({ children: "Send" });

    await userEvent.keyboard("{Escape}");
    await expect(section(canvas, "Default")).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByRole("form")).not.toBeInTheDocument();
    await expect(search(canvasElement).has("story")).toBe(false);
    await expect(search(canvasElement).has("props")).toBe(false);
    await expect(canvas.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    await userEvent.click(section(canvas, "Variants"));
    await expect(search(canvasElement).get("story")).toBe("ui-button--variants");
    await userEvent.click(section(canvas, "Variants"));
    await expect(search(canvasElement).has("story")).toBe(false);

    const annotate = canvas.getByRole("button", { name: "Annotate" });
    await userEvent.click(annotate);
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    const anchor = canvas.getByRole("button", { name: "Button · Sizes" });
    await expect(anchor.closest("[data-review-story]")).toHaveAttribute("data-review-frame", "ui-button--sizes");
    anchor.focus();
    await userEvent.keyboard("{Enter}");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Light" }));
    await waitFor(() => expect(themed.doc.documentElement).toHaveAttribute("data-theme", "light"));
  },
};

export const RestoredPreview: Story = {
  args: { build: fixtureBuild, storyIndex: restoredIndex, frameSource: "blank", theme: "dark" },
  beforeEach: () => {
    const original = location.href;
    const url = new URL(original);
    url.searchParams.set("component", "ui-button");
    url.searchParams.set("story", "ui-button--loading");
    url.searchParams.set("props", JSON.stringify({ children: "RESTORED" }));
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const loading = "Loading Loading…";
    await expect(await canvas.findByRole("heading", { name: "Loading Play function" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    await expect(section(canvas, "Loading")).toHaveAttribute("aria-pressed", "true");
    const first = await installPreview(canvas, "Button · Loading", "ui-button--loading", true);
    await waitFor(() => expect(first.updates).toEqual(["globals"]));
    await expect(canvas.getByText(loading)).toBeVisible();
    first.complete();
    await waitFor(() => expect(first.updates).toEqual(["globals", "args"]));
    await expect(canvas.getByText(loading)).toBeVisible();
    const label = await canvas.findByRole("textbox", { name: "Children" });
    await userEvent.clear(label);
    await userEvent.type(label, "NEWER");
    first.complete();
    await waitFor(() => expect(first.updates).toEqual(["globals", "args", "args"]));
    await expect(canvas.getByText(loading)).toBeVisible();
    await expect(first.doc.body).toHaveTextContent("children=RESTORED");
    first.complete();
    await waitFor(() => expect(canvas.queryByText(loading)).not.toBeInTheDocument());
    await expect(first.doc.body).toHaveTextContent("children=NEWER");
    await expect(first.doc.documentElement).toHaveAttribute("data-theme", "dark");
    first.iframe.contentWindow!.location.reload();
    await waitFor(() => expect(first.iframe.contentDocument).not.toBe(first.doc));
    const reloaded = await installPreview(canvas, "Button · Loading", "ui-button--loading", true);
    await waitFor(() => expect(reloaded.updates).toEqual(["globals"]));
    await expect(canvas.getByText(loading)).toBeVisible();
    reloaded.complete();
    await waitFor(() => expect(reloaded.updates).toEqual(["globals", "args"]));
    await expect(canvas.getByText(loading)).toBeVisible();
    reloaded.complete();
    await waitFor(() => expect(canvas.queryByText(loading)).not.toBeInTheDocument());
    await expect(reloaded.doc.body).toHaveTextContent("children=NEWER");
    await expect(reloaded.doc.documentElement).toHaveAttribute("data-theme", "dark");
  },
};

export const Foundations: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const foundations = await canvas.findByRole("listbox", { name: "Foundations" });
    const color = within(foundations).getByRole("option", { name: /^Color, \d+ tokens$/ });
    await userEvent.click(color);
    await expect(color).toHaveAttribute("aria-selected", "true");
    const surface = await canvas.findByRole("main", { name: "Color foundations" });
    await expect(canvas.queryByRole("main", { name: "Badge preview" })).not.toBeInTheDocument();
    const primary = await within(surface).findByRole("row", { name: /--primary Text/ });
    const [light, dark] = within(primary).getAllByRole("cell");
    await expect(light).toHaveTextContent("#0052ff");
    await expect(dark).toHaveTextContent("#578bfa");
    await expect(light).toHaveTextContent(/Pass/);
    const url = new URL(canvasElement.ownerDocument.location.href);
    await expect(url.searchParams.get("component")).toBe("foundations/color");
    await expect(url.searchParams.get("props")).toBeNull();

    const theme = within(surface).getByRole("radiogroup", { name: "Theme" });
    await expect(within(theme).getByRole("radio", { name: "Light" })).toBeChecked();
    const lightCard = surface.style.getPropertyValue("--card");
    await expect(lightCard).not.toBe("");
    await userEvent.click(within(theme).getByRole("radio", { name: "Dark" }));
    await expect(within(theme).getByRole("radio", { name: "Dark" })).toBeChecked();
    await expect(surface).toHaveAttribute("data-foundation-theme", "dark");
    await waitFor(() => expect(surface.style.getPropertyValue("--card")).not.toBe(lightCard));
    await expect(surface).toHaveStyle({ colorScheme: "dark" });

    await userEvent.click(within(foundations).getByRole("option", { name: /^Motion, / }));
    await expect(within(surface).getByRole("heading", { name: "Motion" })).toBeVisible();
    await expect(surface).toHaveAttribute("data-foundation-theme", "dark");
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("component")).toBe("foundations/motion");
    const duration = within(surface).getByRole("row", { name: /^duration-180 / });
    await expect(duration).toHaveTextContent("0.18s");
    await expect(duration).toHaveTextContent("components/ui/drawer.tsx");
    await expect(duration).toHaveTextContent(/\d+ occurrences/);
    await expect(within(surface).getByText(/Utilities Tailwind generates from component source/)).toBeVisible();
    const easing = within(surface).getByRole("row", { name: /^ease-\[cubic-bezier\(0.22,1,0.36,1\)\]/ });
    await expect(easing).toHaveTextContent("cubic-bezier(0.22, 1, 0.36, 1)");
    await expect(within(surface).getByRole("heading", { name: /^Tokens/ })).toBeVisible();
    await userEvent.click(within(surface).getAllByRole("button", { name: /^Play / })[0]);

    await userEvent.click(within(foundations).getByRole("option", { name: /^Type, / }));
    const leading = within(surface).getByText("leading-none").closest("li")!;
    await expect(leading).toHaveTextContent(/16px · \d+ occurrences/);
    await userEvent.click(within(leading).getByText(/^Files \(/));
    await expect(within(leading).getByText("components/ui/drawer.tsx")).toBeVisible();

    await userEvent.click(canvas.getByRole("option", { name: "Badge, 1 story" }));
    await expect(await canvas.findByRole("main", { name: "Badge preview" })).toBeVisible();
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("component")).toBe("ui-badge");
  },
};

export const RestoredFoundation: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  beforeEach: () => {
    const original = location.href;
    const url = new URL(original);
    url.searchParams.set("component", "foundations/radius-spacing");
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const surface = await canvas.findByRole("main", { name: "Radius & spacing foundations" });
    await expect(within(surface).getByRole("heading", { name: "Radius & spacing", level: 2 })).toBeVisible();
    await expect(canvas.getByRole("option", { name: /^Radius & spacing, / })).toHaveAttribute("aria-selected", "true");
    await expect(within(surface).getByText("rounded-lg")).toBeVisible();
    await expect(within(surface).getByText(/Utilities Tailwind generates from component source/)).toBeVisible();
    await expect(within(surface).getByRole("columnheader", { name: "Occurrences / files" })).toBeVisible();
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("component")).toBe("foundations/radius-spacing");
    const spacing = within(surface).getByRole("row", { name: /^1\.5 / });
    await expect(within(spacing).getAllByRole("cell")[0]).toHaveTextContent(/^35Files/);
    await userEvent.click(within(spacing).getByText(/^Files \(/));
    await expect(within(spacing).getByText("components/ui/field.tsx")).toBeVisible();
  },
};
