import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import { normalizePath, transformWithEsbuild, type Plugin } from "vite";
import type { ImportEntry, LibraryImports } from "../stories/review/explorations/library/isolation";

const virtualId = "virtual:library-imports";
const resolvedId = `\0${virtualId}`;
const webRoot = fileURLToPath(new URL("../", import.meta.url));

function transformLibrarySource(source: string, filename: string) {
  return transformWithEsbuild(source, filename, {
    loader: filename.endsWith(".tsx") ? "tsx" : "ts",
    jsx: "automatic",
    target: "esnext",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
}

export async function lexLibraryImports(source: string, filename: string): Promise<ImportEntry> {
  try {
    const { code } = await transformLibrarySource(source, filename);
    await init;
    const [imports] = parse(code);
    return {
      specifiers: [...new Set(imports.flatMap((entry) => entry.n === undefined ? [] : [entry.n]))],
      nonLiteralDynamic: imports.some((entry) => entry.d >= 0 && entry.n === undefined),
      lexFailure: false,
    };
  } catch {
    return { specifiers: [], nonLiteralDynamic: false, lexFailure: true };
  }
}

export async function lexCompositionUiImports(source: string, filename: string): Promise<string[]> {
  const { code } = await transformLibrarySource(source, filename);
  await init;
  const [imports] = parse(code);
  const specifiers = imports.flatMap((entry) => {
    if (entry.d !== -1 || entry.n === undefined) return [];
    const clause = /^import\s+([\s\S]+?)\s+from\s*["']/.exec(code.slice(entry.ss, entry.se))?.[1];
    if (!clause || !clause.replace(/[{},\s]/g, "")) return [];
    return entry.n.match(/^@\/components\/ui\/([^/]+)$/)?.[1] ?? [];
  });
  return [...new Set(specifiers)];
}

export async function compositionUiImports(root = webRoot): Promise<Record<string, string[]>> {
  const directory = join(root, "stories/review/compositions");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".stories.tsx")).sort();
  return Object.fromEntries(await Promise.all(files.map(async (name) => {
    const file = join(directory, name);
    try {
      return [name, await lexCompositionUiImports(await readFile(file, "utf8"), file)];
    } catch {
      throw new Error(`Couldn't read composition imports: ${name}`);
    }
  })));
}

export function libraryImportsPlugin(root = webRoot): Plugin {
  const uiRoot = join(root, "components/ui");
  const matches = (file: string) => /^(?:[^/]+\.(?:ts|tsx)|[^/]+\/index\.tsx)$/.test(normalizePath(relative(uiRoot, file)));
  let cleanup: (() => void) | undefined;
  return {
    name: "library-imports",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      const entries = await readdir(uiRoot, { withFileTypes: true });
      const files = (await Promise.all(entries.map(async (entry) => {
        if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) return [join(uiRoot, entry.name)];
        if (entry.isDirectory()) {
          return (await readdir(join(uiRoot, entry.name))).includes("index.tsx") ? [join(uiRoot, entry.name, "index.tsx")] : [];
        }
        return [];
      }))).flat();
      const payload: LibraryImports = Object.fromEntries(await Promise.all(files.map(async (file) => {
        this.addWatchFile(file);
        const key = `../../../../${normalizePath(relative(root, file))}`;
        try {
          return [key, await lexLibraryImports(await readFile(file, "utf8"), file)];
        } catch {
          return [key, { specifiers: [], nonLiteralDynamic: false, lexFailure: true }];
        }
      })));
      return `export default ${JSON.stringify(payload)};`;
    },
    configureServer(server) {
      server.watcher.add(uiRoot);
      const changed = (file: string) => {
        if (!matches(file)) return;
        const node = server.moduleGraph.getModuleById(resolvedId);
        if (!node) return;
        server.moduleGraph.invalidateModule(node);
        server.ws.send({ type: "full-reload" });
      };
      for (const event of ["add", "change", "unlink"] as const) server.watcher.on(event, changed);
      cleanup = () => {
        for (const event of ["add", "change", "unlink"] as const) server.watcher.off(event, changed);
      };
      server.httpServer?.once("close", cleanup);
    },
    closeBundle() {
      cleanup?.();
    },
  };
}
