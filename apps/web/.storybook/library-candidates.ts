import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scanner } from "@tailwindcss/oxide";
import type { Plugin } from "vite";
import type { CandidateFile, CandidatePayload, SourceFile } from "../stories/review/explorations/library/foundations/candidates";

const virtualId = "virtual:library-candidates";
const resolvedId = `\0${virtualId}`;
const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function scanLibraryCandidates(files: SourceFile[], scanner: Scanner): CandidateFile[] {
  return files.map(({ path, source }) => ({
    path,
    candidates: scanner.getCandidatesWithPositions({ content: source, extension: "tsx" }).map(({ candidate }) => candidate),
  }));
}

export function libraryCandidateSources(root = webRoot): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".tsx") && !/\.(?:stories|test)\.tsx$/.test(entry.name)) {
        files.push({ path, source: readFileSync(join(root, path), "utf8") });
      }
    }
  };
  visit("components");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function libraryCandidates(root = webRoot): Plugin {
  const componentRoot = join(root, "components");
  return {
    name: "library-candidates",
    resolveId(id) { if (id === virtualId) return resolvedId; },
    async load(id) {
      if (id !== resolvedId) return;
      const files = libraryCandidateSources(root);
      this.addWatchFile(componentRoot);
      for (const file of files) this.addWatchFile(join(root, file.path));
      let payload: CandidatePayload;
      try {
        const { Scanner } = await import("@tailwindcss/oxide");
        payload = scanLibraryCandidates(files, new Scanner({}));
      } catch {
        payload = { status: "unavailable", reason: "Tailwind candidate scanner unavailable." };
      }
      return `export default ${JSON.stringify(payload)};`;
    },
    configureServer(server) {
      server.watcher.add(componentRoot);
      const refresh = (event: string, file: string) => {
        if (!["add", "change", "unlink"].includes(event)) return;
        const path = relative(componentRoot, file).split(sep).join("/");
        if (path.startsWith("../") || !path.endsWith(".tsx") || /\.(?:stories|test)\.tsx$/.test(path)) return;
        const candidateModule = server.moduleGraph.getModuleById(resolvedId);
        if (!candidateModule) return;
        server.moduleGraph.invalidateModule(candidateModule);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("all", refresh);
      server.httpServer?.once("close", () => server.watcher.off("all", refresh));
    },
  };
}
