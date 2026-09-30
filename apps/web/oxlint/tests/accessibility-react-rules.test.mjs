import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-accessibility-react-"));
await mkdir(path.join(mirror, "client"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
const source = await readFile(path.join(appsWebDir, ".oxlintrc.jsonc"), "utf8");
const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: config.plugins.filter((plugin) => plugin === "react" || plugin === "jsx-a11y"),
  categories: { correctness: "off" },
  options: { reportUnusedDisableDirectives: "error" },
  rules: Object.fromEntries(Object.entries(config.rules).filter(([rule]) =>
    rule.startsWith("jsx-a11y/") || rule.startsWith("react/"))),
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function diagnostics(fixtures, enabledRules = []) {
  const files = await Promise.all(Object.entries(fixtures).map(async ([name, code]) => {
    const file = `client/${name}.tsx`;
    await writeFile(path.join(mirror, file), code);
    return file;
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", ...enabledRules.flatMap((rule) => ["-D", rule]), ...files],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect(result.error).toBeUndefined();
  return JSON.parse(result.stdout).diagnostics;
}

const selectedRules = [
  "jsx-a11y/anchor-ambiguous-text",
  "jsx-a11y/anchor-has-content",
  "jsx-a11y/anchor-is-valid",
  "jsx-a11y/aria-activedescendant-has-tabindex",
  "jsx-a11y/aria-role",
  "jsx-a11y/autocomplete-valid",
  "jsx-a11y/click-events-have-key-events",
  "jsx-a11y/control-has-associated-label",
  "jsx-a11y/heading-has-content",
  "jsx-a11y/html-has-lang",
  "jsx-a11y/iframe-has-title",
  "jsx-a11y/img-redundant-alt",
  "jsx-a11y/interactive-supports-focus",
  "jsx-a11y/label-has-associated-control",
  "jsx-a11y/lang",
  "jsx-a11y/media-has-caption",
  "jsx-a11y/mouse-events-have-key-events",
  "jsx-a11y/no-access-key",
  "jsx-a11y/no-aria-hidden-on-focusable",
  "jsx-a11y/no-distracting-elements",
  "jsx-a11y/no-interactive-element-to-noninteractive-role",
  "jsx-a11y/no-noninteractive-element-interactions",
  "jsx-a11y/no-noninteractive-element-to-interactive-role",
  "jsx-a11y/no-noninteractive-tabindex",
  "jsx-a11y/no-redundant-roles",
  "jsx-a11y/scope",
  "jsx-a11y/tabindex-no-positive",
  "react/no-array-index-key",
  "react/no-unstable-nested-components",
  "react/jsx-no-constructed-context-values",
];

const bad = {
  positiveTab: ["jsx-a11y(tabindex-no-positive)", 'export const View = () => <button tabIndex={2}>Open</button>;'],
  ambiguousAnchor: ["jsx-a11y(anchor-ambiguous-text)", 'export const View = () => <a href="/help">Click here</a>;'],
  noninteractiveTab: ["jsx-a11y(no-noninteractive-tabindex)", 'export const View = () => <div tabIndex={0}>Value</div>;'],
  missingLabel: ["jsx-a11y(label-has-associated-control)", 'export const View = () => <label>Amount</label>;'],
  unnamedControl: ["jsx-a11y(control-has-associated-label)", 'export const View = () => <button type="button" />;'],
  emptyHeading: ["jsx-a11y(heading-has-content)", 'export const View = () => <h2 />;'],
  invalidAnchor: ["jsx-a11y(anchor-is-valid)", 'export const View = () => <a href="#">Details</a>;'],
  activeDescendant: ["jsx-a11y(aria-activedescendant-has-tabindex)", 'export const View = () => <div role="listbox" aria-activedescendant="item" />;'],
  invalidAutocomplete: ["jsx-a11y(autocomplete-valid)", 'export const View = () => <input autoComplete="not-a-token" />;'],
  mouseOnlyClick: ["jsx-a11y(click-events-have-key-events)", 'export const View = () => <div onClick={() => {}}>Open</div>;'],
  missingHtmlLang: ["jsx-a11y(html-has-lang)", 'export const View = () => <html><body /></html>;'],
  untitledFrame: ["jsx-a11y(iframe-has-title)", 'export const View = () => <iframe src="https://example.com" />;'],
  redundantAlt: ["jsx-a11y(img-redundant-alt)", 'export const View = () => <img src="cat.png" alt="Image of a cat" />;'],
  unfocusableInteractive: ["jsx-a11y(interactive-supports-focus)", 'export const View = () => <div role="button" onClick={() => {}}>Open</div>;'],
  invalidLang: ["jsx-a11y(lang)", 'export const View = () => <html lang="!invalid"><body /></html>;'],
  captionlessVideo: ["jsx-a11y(media-has-caption)", 'export const View = () => <video src="movie.mp4" />;'],
  mouseOnlyHover: ["jsx-a11y(mouse-events-have-key-events)", 'export const View = () => <div onMouseOver={() => {}}>Open</div>;'],
  accessKey: ["jsx-a11y(no-access-key)", 'export const View = () => <button accessKey="o">Open</button>;'],
  hiddenFocusable: ["jsx-a11y(no-aria-hidden-on-focusable)", 'export const View = () => <button aria-hidden="true">Open</button>;'],
  distractingElement: ["jsx-a11y(no-distracting-elements)", 'export const View = () => <marquee>News</marquee>;'],
  interactiveAsNoninteractive: ["jsx-a11y(no-interactive-element-to-noninteractive-role)", 'export const View = () => <button role="article">Open</button>;'],
  noninteractiveClick: ["jsx-a11y(no-noninteractive-element-interactions)", 'export const View = () => <article onClick={() => {}}>Open</article>;'],
  noninteractiveAsInteractive: ["jsx-a11y(no-noninteractive-element-to-interactive-role)", 'export const View = () => <h2 role="button">Open</h2>;'],
  redundantRole: ["jsx-a11y(no-redundant-roles)", 'export const View = () => <button role="button">Open</button>;'],
  invalidScope: ["jsx-a11y(scope)", 'export const View = () => <div scope="col">Heading</div>;'],
  emptyAnchor: ["jsx-a11y(anchor-has-content)", 'export const View = () => <a href="/details" />;'],
  invalidRole: ["jsx-a11y(aria-role)", 'export const View = () => <div role="not-a-role" />;'],
  indexKey: ["react(no-array-index-key)", 'export const View = ({ entries }) => <ul>{entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>;'],
  nestedComponent: ["react(no-unstable-nested-components)", 'export function View() { function Nested() { return <p>Content</p>; } return <Nested />; }'],
  constructedContext: ["react(jsx-no-constructed-context-values)", 'import { createContext } from "react"; const Context = createContext({ value: 0 }); export const View = () => <Context.Provider value={{ value: 1 }}><p>Content</p></Context.Provider>;'],
};

describe("selected accessibility and React lint rules", () => {
  it("keeps every selected rule enabled at error with a negative fixture", () => {
    expect(selectedRules).toHaveLength(30);
    const fixtureRules = Object.values(bad).map(([rule]) => rule.replace("(", "/").replace(")", ""));
    expect(fixtureRules.sort()).toEqual([...selectedRules].sort());
    for (const rule of selectedRules) {
      const setting = config.rules[rule];
      expect(Array.isArray(setting) ? setting[0] : setting).toBe("error");
    }
  });

  it("does not disable selected rules in a path override", () => {
    for (const override of config.overrides ?? []) {
      for (const rule of selectedRules) {
        const setting = override.rules?.[rule];
        expect(Array.isArray(setting) ? setting[0] : setting).not.toBe("off");
        expect(Array.isArray(setting) ? setting[0] : setting).not.toBe(0);
      }
    }
  });

  it("rejects minimal violations of every selected accessibility and React rule", async () => {
    const found = await diagnostics(Object.fromEntries(Object.entries(bad).map(([name, [, code]]) => [name, code])));
    const missing = Object.entries(bad).filter(([name, [rule]]) =>
      !found.some((item) => item.filename.endsWith(`/${name}.tsx`) && item.code === rule));
    expect(missing).toEqual([]);
  });

  it("allows owned controls inside labels, stable keys, and memoized context values", async () => {
    const found = await diagnostics({
      ownedLabels: 'import { Input, NativeSelect, Switch } from "./owned"; export const View = () => <><label>Name<Input /></label><label>Region<NativeSelect /></label><label>Enabled<Switch /></label></>;',
      stableKey: 'export const View = ({ entries }) => <ul>{entries.map((entry) => <li key={entry.id}>{entry.name}</li>)}</ul>;',
      memoizedContext: 'import { createContext, useMemo } from "react"; const Context = createContext({ value: 0 }); export function View({ value }) { const context = useMemo(() => ({ value }), [value]); return <Context.Provider value={context}><p>Content</p></Context.Provider>; }',
    });
    expect(found).toHaveLength(0);
  });

  it("accepts a reasoned, targeted disable for a positional key", async () => {
    const found = await diagnostics({
      justified: 'export const View = ({ chars }) => <p>{chars.map((char, index) => (\n// oxlint-disable-next-line react/no-array-index-key -- Character position identifies the displayed segment.\n<span key={index}>{char}</span>))}</p>;',
    });
    expect(found).toHaveLength(0);
  });

  it("leaves prefer-tag-over-role, no-autofocus and no-static-element-interactions off", async () => {
    const fixture = { deliberatelyOff: 'export const View = ({ role }) => <><div role="navigation">Navigation</div><input autoFocus aria-label="First field" /><div role={role} tabIndex={0} onClick={() => {}} onKeyDown={() => {}}>Explore</div></>;' };
    expect(await diagnostics(fixture)).toHaveLength(0);
    const offRules = ["jsx-a11y/prefer-tag-over-role", "jsx-a11y/no-autofocus", "jsx-a11y/no-static-element-interactions"];
    const enabled = await diagnostics(fixture, offRules);
    for (const rule of offRules) {
      expect(enabled.some((item) => item.code === `jsx-a11y(${rule.split("/")[1]})`)).toBe(true);
    }
  });
});
