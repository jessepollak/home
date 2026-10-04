import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const unavailable = { status: "unavailable", reason: "Tailwind candidate scanner unavailable." };
const loadPayload = `
  const { libraryCandidates } = await import("./apps/web/.storybook/library-candidates.ts");
  const plugin = libraryCandidates();
  const output = await plugin.load.call({ addWatchFile() {} }, "\\0virtual:library-candidates");
  const payload = JSON.parse(output.slice("export default ".length, -1));
`;

function runWithMissingBinding(script: string): string {
  const result = Bun.spawnSync([process.execPath, "-e", script], {
    cwd: root,
    env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: join(tmpdir(), `library-missing-oxide-${randomUUID()}`, "intentionally-missing-native.node") },
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

test("Storybook config loads and its plugin emits unavailable when the native binding is missing", () => {
  const output = runWithMissingBinding(`
    try {
      await import("./apps/web/.storybook/main.ts");
      console.log("CONFIG_LOADED");
    } catch (error) {
      console.log("CONFIG_IMPORT_FAILED:", error.message);
      process.exitCode = 1;
    }
    ${loadPayload}
    console.log(JSON.stringify(payload));
  `);
  const lines = output.trim().split("\n");
  expect(lines[0]).toBe("CONFIG_LOADED");
  expect(JSON.parse(lines[1])).toEqual(unavailable);
  expect(lines[1]).not.toContain(root);
  expect(lines[1]).not.toContain(tmpdir());
});
