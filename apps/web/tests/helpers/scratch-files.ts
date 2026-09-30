import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

function scratchPath(path: string): string {
  const absolute = resolve(path);
  const fromTemp = relative(tmpdir(), absolute);
  if (!fromTemp || fromTemp === ".." || fromTemp.startsWith(`..${sep}`) || isAbsolute(fromTemp)) {
    throw new Error("Fixture files must stay inside the system temporary directory.");
  }
  return absolute;
}

function run(args: string[]): void {
  if (Bun.spawnSync({ cmd: args, stderr: "ignore" }).exitCode !== 0) {
    throw new Error("Could not prepare temporary fixture files.");
  }
}

export const scratchFiles = {
  async mkdir(path: string): Promise<void> { run(["mkdir", "-m", "700", scratchPath(path)]); },
  async readdir(path: string): Promise<string[]> {
    const entries: string[] = [];
    for await (const name of new Bun.Glob("*").scan({ cwd: scratchPath(path), dot: true })) entries.push(name);
    return entries.sort();
  },
  async rm(path: string): Promise<void> { run(["rm", "-rf", scratchPath(path)]); },
  async symlink(target: string, path: string): Promise<void> { run(["ln", "-s", scratchPath(target), scratchPath(path)]); },
  async unlink(path: string): Promise<void> { run(["rm", scratchPath(path)]); },
  async utimes(path: string, time: Date): Promise<void> {
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${time.getUTCFullYear()}${pad(time.getUTCMonth() + 1)}${pad(time.getUTCDate())}${pad(time.getUTCHours())}${pad(time.getUTCMinutes())}.${pad(time.getUTCSeconds())}`;
    run(["env", "TZ=UTC", "touch", "-t", stamp, scratchPath(path)]);
  },
  async writeFile(path: string, contents: string): Promise<void> {
    await Bun.write(scratchPath(path), contents);
    run(["chmod", "600", scratchPath(path)]);
  },
};
