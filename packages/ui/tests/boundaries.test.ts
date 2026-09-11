import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { realpathSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import uiPackage from "../package.json";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const uiRoot = fileURLToPath(new URL("../", import.meta.url));

test("workspace consumers and Phosphor resolve one React and ReactDOM installation", () => {
  const uiRequire = createRequire(`${uiRoot}package.json`);
  const phosphorRequire = createRequire(uiRequire.resolve("@phosphor-icons/react/package.json"));
  const consumers = [uiRequire, phosphorRequire, ...["apps/web", "apps/design-system"].map((path) => createRequire(`${root}${path}/package.json`))];
  for (const name of ["react", "react-dom"]) {
    const resolved = consumers.map((require) => realpathSync(require.resolve(name)));
    expect(new Set(resolved).size).toBe(1);
    expect(new Set(consumers.map((require) => require(name))).size).toBe(1);
    expect(uiPackage.peerDependencies[name as "react" | "react-dom"]).toBe("^19.2.8");
    expect(Object.keys(uiPackage.dependencies)).not.toContain(name);
  }
});

test("core bundle has no React copy, Next/font/CSS, client directive, or feature dependencies", async () => {
  const result = await Bun.build({
    entrypoints: [`${uiRoot}src/index.ts`],
    target: "browser",
    external: ["react", "react/*", "react-dom", "react-dom/*"],
  });
  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);
  const code = await result.outputs[0].text();
  expect(code).toMatch(/from "react\/jsx(?:-dev)?-runtime"/);
  expect(code).not.toMatch(/next\/font|use client|\.css|@font-face|createContext|ReactCurrentDispatcher|react\.production|apps\/web|coinbase|wallet|fetch\(/);
  expect(code.length).toBeLessThan(10000);
  expect(uiPackage.exports["./next-font"]).toBe("./src/next-font.ts");
  expect(Object.keys(uiPackage.exports).some((key) => key.includes("*"))).toBe(false);
});

test("core and icon entries can load with React server conditions and no DOM", () => {
  const process = Bun.spawnSync(["bun", "--conditions=react-server", "tests/rsc-smoke.tsx"], { cwd: uiRoot });
  expect(process.stderr.toString()).toBe("");
  expect(process.exitCode).toBe(0);
  expect(process.stdout.toString()).toContain("without DOM or client context");
});

test("font assets are local, licensed, pinned WOFF2/TTF, and absent from the core entry", () => {
  const hashes = {
    "dm-sans.woff2": "e80dcae1d6cec824ed44daa671795d742f5c9ad8d50f7774bd0418eb44bfd4e1",
    "dm-sans-italic.woff2": "b86afcd6982355b627b0168dc055635829ecd8e74a30b391473a2d5e8add1544",
    "dm-mono-medium.ttf": "fd327daf461db87b44a87def475d251bf03b997f7c07d9680592d75dbbfaad0b",
  };
  for (const [file, hash] of Object.entries(hashes)) {
    const bytes = readFileSync(`${uiRoot}fonts/${file}`);
    if (file.endsWith(".woff2")) expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
    else expect(bytes.readUInt32BE(0)).toBe(0x00010000);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(hash);
  }
  for (const [file, hash] of Object.entries({
    "OFL.txt": "7ec15e79c59bc14b86436a17e5eb7926b46cbcaeb08e1a7e6c110b415e6eb2a2",
    "DM-Mono-OFL.txt": "f5898de81851415b71431c1a8ea527c88a4e79caeb23936483428d2e911af40c",
  })) {
    const license = readFileSync(`${uiRoot}fonts/${file}`, "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(new Bun.CryptoHasher("sha256").update(license).digest("hex")).toBe(hash);
  }
  expect(readFileSync(`${uiRoot}src/index.ts`, "utf8")).not.toMatch(/css|font/);
});
