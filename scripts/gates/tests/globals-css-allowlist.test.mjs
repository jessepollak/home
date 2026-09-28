import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inventoryGlobalsCss } from "../globals-css-allowlist.mjs";

const cssUrl = new URL("../../../apps/web/app/globals.css", import.meta.url);
const allowlistUrl = new URL("../globals-css-allowlist.json", import.meta.url);

function verify(css, allowlist) {
  const { deferred, ...allowed } = allowlist;
  const inventory = inventoryGlobalsCss(css);
  assert.deepEqual(inventory, allowed, "globals.css structure must exactly match its committed allowlist");
  for (const { entry, owner } of deferred) {
    assert.deepEqual(owner, ["#1075", "#1137"], `${entry} must retain its shell owners`);
    if (entry === "apps/web/client/home/shell.tsx") continue;
    const [location, name] = entry.split("/");
    if (location === "@theme inline") assert.ok(inventory.themeInline.properties.includes(name), entry);
    else if (location === ":root") assert.ok(inventory.root.properties.includes(name), entry);
    else if (location === "@layer utilities") assert.ok(Object.hasOwn(inventory.utilitiesLayer, name), entry);
    else assert.ok(inventory.topLevel.includes(entry), entry);
  }
}

test("globals.css matches the committed structural allowlist", async () => {
  const css = await readFile(cssUrl, "utf8");
  const allowlist = JSON.parse(await readFile(allowlistUrl, "utf8"));
  verify(css, allowlist);
  const shell = await readFile(new URL("../../../apps/web/client/home/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /setProperty\("--shell-scrollbar-width",/);
});

test("an unlisted theme token fails the globals.css allowlist", async () => {
  const css = await readFile(cssUrl, "utf8");
  const allowlist = JSON.parse(await readFile(allowlistUrl, "utf8"));
  assert.throws(() => verify(css.replace("@theme inline {", "@theme inline { --color-unlisted: red;"), allowlist), /globals.css structure/);
});

test("an unlisted @source directive fails the globals.css allowlist", async () => {
  const css = await readFile(cssUrl, "utf8");
  const allowlist = JSON.parse(await readFile(allowlistUrl, "utf8"));
  assert.throws(() => verify(`${css}\n@source \"../elsewhere\";\n`, allowlist), /globals.css structure/);
  assert.throws(() => verify(css.replace('@source not "../oxlint";', ""), allowlist), /globals.css structure/);
});
