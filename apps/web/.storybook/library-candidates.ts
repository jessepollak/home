import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scanner } from "@tailwindcss/oxide";
import type { Plugin } from "vite";
import type { CandidateFile, CandidatePayload, SourceFile } from "../stories/review/explorations/library/foundations/candidates";
import { virtualModulePlugin } from "./virtual-module-plugin";

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
  return virtualModulePlugin({
    name: "library-candidates",
    watchFiles: [componentRoot],
    modules: [{
      id: "virtual:library-candidates",
      async load(addWatchFile) {
        const files = libraryCandidateSources(root);
        addWatchFile(componentRoot);
        for (const file of files) addWatchFile(join(root, file.path));
        let payload: CandidatePayload;
        try {
          const { Scanner } = await import("@tailwindcss/oxide");
          payload = scanLibraryCandidates(files, new Scanner({}));
        } catch {
          payload = { status: "unavailable", reason: "Tailwind candidate scanner unavailable." };
        }
        return `export default ${JSON.stringify(payload)};`;
      },
      watch(file) {
        const path = relative(componentRoot, file).split(sep).join("/");
        return !path.startsWith("../") && path.endsWith(".tsx") && !/\.(?:stories|test)\.tsx$/.test(path);
      },
    }],
  });
}
