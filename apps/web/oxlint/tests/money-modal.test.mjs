import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { sheetHostExceptions } from "../policy/sheet-hosts.mjs";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const { lint } = await createOxlintWorkspace("home-oxlint-money-modal-", {
  path: () => "client/transfers/sheet.tsx",
});

const sheet = "no-sheet-primitives";
const reexports = "no-sheet-primitive-reexports";
const api = "money-modal-public-api";
const alternate = "no-alternate-money-modal";
const loadingOwnership = "no-unowned-loading";
const transientCopy = "no-transient-money-copy";

describe("no-sheet-primitives", () => {
  it("permits shared composition, a popover, and reviewed named drawer imports", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { MoneyModal, MoneyModalHeader } from "@/client/money-modal";
      import { deferSheet } from "@/client/money-modal/deferred-sheet";
      import { Popover } from "@/components/ui/popover";
      export function Transfer() { return <MoneyModal><MoneyModalHeader /></MoneyModal>; }
    ` },
      fixture2: { path: "app/admin/operator-shell.tsx", code: `import { Drawer as Navigation, DrawerTitle } from "@/components/ui/drawer";` },
      fixture3: { path: "client/account/account-screen.tsx", code: `import { DrawerTitle } from "@/components/ui/drawer";` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(0);
    expect(results.fixture3).toHaveLength(0);
  }, budgetMs);

  it("rejects direct primitive imports, exports, dynamic imports, and require with alias and relative resolution", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { Drawer } from "@/components/ui/drawer";
      import { Dialog } from "../../components/ui/dialog.tsx";
      export { DrawerTitle } from "@/components/ui/drawer/index";
      export * from "../../components/ui/dialog/index.tsx";
      void import("@/components/ui/drawer.tsx");
      require("../../components/ui/dialog");
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(6);
  }, budgetMs);

  it("never excepts unlisted or namespace/default drawer imports", async () => {
    const results = await lint({
      fixture1: { path: "app/admin/operator-shell.tsx", code: `
      import { Drawer, DrawerFooter } from "@/components/ui/drawer";
      import * as DrawerParts from "@/components/ui/drawer";
      import DrawerDefault from "@/components/ui/drawer";
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);

  it("rejects aliased createPortal, namespace and default react-dom access", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { createPortal as portal } from "react-dom";
      import * as ReactDOM from "react-dom";
      import DOMClient from "react-dom/client";
      portal(content, document.body);
      ReactDOM.createPortal(content, document.body);
      DOMClient.createPortal(content, document.body);
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);

  it("finds react-dom namespace imports even when the use precedes the import", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `ReactDOM.createPortal(content, document.body); import * as ReactDOM from "react-dom";` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(1);
    const results2 = await lint({
      fixture2: { path: "client/transfers/sheet.tsx", code: `Named.createPortal(content, document.body); import { default as Named } from "react-dom";` },
    }, { rule: sheet });
    expect(results2.fixture2).toHaveLength(1);
  }, budgetMs);

  it("rejects createPortal reached through destructuring, computed access, aliases, require and dynamic import", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import * as ReactDOM from "react-dom";
      import DOMDefault from "react-dom";
      const { createPortal } = ReactDOM;
      const { createPortal: portal } = DOMDefault;
      const { "createPortal": quoted } = ReactDOM;
      ReactDOM["createPortal"](content, document.body);
      const Alias = ReactDOM;
      Alias.createPortal(content, document.body);
      let assigned; ({ createPortal: assigned } = ReactDOM);
      const { createPortal: required } = require("react-dom");
      const loaded = await import("react-dom");
      loaded.createPortal(content, document.body);
      const { createPortal: dynamic } = await import("react-dom");
      const { default: { createPortal: nested } } = await import("react-dom");
      void import("react-dom").then(({ createPortal: later }) => later);
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(11);
  }, budgetMs);

  it("tracks react-dom bindings introduced by callbacks, default and rest patterns, and assignment", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { default as Named } from "react-dom";
      Named.createPortal(content, document.body);
      void import("react-dom").then((ReactDOM) => ReactDOM.createPortal(content, document.body));
      void import("react-dom").then(function (Loaded = {}) { return Loaded["createPortal"]; });
      void import("react-dom").then(({ default: DOM }) => DOM.createPortal(content, document.body));
      const { default: Deferred } = await import("react-dom");
      Deferred.createPortal(content, document.body);
      const { flushSync, ...rest } = require("react-dom");
      rest.createPortal(content, document.body);
      let later; later = await import("react-dom");
      later.createPortal(content, document.body);
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(7);
  }, budgetMs);

  it("ignores callback parameters of unrelated promises", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      void import("./helpers").then((helpers) => helpers.createPortal(content));
      void import("react-dom").then((ReactDOM) => ReactDOM.flushSync(update));
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("permits other react-dom members and unrelated destructuring", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import * as ReactDOM from "react-dom";
      const { flushSync } = ReactDOM;
      ReactDOM.preload("/font.woff2", { as: "font" });
      const { createPortal } = helpers;
      other.createPortal(content);
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects every alternate overlay package", async () => {
    const packages = ["vaul", "react-modal", "@radix-ui/react-dialog", "@radix-ui/react-alert-dialog",
      "@radix-ui/react-portal", "@headlessui/react", "@base-ui/react/drawer", "@base-ui/react/dialog",
      "@base-ui/react/alert-dialog"];
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: packages.map((pkg) => `import "${pkg}";`).join("\n") },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(packages.length);
  }, budgetMs);

  it("rejects intrinsic dialogs and modal roles and attributes", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      const dialog = <dialog />;
      const modal = <div role="dialog" />;
      const alert = <div role={"alertdialog"} />;
      const aria = <div aria-modal={false} />;
      const acceptable = <div role={dynamicRole} />;
    ` },
    }, { rule: sheet });
    expect(results.fixture1).toHaveLength(4);
  }, budgetMs);
});

describe("no-sheet-primitive-reexports", () => {
  it("permits re-exporting the shared money-modal API", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `export { MoneyModal } from "@/client/money-modal";` },
    }, { rule: reexports });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects direct, star, renamed local, and default re-exports, including inside excluded sheet-host paths", async () => {
    const results = await lint({
      fixture1: { path: "client/money-modal/wrapper.tsx", code: `
      import { Drawer as LocalDrawer } from "@/components/ui/drawer";
      export { DrawerTitle } from "@/components/ui/drawer/index.tsx";
      export * from "@radix-ui/react-dialog";
      export { LocalDrawer as Rewrapped };
      export default LocalDrawer;
    ` },
      fixture2: { path: "client/account/explorations/wrapper.tsx", code: `
      import { Dialog as Local } from "../../../components/ui/dialog";
      export { Local };
    ` },
    }, { rule: reexports });
    expect(results.fixture1).toHaveLength(4);
    expect(results.fixture2).toHaveLength(1);
  }, budgetMs);
});

describe("money-modal-public-api", () => {
  it("accepts barrel and deferred-sheet entry points", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { MoneyModal } from "@/client/money-modal";
      import { MoneyModalHeader } from "@/client/money-modal/index.ts";
      export { deferSheet } from "../../client/money-modal/deferred-sheet";
      void import("@/client/money-modal/deferred-sheet.tsx");
    ` },
    }, { rule: api });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects alias and relative deep imports, exports, dynamic imports, and require", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { MoneyResult } from "@/client/money-modal/money-result";
      import { Footer } from "../money-modal/confirm-summary.tsx";
      export { useAmount } from "@/client/money-modal/amount/index";
      void import("../money-modal/network-fee-policy.ts");
      require("@/client/money-modal/money-modal");
    ` },
    }, { rule: api });
    expect(results.fixture1).toHaveLength(5);
  }, budgetMs);
});

describe("no-alternate-money-modal", () => {
  it("rejects function, class, and variable hosts even when exported", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      export function MoneyModalCopy() {}
      export class AppDrawerReplacement {}
      export const MoneyConfirmFooterNew = null, MoneySheetNew = null;
      function MoneyDrawerAlternative() {}
      const MoneyDialogNew = null;
    ` },
    }, { rule: alternate });
    expect(results.fixture1).toHaveLength(6);
  }, budgetMs);

  it("accepts uses of shared imports and other declarations", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { MoneyModal, AppDrawer } from "@/client/money-modal";
      const modal = <MoneyModal />;
      function ConfirmationSheet() { return <AppDrawer />; }
    ` },
    }, { rule: alternate });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);
});

describe("no-unowned-loading", () => {
  it("rejects direct and aliased LoaderCircle imports and bare or modified spin classes", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { LoaderCircle as Progress, CircleCheck } from "lucide-react";
      const marker = <Progress className="size-4 motion-safe:animate-spin" />;
      const later = <span className={\`size-4 animate-spin\`} />;
    ` },
    }, { rule: loadingOwnership });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);
  it("allows owned controls and other icon and animation names", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/sheet.tsx", code: `
      import { Button } from "@/components/ui/button";
      import { CircleCheck } from "lucide-react";
      const ok = <Button loading><CircleCheck />Continue</Button>;
      const unrelated = <div className="animate-pulse animate-spinny" />;
    ` },
    }, { rule: loadingOwnership });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);
});

describe("no-transient-money-copy", () => {
  const flow = `import { MoneyModalStep, MoneyModalFooter } from "@/client/money-modal";`;
  it("rejects progress-only JSX text and string expressions in a money sheet", async () => {
    const results = await lint({
      fixture1: { path: "client/trading/trade-money-dialog.tsx", code: `${flow}
      const step = <MoneyModalStep step="amount" depth={0}>
        <p>Preparing review…</p><div>{"Getting a quote..."}</div>
        <span>{busy ? "Waiting for your wallet…" : "Continue"}</span>
        <p>{\`Verifying session…\`}</p><p>Loading details…</p>
      </MoneyModalStep>;
    ` },
    }, { rule: transientCopy });
    expect(results.fixture1).toHaveLength(5);
  }, budgetMs);
  it("allows footer primary labels and a Button loading label, but not unrelated props or idle buttons", async () => {
    const results = await lint({
      fixture1: { path: "client/transfers/send-dialog.tsx", code: `${flow}
      import { MoneyConfirmFooter } from "@/client/money-modal";
      import { Button } from "@/components/ui/button";
      const labels = <><MoneyModalFooter primaryLabel={busy ? "Getting quote…" : "Review quote"} />
        <MoneyConfirmFooter primaryLabel={"Waiting for your wallet…"} />
        <Button loading={busy}><span>Verifying…</span></Button>
        <Button loading={false}>Loading review…</Button>
        <p title="Preparing review…">Ready</p></>;
    ` },
    }, { rule: transientCopy });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);
  it("ignores non-flow screens, ordinary text, and progress copy without a trailing ellipsis", async () => {
    const results = await lint({
      fixture1: { path: "client/activity/activity-panel.tsx", code: `const page = <span>Loading more…</span>;` },
      fixture2: { path: "client/borrowing/borrow-money-dialog.tsx", code: `${flow}
      const page = <><span>Waiting for a buyer</span><span>Preparing review</span>
        <span>Getting started</span></>;
    ` },
    }, { rule: transientCopy });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);
});

it("keeps every sheet-host exception owned, present, and limited to actual drawer named imports", async () => {
  for (const entry of sheetHostExceptions) {
    expect(entry.file.trim()).not.toBe("");
    expect(entry.owner.trim()).not.toBe("");
    expect(entry.reason.trim()).not.toBe("");
    expect(entry.imports.length).toBeGreaterThan(0);
    expect(entry.imports.every((name) => typeof name === "string" && name.trim().length > 0)).toBe(true);
    const filename = path.join(appsWebDir, entry.file);
    expect((await stat(filename)).isFile()).toBe(true);
    const source = ts.createSourceFile(filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const actual = source.statements.filter((node) => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && (node.moduleSpecifier.text === "@/components/ui/drawer"
        || path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), node.moduleSpecifier.text))
          .replace(/\.(?:[cm]?[jt]sx?)$/u, "").replace(/\/index$/u, "") === "components/ui/drawer"))
      .flatMap((node) => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
        ? node.importClause.namedBindings.elements.map((specifier) => (specifier.propertyName ?? specifier.name).text) : []);
    for (const name of entry.imports) expect(actual).toContain(name);
  }
});
