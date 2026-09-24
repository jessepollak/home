import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pinnedAgentBrowser } from "./pinned-agent-browser";

const root = resolve(tmpdir(), `home-pinned-browser-${crypto.randomUUID()}`);
const binary = resolve(root, "node_modules/.bin/agent-browser");
const expected = "0.38.1";
Bun.spawnSync(["mkdir", "-p", resolve(root, "node_modules/.bin")]);
await Bun.write(resolve(root, "package.json"), JSON.stringify({ devDependencies: { "agent-browser": expected } }));

afterAll(() => Bun.spawnSync(["rm", "-rf", root]));

describe("pinned agent-browser preflight", () => {
  test("refuses a missing local binary rather than fetching one", () => {
    expect(() => pinnedAgentBrowser(root)).toThrow("Run bun install --frozen-lockfile");
  });

  test("refuses a stale local binary", async () => {
    await Bun.write(binary, "#!/bin/sh\necho 'agent-browser 0.21.4'\n");
    Bun.spawnSync(["chmod", "755", binary]);
    expect(() => pinnedAgentBrowser(root)).toThrow(`Expected agent-browser ${expected}, found agent-browser 0.21.4`);
  });

  test("returns the direct path only when the local binary matches the package pin", async () => {
    await Bun.write(binary, `#!/bin/sh\necho 'agent-browser ${expected}'\n`);
    expect(pinnedAgentBrowser(root)).toBe(binary);
  });
});
