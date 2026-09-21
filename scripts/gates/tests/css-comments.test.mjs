import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectForbiddenComments, PRODUCT_LAYERS } from "../css-comments.mjs";
import { loadSourceFiles } from "../source-files.mjs";

test("CSS comments fail except a file-header third-party notice", () => {
  const forbidden = collectForbiddenComments([
    { path: "app/globals.css", content: "/* narrates a design token */\n:root { --token: red; }\n" },
    { path: "components/mark.module.css", content: '/* SPDX-License-Identifier: MIT */\n@font-face { font-family: "x"; src: url("/x.woff"); }\n' },
    { path: "components/late-notice.module.css", content: ".a { color: red; }\n/* Raised after the rule. */\n" },
    { path: "app/strings.css", content: '.a::after { content: "/* not a comment */"; }\n' },
  ]);

  assert.deepEqual(
    forbidden.map(({ path, line }) => [path, line]),
    [["app/globals.css", 1], ["components/late-notice.module.css", 2]],
  );
});

test("Python comments fail while # inside strings and docstrings is not a comment", () => {
  const forbidden = collectForbiddenComments([
    { path: "client/landing/generate.py", content: '"""Module docstring, not a comment."""\n# narrates a step\ncolor = "#00d64f"\nline = """# inside a string"""\n' },
    { path: "client/landing/notice.py", content: '# SPDX-License-Identifier: MIT\nprint("ok")\n' },
    { path: "app/trailing.py", content: "value = 1  # trailing note\n" },
  ]);

  assert.deepEqual(forbidden, [
    { path: "app/trailing.py", line: 1, text: "trailing note" },
    { path: "client/landing/generate.py", line: 2, text: "narrates a step" },
  ]);
});

test("test and story sources stay outside the comment policy", () => {
  const forbidden = collectForbiddenComments([
    { path: "components/fixture.test.css", content: "/* fixture comment */\n" },
    { path: "client/landing/fixture.stories.css", content: "/* story comment */\n" },
    { path: "client/tests/generate.py", content: "# helper comment\n" },
    { path: "shared/__tests__/fixture.py", content: "# helper comment\n" },
  ]);

  assert.deepEqual(forbidden, []);
});

test("product CSS and Python carry no comments", async () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const files = (await loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".css", ".py"] }))
    .filter((file) => PRODUCT_LAYERS.some((layer) => file.path.startsWith(`${layer}/`)));

  assert.ok(files.some((file) => file.path.endsWith(".css")), "CSS scan must find product stylesheets");
  assert.ok(files.some((file) => file.path.endsWith(".py")), "Python scan must find the landing asset generator");
  assert.deepEqual(
    collectForbiddenComments(files),
    [],
    "product CSS and Python must express this information through code, tests, types, lint rules, or documentation instead of comments",
  );
});
