import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readReviewBuild, type ReviewBuild, type StoryIndexEntry } from "./explorations/board/review-build";
import { LibraryView } from "./explorations/library/library";

const build = readReviewBuild(import.meta.env);

const story = (id: string, title: string, name: string, importPath: string): StoryIndexEntry =>
  ({ id, title, name, importPath, type: "story" });
const fixtureIndex: Record<string, StoryIndexEntry> = Object.fromEntries([
  story("ui-button--default", "UI/Button", "Default", "./components/ui/button.stories.tsx"),
  story("ui-button--variants", "UI/Button", "Variants", "./components/ui/button.stories.tsx"),
  story("ui-badge--default", "UI/Badge", "Default", "./components/ui/badge.stories.tsx"),
  story("ui-address-field--empty", "UI/Address Field", "Empty", "./components/address-field.stories.tsx"),
  story("review-boards--changes", "Review/Boards", "Changes", "./stories/review/review-boards.stories.tsx"),
].map((entry) => [entry.id, entry]));
const fixtureBuild: ReviewBuild = {
  revision: "fixture", deployment: "", branch: "", repo: null, pr: null,
  changedFiles: ["apps/web/components/ui/button.tsx"],
};
const fixtureStories: Record<string, { argTypes: Record<string, unknown>; initialArgs: Record<string, unknown> }> = {
  "ui-button--default": {
    argTypes: { children: { control: { type: "text" } }, loading: { control: { type: "boolean" } },
      onClick: { type: { name: "function" } } },
    initialArgs: { children: "Continue" },
  },
  "ui-badge--default": {
    argTypes: { variant: { control: { type: "select" }, options: ["default", "outline"] } },
    initialArgs: { variant: "default" },
  },
};

async function installPreview(canvas: ReturnType<typeof within>, title: string, id: string) {
  const iframe = await canvas.findByTitle(title) as HTMLIFrameElement;
  await waitFor(() => expect(iframe.contentDocument?.readyState).toBe("complete"));
  const view = iframe.contentWindow as unknown as { __STORYBOOK_PREVIEW__?: unknown };
  const doc = iframe.contentDocument!;
  const paint = (args: Record<string, unknown>) => {
    doc.body.replaceChildren(Object.assign(doc.createElement("output"), {
      textContent: Object.entries(args).map(([key, value]) => `${key}=${String(value)}`).join(" "),
    }));
  };
  view.__STORYBOOK_PREVIEW__ = {
    currentRender: { id, story: { id, ...fixtureStories[id] } },
    onUpdateArgs: ({ updatedArgs }: { updatedArgs: Record<string, unknown> }) => paint(updatedArgs),
    onUpdateGlobals: ({ globals }: { globals: Record<string, unknown> }) => doc.documentElement.setAttribute("data-theme", String(globals.theme)),
  };
  iframe.dispatchEvent(new Event("load"));
  return doc;
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

export const Workspace: Story = {
  args: { build: fixtureBuild, storyIndex: fixtureIndex, frameSource: "blank" },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const list = await canvas.findByRole("listbox", { name: "Components" });
    await expect(canvas.getByText("1 change")).toBeVisible();
    const options = within(list).getAllByRole("option");
    await expect(options.map((option) => option.getAttribute("aria-label")))
      .toEqual(["Badge, 1 story", "Button, 2 stories, changed in this build"]);
    const badgeDoc = await installPreview(canvas, "Badge · Default", "ui-badge--default");
    const variant = await canvas.findByRole("combobox", { name: "Variant" });
    await userEvent.selectOptions(variant, "outline");
    await waitFor(() => expect(badgeDoc.body).toHaveTextContent("variant=outline"));
    await expect(new URL(canvasElement.ownerDocument.location.href).searchParams.get("props")).toBe('{"variant":"outline"}');

    options[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(options[1]).toHaveAttribute("aria-selected", "true");
    await expect(options[1]).toHaveFocus();
    const buttonDoc = await installPreview(canvas, "Button · Default", "ui-button--default");
    const label = await canvas.findByRole("textbox", { name: "Children" });
    await expect(canvas.queryByRole("combobox", { name: "Variant" })).not.toBeInTheDocument();
    await expect(canvas.queryByText("On click")).not.toBeInTheDocument();
    await userEvent.clear(label);
    await userEvent.type(label, "Send");
    await waitFor(() => expect(buttonDoc.body).toHaveTextContent("children=Send"));
    await userEvent.click(canvas.getByRole("switch", { name: "Loading" }));
    await waitFor(() => expect(buttonDoc.body).toHaveTextContent("loading=true"));
    const url = new URL(canvasElement.ownerDocument.location.href);
    await expect(url.searchParams.get("component")).toBe("ui-button");
    await expect(JSON.parse(url.searchParams.get("props") ?? "{}")).toEqual({ children: "Send", loading: true });

    const annotate = canvas.getByRole("button", { name: "Annotate" });
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(annotate);
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    const anchor = canvas.getByRole("button", { name: "Button · Default · Changed · 390 × 844" });
    await expect(anchor).toHaveAttribute("data-review-story", "ui-button--default");
    await expect(canvas.getByTitle("Button · Default")).toHaveAttribute("inert");
    anchor.focus();
    await userEvent.keyboard("{Enter}");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByTitle("Button · Default")).not.toHaveAttribute("inert");
  },
};
