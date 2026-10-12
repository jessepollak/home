const extensions = new Set(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]);
const testName = /(?:\.test\.|_test\.|\.spec\.|_spec\.)/;

export function isUnitTestFile(path) {
  const parts = path.replace(/^\.\//, "").split("/");
  if (parts.some((part) => part.startsWith(".") || ["node_modules", "storybook-static", "stories"].includes(part))) return false;
  const name = parts.at(-1);
  return !/\.(?:pw|stories)\./.test(name) && extensions.has(name.split(".").at(-1)) && testName.test(name);
}

export function discoverFiles(paths) {
  return paths.filter(isUnitTestFile).sort();
}
