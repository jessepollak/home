import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readReviewBuild, type ReviewBuild, type StoryIndexEntry } from "./explorations/board/review-build";
import { LibraryView } from "./explorations/library/library";
import { specimens } from "./explorations/library/overview/specimens";

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

const section = (canvas: { getByRole: (role: "heading", options: { name: RegExp }) => HTMLElement }, name: string) =>
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
    await userEvent.click(options[0]);
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

    await expect(canvas.queryByTitle("Button · Loading")).not.toBeInTheDocument();
    const defaultSection = section(canvas, "Default").closest("section");
    if (!defaultSection) throw new Error("Default section is missing");
    await userEvent.click(within(defaultSection).getByRole("button", { name: "Continue" }));
    await expect(canvas.queryByRole("form")).not.toBeInTheDocument();
    canvas.getByRole("button", { name: "Primary" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.queryByRole("form")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(search(canvasElement).get("theme")).toBe("dark"));
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
    await userEvent.click(annotate);
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    canvas.getByRole("button", { name: "Button · Sizes" }).focus();
    await userEvent.keyboard(" ");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Light" }));
    await expect(canvas.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(search(canvasElement).get("theme")).toBe("light"));
  },
};

const overviewIndex = indexOf([
  ...fixtureEntries,
  story("ui-switch--default", "UI/Switch", "Default", "./components/ui/switch.stories.tsx"),
]);

export const Overview: Story = {
  args: { build: fixtureBuild, storyIndex: overviewIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error" } },
  beforeEach: () => {
    const original = location.href;
    const url = new URL(original);
    for (const key of ["component", "story", "props"]) url.searchParams.delete(key);
    url.searchParams.set("theme", "light");
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const surface = await canvas.findByRole("main", { name: "Library overview" });
    await expect(canvas.getByRole("option", { name: "Overview, 3 components" })).toHaveAttribute("aria-selected", "true");
    await expect(search(canvasElement).has("component")).toBe(false);
    const grid = within(surface).getByRole("region", { name: "All components" });
    await expect(within(grid).getByRole("button", { name: "Badge" })).toBeVisible();

    const toggle = within(grid).getByRole("switch", { name: "Show small balances" });
    const checked = toggle.getAttribute("aria-checked");
    await userEvent.click(toggle);
    await expect(toggle).not.toHaveAttribute("aria-checked", checked ?? "");
    await expect(canvas.getByRole("main", { name: "Library overview" })).toBeVisible();
    await expect(search(canvasElement).has("component")).toBe(false);
    await userEvent.click(within(grid).getByRole("button", { name: "Deposit" }));
    await expect(canvas.getByRole("main", { name: "Library overview" })).toBeVisible();

    const window = canvasElement.ownerDocument.defaultView;
    if (!window) throw new Error("Library window is missing");
    const navigation = window.history;
    const historyLength = navigation.length;
    await userEvent.click(within(grid).getByRole("button", { name: "Button" }));
    await expect(await canvas.findByRole("main", { name: "Button preview" })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Default" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    await expect(search(canvasElement).get("component")).toBe("ui-button");
    await expect(canvas.getByRole("option", { name: "Button, 4 stories, changed in this build" })).toHaveAttribute("aria-selected", "true");
    await expect(navigation.length).toBe(historyLength + 1);
    await userEvent.click(section(canvas, "Default"));
    await expect(search(canvasElement).get("story")).toBe("ui-button--default");
    await expect(navigation.length).toBe(historyLength + 1);
    navigation.back();
    await waitFor(() => expect(canvas.getByRole("main", { name: "Library overview" })).toBeVisible());
    await expect(search(canvasElement).has("component")).toBe(false);
    navigation.forward();
    await waitFor(() => expect(canvas.getByRole("main", { name: "Button preview" })).toBeVisible());
    await expect(await canvas.findByRole("form", { name: "Button · Default props" })).toBeVisible();
    await expect(search(canvasElement).get("story")).toBe("ui-button--default");

    await userEvent.click(canvas.getByRole("option", { name: "Overview, 3 components" }));
    await expect(await canvas.findByRole("main", { name: "Library overview" })).toBeVisible();
    await expect(search(canvasElement).has("component")).toBe(false);
    await userEvent.click(within(canvas.getByRole("region", { name: "All components" })).getByRole("button", { name: /^Color/ }));
    await expect(await canvas.findByRole("main", { name: "Color foundations" })).toBeVisible();
  },
};

const ownedStoryMetas = import.meta.glob(
  "../../components/ui/*.stories.tsx", { eager: true, import: "default" },
);
const fullOverviewIndex = indexOf(Object.entries(ownedStoryMetas).map(([path, meta]) => {
  if (!meta || typeof meta !== "object" || !("id" in meta) || typeof meta.id !== "string" ||
    !("title" in meta) || typeof meta.title !== "string") throw new Error(`Invalid component meta: ${path}`);
  return story(`${meta.id}--default`, meta.title, "Default", `./components/ui/${path.split("/").at(-1)}`);
}));

export const OverviewGrid: Story = {
  args: { build: fixtureBuild, storyIndex: fullOverviewIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error", context: "[data-library-overview]" } },
  beforeEach: Overview.beforeEach,
  play: async ({ canvasElement }) => {
    const surface = await within(canvasElement).findByRole("main", { name: "Library overview" });
    await expect([...surface.querySelectorAll("[data-library-specimen]")].map((card) => card.getAttribute("data-library-specimen")).sort())
      .toEqual(Object.keys(specimens).sort());
    await expect(within(surface).queryByText(/^Couldn't render/)).not.toBeInTheDocument();
  },
};

const compositionsIndex = indexOf([
  ...Object.values(fullOverviewIndex),
  story("compositions-home--home", "Compositions/Home", "Home", "./stories/review/compositions/home.stories.tsx"),
  story("compositions-home--home-loading", "Compositions/Home", "Home Loading", "./stories/review/compositions/home.stories.tsx"),
  story("compositions-invest--invest", "Compositions/Invest", "Invest", "./stories/review/compositions/invest.stories.tsx"),
  story("compositions-invest--search-to-orbit-detail", "Compositions/Invest", "Orbit Detail", "./stories/review/compositions/invest.stories.tsx"),
  story("compositions-card-onboarding--card-onboarding", "Compositions/Card Onboarding", "Card Onboarding", "./stories/review/compositions/card-onboarding.stories.tsx"),
  story("compositions-card-onboarding--active", "Compositions/Card Onboarding", "Active", "./stories/review/compositions/card-onboarding.stories.tsx"),
  story("compositions-coverage--coverage", "Compositions/Coverage", "Coverage", "./stories/review/compositions/coverage.stories.tsx"),
  story("compositions-operator--operator", "Compositions/Operator", "Operator", "./stories/review/compositions/operator.stories.tsx"),
]);

export const Compositions: Story = {
  args: { build: fixtureBuild, storyIndex: compositionsIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error" } },
  beforeEach: Overview.beforeEach,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await canvas.findByRole("main", { name: "Library overview" });
    const window = canvasElement.ownerDocument.defaultView;
    if (!window) throw new Error("Library window is missing");
    const historyLength = window.history.length;
    await userEvent.click(canvas.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(search(canvasElement).get("theme")).toBe("dark"));
    await userEvent.click(canvas.getByRole("option", { name: /^Button,/ }));
    await canvas.findByRole("main", { name: "Button preview" });
    await canvas.findByRole("heading", { name: "Default" }, { timeout: INITIAL_MODULE_TIMEOUT });
    await userEvent.click(section(canvas, "Default"));
    await waitFor(() => expect(search(canvasElement).get("story")).toBe("ui-button--default"));
    await userEvent.click(canvas.getByRole("option", { name: "Compositions, 5 compositions" }));
    const surface = await canvas.findByRole("main", { name: "Library compositions" });
    await expect(within(surface).getByText("Compositions · 5 compositions")).toBeVisible();
    await expect(await within(surface).findByRole("link", { name: "Button Group" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    await expect(within(surface).getByRole("link", { name: "Dialog" })).toBeVisible();
    await expect(within(surface).getByText(/^Not used in any product screen:/)).toHaveTextContent("Not used in any product screen: Button Group, Dialog, Kbd, Progress");
    await expect(search(canvasElement).get("component")).toBe("compositions");
    await expect(window.history.length).toBe(historyLength + 2);
    for (const name of ["Home", "Home Loading", "Invest", "Orbit Detail", "Card Onboarding", "Active", "Coverage", "Operator"]) {
      await expect(await within(surface).findByRole("heading", { name }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    }
    await userEvent.keyboard("{PageDown}");
    section(canvas, "Card Onboarding").scrollIntoView();
    await expect(await within(surface).findByTitle("Compositions · Card Onboarding", {}, { timeout: INITIAL_MODULE_TIMEOUT }))
      .toHaveAttribute("width", "390");
    await expect(within(surface).queryByRole("alert")).not.toBeInTheDocument();
    await expect(within(surface).getAllByRole("link", { name: /^390 × 844/ })).toHaveLength(4);
    await expect(within(surface).getAllByRole("link", { name: /^1280 × 800/ })).toHaveLength(3);
    await expect(within(surface).getByRole("link", { name: /^1440 × 900/ })).toBeVisible();
    await userEvent.click(section(canvas, "Card Onboarding"));
    await expect(search(canvasElement).get("story")).toBe("compositions-card-onboarding--card-onboarding");
    await expect(window.history.length).toBe(historyLength + 2);
    window.history.back();
    await canvas.findByRole("main", { name: "Button preview" });
    await expect(await canvas.findByRole("form", { name: "Button · Default props" })).toBeVisible();
    window.history.back();
    await canvas.findByRole("main", { name: "Library overview" });
    await expect(search(canvasElement).has("story")).toBe(false);
    window.history.forward();
    await canvas.findByRole("main", { name: "Button preview" });
    await expect(await canvas.findByRole("form", { name: "Button · Default props" })).toBeVisible();
    window.history.forward();
    await canvas.findByRole("main", { name: "Library compositions" });
    await waitFor(() => expect(search(canvasElement).get("story")).toBe("compositions-card-onboarding--card-onboarding"));
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(search(canvasElement).get("theme")).toBe("dark");
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
    url.searchParams.set("theme", "dark");
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByRole("heading", { name: "Loading" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    await expect(section(canvas, "Loading")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.queryByTitle("Button · Loading")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "RESTORED" })).toHaveAttribute("aria-busy", "true");
    const label = await canvas.findByRole("textbox", { name: "Children" });
    await userEvent.clear(label);
    await userEvent.type(label, "NEWER");
    await expect(canvas.getByRole("button", { name: "NEWER" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(search(canvasElement).get("theme")).toBe("dark");
    await expect(JSON.parse(search(canvasElement).get("props") ?? "{}")).toEqual({ children: "NEWER" });
  },
};

export const Foundations: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error" } },
  beforeEach: () => {
    const original = location.href;
    const url = new URL(original);
    url.searchParams.set("theme", "light");
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
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

    const theme = within(surface).getByRole("group", { name: "Theme" });
    await expect(within(theme).getAllByRole("button")).toHaveLength(2);
    await expect(within(theme).getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(theme).getByRole("button", { name: "Dark" }));
    await expect(within(theme).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(surface.querySelector("[data-foundation]")).toHaveAttribute("data-foundation-theme", "dark");
    await expect(search(canvasElement).get("theme")).toBe("dark");

    await userEvent.click(within(foundations).getByRole("option", { name: /^Motion, / }));
    await expect(within(surface).getByRole("heading", { name: "Motion" })).toBeVisible();
    await expect(surface.querySelector("[data-foundation]")).toHaveAttribute("data-foundation-theme", "dark");
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
    const leading = within(surface).getByText("leading-none").closest("li");
    if (!leading) throw new Error("Leading reference is missing");
    await expect(leading).toHaveTextContent(/16px · \d+ occurrences/);
    await userEvent.click(within(leading).getByText(/^Files \(/));
    await expect(within(leading).getByText("components/ui/drawer.tsx")).toBeVisible();

    await userEvent.click(canvas.getByRole("option", { name: "Button, 4 stories, changed in this build" }));
    await expect(await canvas.findByRole("main", { name: "Button preview" })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Default" }, { timeout: INITIAL_MODULE_TIMEOUT })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(search(canvasElement).get("component")).toBe("ui-button");
    await expect(search(canvasElement).get("theme")).toBe("dark");
    await userEvent.click(color);
    await expect(canvas.getByRole("main", { name: "Color foundations" })).toBeVisible();
    await expect(surface.querySelector("[data-foundation]")).toHaveAttribute("data-foundation-theme", "dark");
    await expect(canvas.getAllByRole("button", { name: "Dark" })).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Light" }));
    await expect(surface.querySelector("[data-foundation]")).toHaveAttribute("data-foundation-theme", "light");
    await expect(search(canvasElement).get("theme")).toBe("light");
  },
};

export const RestoredFoundation: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  beforeEach: () => {
    const original = location.href;
    const url = new URL(original);
    url.searchParams.set("component", "foundations/radius-spacing");
    url.searchParams.set("theme", "dark");
    history.replaceState(history.state, "", url);
    return () => history.replaceState(history.state, "", original);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const surface = await canvas.findByRole("main", { name: "Radius & spacing foundations" });
    await expect(canvas.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(surface.querySelector("[data-foundation]")).toHaveAttribute("data-foundation-theme", "dark");
    await expect(within(surface).getByRole("heading", { name: "Radius & spacing", level: 2 })).toBeVisible();
    await expect(canvas.getByRole("option", { name: /^Radius & spacing, / })).toHaveAttribute("aria-selected", "true");
    await expect(within(surface).getByText("rounded-lg")).toBeVisible();
    await expect(within(surface).getByText(/Utilities Tailwind generates from component source/)).toBeVisible();
    await expect(within(surface).getByRole("columnheader", { name: "Occurrences / files" })).toBeVisible();
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("component")).toBe("foundations/radius-spacing");
    const spacing = within(surface).getByRole("row", { name: /^1\.5 / });
    await expect(within(spacing).getAllByRole("cell")[0]).toHaveTextContent(/^[1-9]\d*Files \([1-9]\d*\)/);
    await userEvent.click(within(spacing).getByText(/^Files \(/));
    await expect(within(spacing).getByText("components/ui/field.tsx")).toBeVisible();
  },
};
