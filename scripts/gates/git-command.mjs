import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

function resolveCommand(name, env = process.env) {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return name;
}

export const GIT = resolveCommand("git");
