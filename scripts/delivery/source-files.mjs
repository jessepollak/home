import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Directories that never carry repository source for gate scans.
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".next", ".vercel", "test-results", "playwright-report"]);

// Load source files under rootDir as { path, content } with POSIX-relative paths,
// filtered by extension. Gate helpers stay pure; tests use this to feed them.
export async function loadSourceFiles(rootDir, { extensions, skipDirs = DEFAULT_SKIP_DIRS } = {}) {
  if (!extensions?.length) throw new Error("loadSourceFiles requires an extensions list");
  const wanted = new Set(extensions);
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".env")) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(absolute);
      } else if (wanted.has(path.extname(entry.name))) {
        files.push({
          path: path.relative(rootDir, absolute).split(path.sep).join("/"),
          content: await readFile(absolute, "utf8"),
        });
      }
    }
  }

  await walk(rootDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
