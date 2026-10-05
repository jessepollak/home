import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import { normalizePath, transformWithEsbuild, type Plugin } from "vite";
import { loadCsf } from "storybook/internal/csf-tools";
import type { ImportEntry, LibraryImports } from "../stories/review/explorations/library/isolation";
import { virtualModulePlugin } from "./virtual-module-plugin";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

function transformLibrarySource(source: string, filename: string) {
  return transformWithEsbuild(source, filename, {
    loader: /\.[cm]?[jt]sx$/.test(filename) ? "tsx" : "ts",
    jsx: "automatic",
    target: "esnext",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
}

async function lexLibraryImports(source: string, filename: string): Promise<ImportEntry> {
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

async function lexCompositionImports(source: string, filename: string): Promise<string[]> {
  const { code } = await transformLibrarySource(source, filename);
  await init;
  const [imports] = parse(code);
  return [...new Set(imports.flatMap((entry) => {
    if (entry.d >= 0 && entry.n === undefined) {
      throw new Error(`Nonliteral dynamic composition import in ${filename} at offset ${entry.ss}`);
    }
    if (entry.n === undefined) return [];
    if (entry.d >= 0) return [entry.n];
    const statement = code.slice(entry.ss, entry.se);
    if (/^export\s+\*/.test(statement)) return [entry.n];
    const clause = /^(?:import|export)\s+([\s\S]+?)\s+from\s*["']/.exec(statement)?.[1];
    return clause && clause.replace(/[{},\s]/g, "") ? [entry.n] : [];
  }))];
}


type CompositionSource = (file: string) => Promise<string | undefined>;
const sourceExtensions = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cts", ".cjs"];

async function readCompositionSource(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
      (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
}

export async function walkCompositionUiImports(entry: string | string[], root = webRoot, readSource: CompositionSource = readCompositionSource, includeSource: (file: string) => boolean = () => true): Promise<string[]> {
  const visited = new Set<string>();
  const reached = new Set<string>();
  const sources = new Map<string, Promise<string | undefined>>();
  const read = (file: string) => {
    const cached = sources.get(file);
    if (cached) return cached;
    const pending = readSource(file);
    sources.set(file, pending);
    return pending;
  };
  const visit = async (file: string, source: string): Promise<void> => {
    if (visited.has(file)) return;
    if (!includeSource(normalizePath(relative(root, file)))) return;
    visited.add(file);
    const ui = normalizePath(relative(root, file)).match(/^components\/ui\/([^/.]+)(?:\.[cm]?[jt]sx?|\/)/)?.[1];
    if (ui) reached.add(ui);
    for (const specifier of await lexCompositionImports(source, file)) {
      if (!specifier.startsWith("@/") && !specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const path = resolve(specifier.startsWith("@/") ? root : dirname(file), specifier.startsWith("@/") ? specifier.slice(2) : specifier);
      const local = normalizePath(relative(root, path));
      if (local.startsWith("../") || local.split("/").includes("node_modules")) continue;
      const extension = extname(path);
      if (extension && !sourceExtensions.includes(extension)) continue;
      const stem = extension ? path.slice(0, -extension.length) : path;
      const candidates = extension ? [path, ...sourceExtensions.map((suffix) => `${stem}${suffix}`)]
        : [...sourceExtensions.map((suffix) => `${path}${suffix}`), ...sourceExtensions.map((suffix) => join(path, `index${suffix}`))];
      let found = false;
      for (const candidate of new Set(candidates)) {
        const next = await read(candidate);
        if (next === undefined) continue;
        await visit(candidate, next);
        found = true;
        break;
      }
      if (!found) throw new Error(`Couldn't resolve composition import ${specifier} from ${normalizePath(relative(root, file))}`);
    }
  };
  for (const name of typeof entry === "string" ? [entry] : entry) {
    const file = resolve(root, name);
    const source = await read(file);
    if (source === undefined) throw new Error(`Couldn't read composition imports: ${name}`);
    await visit(file, source);
  }
  return [...reached].sort();
}

export async function compositionFiles(root = webRoot): Promise<string[]> {
  return (await readdir(join(root, "stories/review/compositions"))).filter((name) => name.endsWith(".stories.tsx")).sort();
}

export async function compositionUiImports(root = webRoot): Promise<Record<string, string[]>> {
  const directory = join(root, "stories/review/compositions");
  const files = await compositionFiles(root);
  return Object.fromEntries(await Promise.all(files.map(async (name) =>
    [name, await walkCompositionUiImports(join(directory, name), root)])));
}

function isProductSource(file: string): boolean {
  return !/(?:^|\/)(?:stories|tests|__tests__|explorations)(?:\/|$)|\.(?:stories|test|spec)\.[cm]?[jt]sx?$/.test(file);
}

export async function productUiImports(root = webRoot, files?: string[], readSource: CompositionSource = readCompositionSource): Promise<string[]> {
  const routes = (files ?? await readdir(join(root, "app"), { recursive: true })).map(normalizePath)
    .filter((file) => isProductSource(file) && /(?:^|\/)(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[jt]sx?$/.test(file))
    .sort().map((file) => join("app", file));
  if (!routes.length) throw new Error("No product route entries found under app");
  return walkCompositionUiImports(routes, root, readSource, isProductSource);
}

export async function uiCatalog(root = webRoot): Promise<Map<string, string>> {
  const uiRoot = join(root, "components/ui");
  const files = (await readdir(uiRoot)).filter((name) => name.endsWith(".stories.tsx")).sort();
  const catalog = await Promise.all(files.map(async (file): Promise<Array<[string, string]>> => {
    const csf = loadCsf(await readFile(join(uiRoot, file), "utf8"), { makeTitle: (title) => title }).parse();
    return csf.meta.title?.startsWith("UI/") && csf.stories.length > 0
      ? [[file.slice(0, -".stories.tsx".length), csf.stories[0].id.split("--")[0]]] : [];
  }));
  return new Map(catalog.flat());
}

async function compositionNotUsedInProduct(root = webRoot): Promise<string[]> {
  const used = new Set(await productUiImports(root));
  return [...(await uiCatalog(root)).keys()].filter((name) => !used.has(name)).sort();
}

export function libraryImportsPlugin(root = webRoot, computeCoverage: () => Promise<string[]> = () => compositionNotUsedInProduct(root)): Plugin {
  const uiRoot = join(root, "components/ui");
  const matches = (file: string) => /^(?:[^/]+\.(?:ts|tsx)|[^/]+\/index\.tsx)$/.test(normalizePath(relative(uiRoot, file)));
  let compositionCoverage: Promise<string> | undefined;
  return virtualModulePlugin({
    name: "library-imports",
    watchFiles: [uiRoot, ...["client", "components", "shared", "app", "stories", "lib", "hooks"].map((directory) => join(root, directory))],
    modules: [{
      id: "virtual:composition-coverage",
      load() {
        if (!compositionCoverage) {
          const pending = computeCoverage()
            .then((names) => `export const notUsedInProduct = ${JSON.stringify(names)};`)
            .catch((error: unknown) => {
              if (compositionCoverage === pending) compositionCoverage = undefined;
              throw error;
            });
          compositionCoverage = pending;
        }
        return compositionCoverage;
      },
      watch(file) {
        const local = normalizePath(relative(root, file));
        if (local.startsWith("../") || local.split("/").includes("node_modules") || !/\.[cm]?[jt]sx?$/.test(local)) return false;
        compositionCoverage = undefined;
        return true;
      },
    }, {
      id: "virtual:library-imports",
      async load(addWatchFile) {
        const entries = await readdir(uiRoot, { withFileTypes: true });
        const files = (await Promise.all(entries.map(async (entry) => {
          if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) return [join(uiRoot, entry.name)];
          if (entry.isDirectory()) {
            return (await readdir(join(uiRoot, entry.name))).includes("index.tsx") ? [join(uiRoot, entry.name, "index.tsx")] : [];
          }
          return [];
        }))).flat();
        const payload: LibraryImports = Object.fromEntries(await Promise.all(files.map(async (file) => {
          addWatchFile(file);
          const key = `../../../../${normalizePath(relative(root, file))}`;
          try {
            return [key, await lexLibraryImports(await readFile(file, "utf8"), file)];
          } catch {
            return [key, { specifiers: [], nonLiteralDynamic: false, lexFailure: true }];
          }
        })));
        return `export default ${JSON.stringify(payload)};`;
      },
      watch: matches,
    }],
  });
}
