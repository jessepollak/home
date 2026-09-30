import { expect, test } from "bun:test";
import { componentModulePaths, frameReason, readPortalRule, resolveComponentPath, type ImportEntry, type LibraryImports } from "@/stories/review/explorations/library/isolation";

const key = "../../../../components/ui/probe.stories.tsx";
const button = "../../../../components/ui/button.tsx";
const dialog = "../../../../components/ui/dialog.tsx";
const entry = (specifiers: string[] = [], patch: Partial<ImportEntry> = {}): ImportEntry => ({ specifiers, nonLiteralDynamic: false, lexFailure: false, ...patch });
const payload = (specifiers: string[] = []): LibraryImports => ({ [key]: entry(specifiers), [button]: entry(), [dialog]: entry() });
const sources = () => ({ [key]: async () => "<Button />", [button]: async () => "<Button />", [dialog]: async () => "<Primitive.Portal />" });
const unreadable = { portals: false, sourceReadable: false };

function assertUnreadable(rule: { portals: boolean; sourceReadable: boolean }) {
  expect(rule).toEqual(unreadable);
  expect(frameReason({}, {}, rule.portals, rule.sourceReadable)).toBe("Couldn't read component source");
}

test("decoded relative, aliased, side-effect and export-from UI edges normalize without a component roster", () => {
  expect(componentModulePaths(["./drawer", "@/components/ui/button", "../ui/dialog.tsx", "./button", "@/client/money-modal"], key))
    .toEqual(["components/ui/drawer", "components/ui/button", "components/ui/dialog.tsx"]);
});

test("source resolution tries exact keys, extension substitution and one-level indexes", () => {
  const base = "../../../../components/ui/dialog";
  expect(resolveComponentPath(`${base}.js`, [`${base}.js`, `${base}.tsx`])).toBe(`${base}.js`);
  for (const extension of ["", ".js", ".jsx", ".ts", ".tsx"]) {
    expect(resolveComponentPath(`${base}${extension}`, [`${base}.tsx`])).toBe(`${base}.tsx`);
  }
  expect(resolveComponentPath(`${base}.js`, [`${base}.ts`])).toBe(`${base}.ts`);
  expect(resolveComponentPath(base, [`${base}/index.tsx`])).toBe(`${base}/index.tsx`);
  expect(resolveComponentPath(base, [])).toBeUndefined();
  expect(resolveComponentPath(`${base}.unknown`, [`${base}.unknown.tsx`])).toBeUndefined();
});

test("a decoded .js import reads the existing TSX portal component", async () => {
  expect(await readPortalRule(key, sources(), payload(["./dialog.js"]))).toEqual({ portals: true, sourceReadable: true });
});

test("commented-out imports have no virtual edge and no longer make source unreadable", async () => {
  expect(await readPortalRule(key, { ...sources(), [key]: async () => '// import { Ghost } from "./ghost";\nimport { Button } from "./button";' }, payload(["./button"])))
    .toEqual({ portals: false, sourceReadable: true });
});

for (const extension of ["css", "module.css", "json", "svg", "png", "jpg", "jpeg", "webp", "gif", "avif"]) {
  test(`plain .${extension} imports are explicitly non-code`, async () => {
    expect(await readPortalRule(key, sources(), payload([`./asset.${extension}`, "./button"])))
      .toEqual({ portals: false, sourceReadable: true });
  });
}

for (const specifier of ["./button?raw", "./asset.css?raw", "./asset.svg?component", "./asset.unknown", "./asset.mjs", "./ghost"]) {
  test(`${specifier} fails closed`, async () => {
    assertUnreadable(await readPortalRule(key, sources(), payload([specifier])));
  });
}

for (const patch of [{ lexFailure: true }, { nonLiteralDynamic: true }]) {
  test(`${JSON.stringify(patch)} in a virtual entry fails closed`, async () => {
    assertUnreadable(await readPortalRule(key, sources(), { ...payload(), [key]: entry([], patch) }));
    assertUnreadable(await readPortalRule(key, sources(), { ...payload(["./button"]), [button]: entry([], patch) }));
  });
}

test("missing virtual entries, unresolved targets and rejected source readers fail closed", async () => {
  assertUnreadable(await readPortalRule(key, sources(), {}));
  assertUnreadable(await readPortalRule(key, sources(), { [key]: entry(["./button"]) }));
  assertUnreadable(await readPortalRule(key, {}, payload()));
  assertUnreadable(await readPortalRule(key, { ...sources(), [dialog]: async () => { throw new Error("Read failed"); } }, payload(["./dialog"])));
});

test("raw Portal detection still includes strings and comments on every reached file", async () => {
  for (const source of ['const label = "Portal";', "// <Portal />", "createPortal(children, document.body)"]) {
    expect(await readPortalRule(key, { ...sources(), [button]: async () => source }, payload(["./button"])))
      .toEqual({ portals: true, sourceReadable: true });
  }
});

test("reachable import and export-from graphs, including dynamic edges, are cycle-safe", async () => {
  let reads = 0;
  const nested = "../../../../components/ui/nested/index.tsx";
  const modules = { ...sources(), [button]: async () => { reads++; return "<Button />"; }, [nested]: async () => "<span />" };
  const imports = { ...payload(["./button"]), [button]: entry(["./nested"]), [nested]: entry(["../button", "../dialog"]), [dialog]: entry(["./button"]) };
  expect(await readPortalRule(key, modules, imports)).toEqual({ portals: true, sourceReadable: true });
  expect(reads).toBe(1);
});

test("packages and local modules outside components/ui remain outside the inspection boundary", async () => {
  const imports = payload(["@/client/money-modal", "../../shared/classnames", "react"]);
  expect(componentModulePaths(imports[key].specifiers, key)).toEqual([]);
  expect(await readPortalRule(key, sources(), imports)).toEqual({ portals: false, sourceReadable: true });
});
