import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateModuleCss } from "../module-css.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const allowlistUrl = new URL("../module-css-allowlist.json", import.meta.url);
const clean = { unlisted: [], staleAllowlist: [], invalidAllowlist: [] };

test("tracked and new CSS modules match the reasoned allowlist", async () => {
  const allowlist = JSON.parse(await readFile(allowlistUrl, "utf8"));
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: root })
    .toString().split("\0").filter((entry) => entry.endsWith(".module.css") && existsSync(path.join(root, entry)));
  assert.ok(paths.length > 0, "the CSS module scan must find tracked files");
  assert.deepEqual(evaluateModuleCss({ paths, allowlist }), clean);
});

test("an unlisted product module fails while explorations and stories are exempt", () => {
  const allowlist = [{ path: "apps/web/components/kept.module.css", reason: "SVG geometry" }];
  const paths = ["apps/web/components/kept.module.css", "apps/web/app/new.module.css", "apps/web/app/stories/feature.module.css", "apps/web/components/explorations/sketch.module.css", "apps/web/stories/board/board.module.css", "apps/web/components/feature.stories.module.css"];
  assert.deepEqual(evaluateModuleCss({ paths, allowlist }), { ...clean, unlisted: ["apps/web/app/new.module.css", "apps/web/app/stories/feature.module.css"] });
});

test("only the sanctioned plural story spelling is exempt from the module allowlist", () => {
  const paths = [
    "apps/web/components/feature.stories.module.css",
    "apps/web/components/feature.story.module.css",
    "apps/web/components/feature.storie.module.css",
  ];
  assert.deepEqual(evaluateModuleCss({ paths, allowlist: [] }).unlisted, [
    "apps/web/components/feature.storie.module.css",
    "apps/web/components/feature.story.module.css",
  ]);
});

test("a removed module or a missing/duplicated reason fails", () => {
  const paths = ["apps/web/components/kept.module.css"];
  assert.deepEqual(evaluateModuleCss({ paths, allowlist: [{ path: "apps/web/components/gone.module.css", reason: "SVG geometry" }] }).staleAllowlist, ["apps/web/components/gone.module.css"]);
  assert.deepEqual(evaluateModuleCss({ paths, allowlist: [{ path: paths[0], reason: " " }] }).invalidAllowlist, paths);
  assert.deepEqual(evaluateModuleCss({ paths, allowlist: [{ path: paths[0], reason: "SVG geometry" }, { path: paths[0], reason: "SVG geometry" }] }).invalidAllowlist, paths);
});
