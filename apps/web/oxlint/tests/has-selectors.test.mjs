import { describe, expect, it } from "bun:test";
import { hasSelectorFindings, isChildHasArgument, subjectPrefix } from "../policy/has-selectors.mjs";

const kinds = (css) => hasSelectorFindings(css).map(({ kind }) => kind);

describe("has selector analysis", () => {
  it("isolates the subject compound at the nesting level of :has", () => {
    for (const [selector, prefix] of [
      [String.raw`:is(.group\/field .outsider:has(input))`, ".outsider"],
      [String.raw`:where(.group\/field, .outsider:has(input))`, ".outsider"],
      [String.raw`.group\/field:is(.outsider:has(input))`, ".outsider"],
      [String.raw`.group\/field:is(:has(input))`, String.raw`.group\/field:is`],
      [String.raw`.group\/field:not(:has(input))`, String.raw`.group\/field:not`],
      [String.raw`:is(.group\/field, :has(input))`, ":is"],
      [String.raw`:is(:where(.group\/field):has(input) *)`, String.raw`:where(.group\/field)`],
      [String.raw`/* .group\/field */.outsider:has(input)`, String.raw`/* .group\/field */.outsider`],
      [String.raw`.group\2f field:has(input)`, String.raw`.group\2f field`],
      [String.raw`:is([data-title="not ) > .x"].outsider:has(input))`, String.raw`[data-title="not ) > .x"].outsider`],
      [String.raw`.group\/field:not(/*note*/:has(input))`, String.raw`.group\/field:not`],
    ]) {
      expect(subjectPrefix(selector, selector.indexOf(":has("))).toBe(prefix);
    }
  });

  it("accepts direct child forms including nested compounds and lists", () => {
    for (const argument of [">img:first-child", ">[data-slot=x]", ">a,>b", " > :is(a,b)"]) {
      expect(isChildHasArgument(argument)).toBe(true);
    }
    expect(kinds('.a:has(>img:first-child) {} :is(:where(.group\\/x):has(>input) *) {}')).toEqual([]);
  });

  it("rejects sibling and descendant combinators in any alternative", () => {
    for (const argument of ["+x", "~x", ">a b", "a,>b", ">a, b", ">a > b"]) {
      expect(isChildHasArgument(argument)).toBe(false);
    }
    expect(kinds(".a:has(+x) {} .b:has(>a b) {} .c:has(a,>b) {}")).toEqual(["descendant", "descendant", "descendant"]);
  });

  it("finds nested CSS ampersand selectors and scoped group ancestors", () => {
    expect(kinds(".a { &:has(input) { color: red; } &:has(>input) { color: blue; } } :is(:where(.group\\/x):has(input) *) { display: flex; }")).toEqual(["descendant", "descendant"]);
    expect(hasSelectorFindings(".field { @media (width > 10px) { &:has(input) { color: red; } } }")).toEqual([
      { kind: "descendant", selector: ".field:has(input)", argument: "input", index: 6 },
    ]);
    expect(kinds("html { &:has(>input) { color: red; } }")).toEqual(["root"]);
    expect(hasSelectorFindings("html, body { &:has(>input) { color: red; } }").map(({ selector }) => selector))
      .toEqual(["html:has(>input)", "body:has(>input)"]);
  });

  it("ignores quoted and commented :has text", () => {
    expect(kinds('/* .a:has(.x) {} */ .a::before { content: ":has(.x)"; } .b[data-x=":has(.y)"] { color: red; }')).toEqual([]);
  });

  it("identifies document-root compounds and only the root alternative in a selector list", () => {
    expect(kinds("html[data-x]:has(.x) {} :root.dark:has(>input) {} body:has(.x) {} .a:has(>a), html:has(.x) .b {}"))
      .toEqual(["root", "root", "root", "root"]);
  });

  it("keeps a document-root subject through functional pseudo-classes and comments", () => {
    expect(kinds("html:not(.embed):has(>main) {} :root:not([data-x]):has(>main) {} body:not(.x):has(>main) {}"))
      .toEqual(["root", "root", "root"]);
    expect(kinds("html:where(.x):has(>main) {} .a html:not(.x):has(>b) {} html/* note */:not(.y):has(>c) {}"))
      .toEqual(["root", "root", "root"]);
    expect(kinds("a:not(html):has(.x) {} .html:not(.x):has(>a) {}")).toEqual(["descendant"]);
    expect(kinds(":ROOT:has(>main) {} HTML:has(>b) {} BODY:has(>a) {} :Root:has(.x) {}")).toEqual(["root", "root", "root", "root"]);
  });

  it("recognizes root alternatives in :is and :where subjects, after combinators too, without promoting other compounds", () => {
    expect(kinds(":is(html):has(.x) {} :where(body):has(.x) {} :is(:root):has(.x) {} :where(html.dark):has(.x) {}"))
      .toEqual(["root", "root", "root", "root"]);
    expect(kinds(":is(.local, body[data-x]):has(>a) {} :where(.local, :root.dark):has(>a) {}"))
      .toEqual(["root", "root"]);
    expect(kinds(".a :is(html):has(.x) {} html :where(body):has(>div) {} :is(html) .a:has(.x) {} :is(.local):has(.x) {}"))
      .toEqual(["root", "root", "descendant", "descendant"]);
  });

  it("inspects document-root qualifiers that follow the :has() argument", () => {
    expect(kinds(":has(>main):root {} :has(>main):is(html) {} :has(>main):where(body) {} :has(>main):ROOT {}"))
      .toEqual(["root", "root", "root", "root"]);
    expect(kinds(".a :is(html):has(>main) {} .a:has(>main) :is(html) {}")).toEqual(["root"]);
  });

  it("ignores at-rule preludes while visiting their nested rules", () => {
    expect(kinds("@supports selector(:has(.x)) { .a:has(input) { color: red; } } @media (width > 10px) { body:has(>a) { color: blue; } }"))
      .toEqual(["descendant", "root"]);
  });

  it("inspects both @scope prelude groups as selectors, without visiting nested rules twice", () => {
    expect(hasSelectorFindings("@scope (html:has(>main)) { .a { color: red } }")).toEqual([
      { kind: "root", selector: "html:has(>main)", argument: ">main", index: 4 },
    ]);
    expect(hasSelectorFindings("@scope (.card) to (body:has(.x)) { .a { color: red } }")).toEqual([
      { kind: "root", selector: "body:has(.x)", argument: ".x", index: 4 },
    ]);
    expect(kinds("@scope (.card) { :scope:has(>a) {} }")).toEqual([]);
    expect(kinds("@media (width > 1px) { html:has(.x) {} }")).toEqual(["root"]);
    expect(kinds("@scope (html:has(>main), .card) { .a:has(input) {} }")).toEqual(["root", "descendant"]);
  });

  it("treats top-level :scope as the document root but not a locally scoped :scope", () => {
    expect(kinds(":scope:has(>main) {} :SCOPE.dark:has(>a) {} :is(:scope):has(>a) {} :scope { &:has(>main) {} }"))
      .toEqual(["root", "root", "root", "root"]);
    expect(kinds("@scope (.card) { :scope:has(>main) { color: red } } @SCOPE (.a) to (.b) { :scope:has(.x) {} }"))
      .toEqual(["descendant"]);
    expect(kinds("@media (width > 1px) { :scope:has(>main) {} } @scope (.card) { } :scope:has(>b) {}"))
      .toEqual(["root", "root"]);
  });

  it("recurses through nested :is and :where root wrappers", () => {
    expect(kinds(":is(:where(html)):has(>main) {} :where(:is(:root)):has(>main) {} :is(.a, :where(:is(body.x))):has(>a) {} :where(:where(:where(:scope))):has(>a) {}"))
      .toEqual(["root", "root", "root", "root"]);
    expect(kinds(":is(:where(.local)):has(>main) {} :is(:not(html)):has(>a) {}")).toEqual([]);
  });

  it("decodes CSS identifier escapes that spell letters", () => {
    expect(kinds(String.raw`ht\6dl:has(>main) {} :r\6f ot:has(>a) {} :sc\6f pe:has(>a) {} \62 ody:has(>a) {} .a:h\61s(input) {} .b:\68 as(>x y) {}`))
      .toEqual(["root", "root", "root", "root", "descendant", "descendant"]);
    expect(kinds(String.raw`.x\3e y:has(>a) {} .has-\[\3e input\]:has(>input) {} .a\\html:has(>b) {}`)).toEqual([]);
  });

  it("treats namespace-qualified root elements as root subjects", () => {
    expect(kinds("*|html:has(>main) {} |body:has(>a) {} svg|html:has(>a) {} :is(:where(*|html)):has(>main) {} .a *|html:not(.x):has(>b) {}"))
      .toEqual(["root", "root", "root", "root", "root"]);
    expect(kinds("[lang|=en]:has(>a) {} *|div:has(>a) {}")).toEqual([]);
  });

  it("judges wrapper alternatives by their subject compound", () => {
    expect(kinds(":is(:where(body.dark .card)):has(>input) {} :is(html .a, .b):has(>x) {}")).toEqual([]);
    expect(kinds(":is(.a html):has(>x) {} :where(body.dark .card):has(input) {}")).toEqual(["root", "descendant"]);
  });

  it("ignores root and scope spellings inside escaped identifiers and strings, and accepts identifier namespaces", () => {
    expect(kinds(String.raw`.variant\:scope:has(>input) {} .x\:root:has(>a) {} [data-x=":root"]:has(>a) {} .a[title=':scope']:has(>b) {}`)).toEqual([]);
    expect(kinds("café|html:has(>head) {} my-ns|body:has(>a) {} caf\\e9|html:has(>a) {}")).toEqual(["root", "root", "root"]);
  });
});
