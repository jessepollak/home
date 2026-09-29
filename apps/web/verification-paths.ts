import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const realRepositoryRoot = realpathSync(repositoryRoot);

function isWithin(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

export function privateVerificationPath(path: string): string {
  const absolute = resolve(path);
  let ancestor = absolute;
  let real: string;
  while (true) {
    try {
      real = resolve(realpathSync(ancestor), relative(ancestor, absolute));
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw new Error("Could not resolve private verification path.");
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("Could not resolve private verification path.");
      ancestor = parent;
    }
  }
  if ([absolute, real].some((candidate) => [repositoryRoot, realRepositoryRoot].some((root) => isWithin(root, candidate)))) {
    throw new Error("Private verification files must live outside the repository.");
  }
  return absolute;
}
