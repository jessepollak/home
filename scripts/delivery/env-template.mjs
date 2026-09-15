// Direct operator-configured process.env reads must be declared in .env.example.
// Platform/runtime-injected and test-only variables are allowlisted explicitly;
// the allowlist fails stale so removed reads force its cleanup.

const DOT_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Direct reads only: process.env.NAME and process.env["NAME"] / process.env['NAME'].
// Dynamic access such as process.env[name] is not a direct operator-configured read.
const DOT_ACCESS = /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g;
const BRACKET_ACCESS = /\bprocess\.env\[\s*(?:"([A-Z][A-Z0-9_]*)"|'([A-Z][A-Z0-9_]*)')\s*\]/g;

export function parseEnvTemplateNames(content) {
  const names = new Set();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(DOT_ENV_NAME);
    if (match) names.add(trimmed.slice(0, trimmed.indexOf("=")).trim());
  }
  return names;
}

export function readDirectEnvNames(files) {
  const names = new Map();
  for (const file of files) {
    for (const pattern of [DOT_ACCESS, BRACKET_ACCESS]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(file.content)) !== null) {
        const name = match[1] || match[2];
        if (!names.has(name)) names.set(name, new Set());
        names.get(name).add(file.path);
      }
    }
  }
  return names;
}

// declared: names declared in .env.example; read: Map name -> reading files;
// allowlist: documented platform/test-only names. Returns sorted violations.
export function evaluateEnvTemplate({ declared, read, allowlist = [] }) {
  const allowed = new Set(allowlist);
  const undeclared = [...read.keys()]
    .filter((name) => !declared.has(name) && !allowed.has(name))
    .sort();
  const staleAllowlist = allowlist.filter((name) => !read.has(name)).sort();
  return { undeclared, staleAllowlist };
}
