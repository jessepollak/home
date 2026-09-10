import { expect, test } from "bun:test";
import root from "../../../package.json";
import catalog from "../package.json";
import web from "../../web/package.json";
import ui from "../../../packages/ui/package.json";

test("root check includes every workspace without changing the web entry points", () => {
  expect(root.workspaces).toContain("packages/*");
  for (const command of ["test", "lint", "typecheck"] as const) {
    for (const workspace of ["packages/ui", "apps/design-system", "apps/web"]) {
      expect(root.scripts[command]).toContain(`bun run --cwd ${workspace} ${command}`);
    }
    expect(root.scripts.check).toContain(`bun run ${command}`);
  }
  expect(root.scripts.build).toBe("bun run --cwd apps/web build && bun run --cwd apps/design-system build");
  expect(root.scripts.check).toContain("bun run build");
  expect(catalog.scripts.build).toContain("next build && bun tests/check-built.ts");
  expect(root.scripts.dev).toBe("bun run --cwd apps/web dev");
  expect(root.scripts.start).toBe("bun run --cwd apps/web start");
  for (const command of ["dev", "start"] as const) {
    expect(catalog.scripts[command]).toBe(`next ${command} --hostname 127.0.0.1 --port \${HOME_DESIGN_SYSTEM_PORT:-3100}`);
  }
});

test("catalog shares supported versions and has no production provider dependencies", () => {
  for (const dependency of ["next", "react", "react-dom"] as const) {
    expect(catalog.dependencies[dependency]).toBe(web.dependencies[dependency]);
    expect(ui.devDependencies[dependency]).toBe(web.dependencies[dependency]);
  }
  for (const dependency of ["tailwindcss", "@tailwindcss/postcss"] as const) {
    expect(catalog.devDependencies[dependency]).toBe(web.devDependencies[dependency]);
  }
  expect(Object.keys(catalog.dependencies).sort()).toEqual(["@home/ui", "next", "react", "react-dom"]);
  expect(ui.private).toBe(true);
});
