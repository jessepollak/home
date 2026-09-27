import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { sheetHostExceptions } from "../policy/sheet-hosts.mjs";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-money-modal-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(rule, code, file = "client/transfers/sheet.tsx") {
  fixtureIndex += 1;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
  await writeFile(path.join(mirror, file), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [], categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { [`home/${rule}`]: "error" },
  }));
  const result = spawnSync(path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", file],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) => diagnostic.code === `home(${rule})`);
}

const sheet = "no-sheet-primitives";
const reexports = "no-sheet-primitive-reexports";
const api = "money-modal-public-api";
const alternate = "no-alternate-money-modal";

describe("no-sheet-primitives", () => {
  it("permits shared composition, a popover, and reviewed named drawer imports", async () => {
    expect(await lint(sheet, `
      import { MoneyModal, MoneyModalHeader } from "@/client/money-modal";
      import { deferSheet } from "@/client/money-modal/deferred-sheet";
      import { Popover } from "@/components/ui/popover";
      export function Transfer() { return <MoneyModal><MoneyModalHeader /></MoneyModal>; }
    `)).toHaveLength(0);
    expect(await lint(sheet, `import { Drawer as Navigation, DrawerTitle } from "@/components/ui/drawer";`,
      "app/admin/operator-shell.tsx")).toHaveLength(0);
    expect(await lint(sheet, `import { DrawerTitle } from "@/components/ui/drawer";`,
      "client/account/account-screen.tsx")).toHaveLength(0);
  });

  it("rejects direct primitive imports, exports, dynamic imports, and require with alias and relative resolution", async () => {
    expect(await lint(sheet, `
      import { Drawer } from "@/components/ui/drawer";
      import { Dialog } from "../../components/ui/dialog.tsx";
      export { DrawerTitle } from "@/components/ui/drawer/index";
      export * from "../../components/ui/dialog/index.tsx";
      void import("@/components/ui/drawer.tsx");
      require("../../components/ui/dialog");
    `)).toHaveLength(6);
  });

  it("never excepts unlisted or namespace/default drawer imports", async () => {
    expect(await lint(sheet, `
      import { Drawer, DrawerFooter } from "@/components/ui/drawer";
      import * as DrawerParts from "@/components/ui/drawer";
      import DrawerDefault from "@/components/ui/drawer";
    `, "app/admin/operator-shell.tsx")).toHaveLength(3);
  });

  it("rejects aliased createPortal, namespace and default react-dom access", async () => {
    expect(await lint(sheet, `
      import { createPortal as portal } from "react-dom";
      import * as ReactDOM from "react-dom";
      import DOMClient from "react-dom/client";
      portal(content, document.body);
      ReactDOM.createPortal(content, document.body);
      DOMClient.createPortal(content, document.body);
    `)).toHaveLength(3);
  });

  it("finds react-dom namespace imports even when the use precedes the import", async () => {
    expect(await lint(sheet, `ReactDOM.createPortal(content, document.body); import * as ReactDOM from "react-dom";`)).toHaveLength(1);
    expect(await lint(sheet, `Named.createPortal(content, document.body); import { default as Named } from "react-dom";`)).toHaveLength(1);
  });

  it("rejects createPortal reached through destructuring, computed access, aliases, require and dynamic import", async () => {
    expect(await lint(sheet, `
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
    `)).toHaveLength(11);
  });

  it("tracks react-dom bindings introduced by callbacks, default and rest patterns, and assignment", async () => {
    expect(await lint(sheet, `
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
    `)).toHaveLength(7);
  });

  it("ignores callback parameters of unrelated promises", async () => {
    expect(await lint(sheet, `
      void import("./helpers").then((helpers) => helpers.createPortal(content));
      void import("react-dom").then((ReactDOM) => ReactDOM.flushSync(update));
    `)).toHaveLength(0);
  });

  it("permits other react-dom members and unrelated destructuring", async () => {
    expect(await lint(sheet, `
      import * as ReactDOM from "react-dom";
      const { flushSync } = ReactDOM;
      ReactDOM.preload("/font.woff2", { as: "font" });
      const { createPortal } = helpers;
      other.createPortal(content);
    `)).toHaveLength(0);
  });

  it("rejects every alternate overlay package", async () => {
    const packages = ["vaul", "react-modal", "@radix-ui/react-dialog", "@radix-ui/react-alert-dialog",
      "@radix-ui/react-portal", "@headlessui/react", "@base-ui/react/drawer", "@base-ui/react/dialog",
      "@base-ui/react/alert-dialog"];
    expect(await lint(sheet, packages.map((pkg) => `import "${pkg}";`).join("\n"))).toHaveLength(packages.length);
  });

  it("rejects intrinsic dialogs and modal roles and attributes", async () => {
    expect(await lint(sheet, `
      const dialog = <dialog />;
      const modal = <div role="dialog" />;
      const alert = <div role={"alertdialog"} />;
      const aria = <div aria-modal={false} />;
      const acceptable = <div role={dynamicRole} />;
    `)).toHaveLength(4);
  });
});

describe("no-sheet-primitive-reexports", () => {
  it("permits re-exporting the shared money-modal API", async () => {
    expect(await lint(reexports, `export { MoneyModal } from "@/client/money-modal";`)).toHaveLength(0);
  });

  it("rejects direct, star, renamed local, and default re-exports, including inside excluded sheet-host paths", async () => {
    expect(await lint(reexports, `
      import { Drawer as LocalDrawer } from "@/components/ui/drawer";
      export { DrawerTitle } from "@/components/ui/drawer/index.tsx";
      export * from "@radix-ui/react-dialog";
      export { LocalDrawer as Rewrapped };
      export default LocalDrawer;
    `, "client/money-modal/wrapper.tsx")).toHaveLength(4);
    expect(await lint(reexports, `
      import { Dialog as Local } from "../../../components/ui/dialog";
      export { Local };
    `, "client/account/explorations/wrapper.tsx")).toHaveLength(1);
  });
});

describe("money-modal-public-api", () => {
  it("accepts barrel and deferred-sheet entry points", async () => {
    expect(await lint(api, `
      import { MoneyModal } from "@/client/money-modal";
      import { MoneyModalHeader } from "@/client/money-modal/index.ts";
      export { deferSheet } from "../../client/money-modal/deferred-sheet";
      void import("@/client/money-modal/deferred-sheet.tsx");
    `)).toHaveLength(0);
  });

  it("rejects alias and relative deep imports, exports, dynamic imports, and require", async () => {
    expect(await lint(api, `
      import { MoneyResult } from "@/client/money-modal/money-result";
      import { Footer } from "../money-modal/confirm-summary.tsx";
      export { useAmount } from "@/client/money-modal/amount/index";
      void import("../money-modal/network-fee-policy.ts");
      require("@/client/money-modal/money-modal");
    `)).toHaveLength(5);
  });
});

describe("no-alternate-money-modal", () => {
  it("rejects function, class, and variable hosts even when exported", async () => {
    expect(await lint(alternate, `
      export function MoneyModalCopy() {}
      export class AppDrawerReplacement {}
      export const MoneyConfirmFooterNew = null, MoneySheetNew = null;
      function MoneyDrawerAlternative() {}
      const MoneyDialogNew = null;
    `)).toHaveLength(6);
  });

  it("accepts uses of shared imports and other declarations", async () => {
    expect(await lint(alternate, `
      import { MoneyModal, AppDrawer } from "@/client/money-modal";
      const modal = <MoneyModal />;
      function ConfirmationSheet() { return <AppDrawer />; }
    `)).toHaveLength(0);
  });
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
