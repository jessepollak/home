const exempt = (path) => /(?:^|\/)explorations\//.test(path)
  || /^apps\/web\/stories\//.test(path)
  || /\.stories\.module\.css$/.test(path);

export function evaluateModuleCss({ paths, allowlist }) {
  const modules = new Set(paths.filter((path) => path.startsWith("apps/web/") && path.endsWith(".module.css") && !exempt(path)));
  const allowed = new Set(allowlist.map(({ path }) => path));
  return {
    unlisted: [...modules].filter((path) => !allowed.has(path)).sort(),
    staleAllowlist: allowlist.filter(({ path }) => !modules.has(path)).map(({ path }) => path).sort(),
    invalidAllowlist: allowlist.filter(({ path, reason }, index) => !path || !reason?.trim()
      || allowlist.findIndex((entry) => entry.path === path) !== index).map(({ path }) => path).sort(),
  };
}
