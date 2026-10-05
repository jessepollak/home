import type { Plugin } from "vite";

type VirtualModule = {
  id: string;
  load: (addWatchFile: (file: string) => void) => string | Promise<string>;
  watch: (file: string) => boolean;
};

export function virtualModulePlugin({ name, modules, watchFiles }: {
  name: string;
  modules: VirtualModule[];
  watchFiles: string[];
}): Plugin {
  const resolved = new Map(modules.map((module) => [`\0${module.id}`, module]));
  let cleanup: (() => void) | undefined;
  return {
    name,
    resolveId(id) { if (modules.some((module) => module.id === id)) return `\0${id}`; },
    load(id) {
      return resolved.get(id)?.load((file) => this.addWatchFile(file));
    },
    configureServer(server) {
      server.watcher.add(watchFiles);
      const refresh = (event: string, file: string) => {
        if (!["add", "change", "unlink"].includes(event)) return;
        for (const [id, module] of resolved) {
          if (!module.watch(file)) continue;
          const node = server.moduleGraph.getModuleById(id);
          if (!node) continue;
          server.moduleGraph.invalidateModule(node);
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("all", refresh);
      cleanup = () => { server.watcher.off("all", refresh); };
      server.httpServer?.once("close", cleanup);
    },
    closeBundle() { cleanup?.(); },
  };
}
