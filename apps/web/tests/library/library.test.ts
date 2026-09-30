import { describe, expect, test } from "bun:test";
import { libraryCatalog, monogram } from "../../stories/review/explorations/library/catalog";
import { inputPropValue, propControls, propLabel, storyArgs } from "../../stories/review/explorations/library/controls";
import { readLibraryUrl, writeLibraryUrl } from "../../stories/review/explorations/library/url-state";
import type { ReviewBuild, StoryIndexEntry } from "../../stories/review/explorations/board/review-build";

const entry = (id: string, title: string, name: string, importPath: string, type = "story"): StoryIndexEntry =>
  ({ id, title, name, importPath, type });
const entries = Object.fromEntries([
  entry("ui-button--sizes", "UI/Button", "Sizes", "./components/ui/button.stories.tsx"),
  entry("ui-button--default", "UI/Button", "Default", "./components/ui/button.stories.tsx"),
  entry("ui-button--docs", "UI/Button", "Docs", "./components/ui/button.stories.tsx", "docs"),
  entry("ui-toggle-group--vertical", "UI/Toggle Group", "Vertical", "./components/ui/toggle-group.stories.tsx"),
  entry("ui-address-field--empty", "UI/Address Field", "Empty", "./components/address-field.stories.tsx"),
  entry("explorations-textarea--default", "Explorations/Textarea", "Default", "./components/ui/textarea.stories.tsx"),
].map((item) => [item.id, item]));
const build: ReviewBuild = { revision: "abc", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };

describe("library catalog", () => {
  test("lists owned UI components once with their primary story", () => {
    const catalog = libraryCatalog(entries, build);
    expect(catalog.items.map(({ id, name, story, stories }) => ({ id, name, story, stories }))).toEqual([
      { id: "ui-button", name: "Button", story: "ui-button--default", stories: 2 },
      { id: "ui-toggle-group", name: "Toggle Group", story: "ui-toggle-group--vertical", stories: 1 },
    ]);
  });

  test("reports no change count when the build has no change data", () => {
    expect(libraryCatalog(entries, build).changes).toBeNull();
  });

  test("marks components whose source or stories changed", () => {
    const catalog = libraryCatalog(entries, { ...build, changedFiles: ["apps/web/components/ui/toggle-group.tsx"] });
    expect(catalog.changes).toBe(1);
    expect(catalog.items.filter((item) => item.changed).map((item) => item.id)).toEqual(["ui-toggle-group"]);
    expect(libraryCatalog(entries, { ...build, changedFiles: [] }).changes).toBe(0);
  });

  test("derives tile monograms from component names", () => {
    expect(["Button", "Toggle Group", "InputOTP", "RadioGroup"].map(monogram)).toEqual(["B", "TG", "IO", "RG"]);
  });
});

describe("library props", () => {
  test("builds controls from real arg types and skips non-editable args", () => {
    const controls = propControls({
      children: { control: { type: "text" } },
      loading: { control: { type: "boolean" } },
      variant: { control: { type: "object" }, table: { defaultValue: { summary: "\"default\"" } } },
      tone: { control: { type: "select" }, options: ["calm", "loud"] },
      max: { control: { type: "number" } },
      onClick: { type: { name: "function" } },
      hidden: { control: false },
      style: { control: { type: "object" } },
      icon: { control: { type: "text" } },
    }, { children: "Continue", icon: { type: "svg" } });
    expect(controls).toEqual([
      { name: "children", kind: "text", initial: "Continue", enumLike: false },
      { name: "loading", kind: "boolean", initial: undefined },
      { name: "variant", kind: "text", initial: "default", enumLike: true },
      { name: "tone", kind: "select", options: ["calm", "loud"], initial: undefined },
      { name: "max", kind: "number", initial: undefined },
    ]);
  });

  test("applies overrides over initial args and restores removed ones", () => {
    const controls = propControls({ children: { control: "text" }, loading: { control: "boolean" } }, { children: "Continue" });
    expect(storyArgs(controls, { children: "Continue" }, { loading: true })).toEqual({ children: "Continue", loading: true });
    expect(storyArgs(controls, { children: "Continue" }, {})).toEqual({ children: "Continue", loading: undefined });
  });

  test("clearing enum-like inputs removes the override while text keeps empty strings", () => {
    const controls = propControls({
      variant: { control: "object", table: { defaultValue: { summary: '"default"' } } },
      children: { control: "text" },
    }, { children: "Continue" });
    const variant = controls.find((control) => control.name === "variant")!;
    const children = controls.find((control) => control.name === "children")!;
    if (variant.kind !== "text" || children.kind !== "text") throw new Error("Missing text controls");
    expect(inputPropValue(variant, "secondary")).toBe("secondary");
    expect(inputPropValue(variant, "")).toBeUndefined();
    expect(storyArgs(controls, { children: "Continue" }, {})).toEqual({ variant: undefined, children: "Continue" });
    expect(inputPropValue(children, "")).toBe("");
  });

  test("labels props in sentence case", () => {
    expect(["variant", "aria-label", "showConnector", "className"].map(propLabel))
      .toEqual(["Variant", "Aria label", "Show connector", "Class name"]);
  });
});

describe("library links", () => {
  test("round-trips the selected component and primitive props", () => {
    const original = new URL("https://example.test/iframe.html?id=review-library--library&viewMode=story&rev=abc");
    const updated = writeLibraryUrl(original, { component: "ui-button", props: { variant: "outline", loading: true, max: 3 } });
    expect(updated.searchParams.get("id")).toBe("review-library--library");
    expect(updated.searchParams.get("rev")).toBe("abc");
    expect(readLibraryUrl(updated)).toEqual({ component: "ui-button", props: { variant: "outline", loading: true, max: 3 } });
    expect(writeLibraryUrl(updated, { props: {} }).searchParams.has("props")).toBe(false);
  });

  test("keeps the theme when navigating between foundations and components", () => {
    const color = writeLibraryUrl(new URL("https://example.test/iframe.html?id=review-library--library"),
      { component: "foundations/color", theme: "dark" });
    const button = writeLibraryUrl(color, { component: "ui-button", story: "ui-button--default" });
    const restored = writeLibraryUrl(button, { component: "foundations/color", story: undefined });
    expect(readLibraryUrl(restored).theme).toBe("dark");
    expect(readLibraryUrl(writeLibraryUrl(restored, { theme: "light" })).theme).toBe("light");
    expect(readLibraryUrl(new URL("https://example.test/?theme=system")).theme).toBeUndefined();
    expect(writeLibraryUrl(restored, { theme: undefined }).searchParams.has("theme")).toBe(false);
  });

  test("ignores malformed or non-primitive props", () => {
    expect(readLibraryUrl(new URL("https://example.test/?props=%7Bbad")).props).toEqual({});
    expect(readLibraryUrl(new URL(`https://example.test/?props=${encodeURIComponent('{"a":{"b":1},"c":"d"}')}`)).props)
      .toEqual({ c: "d" });
  });
});
