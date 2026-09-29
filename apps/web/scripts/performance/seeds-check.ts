import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gateIds } from "./config";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--base-url" || args[2] !== "--out-dir")
    throw new Error("Usage: perf:seeds --base-url http://localhost:3199 --out-dir <dir>");
  const baseUrl = args[1]!, dir = resolve(args[3]!);
  await mkdir(dir, { recursive: true });
  const checks: { id: string; exitCode: number; failures: string[]; caught: boolean; error?: string }[] = [];
  for (const id of gateIds) {
    const subdir = join(dir, `seed-${id}`);
    const command = Bun.spawn([process.execPath, "run", "--cwd", "apps/web", "perf:budget", "--base-url", baseUrl,
      "--out-dir", subdir, "--seed", id, "--only", id], { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" });
    const code = await command.exited;
    const stderr = await new Response(command.stderr).text();
    let failures: string[] = [];
    try {
      const result = JSON.parse(await readFile(join(subdir, "results.json"), "utf8")) as { structural: { id: string; pass: boolean }[] };
      failures = [...new Set(result.structural.filter((row) => !row.pass).map((row) => row.id))];
    } catch { /* A missing result is a failed check, not a successful seed. */ }
    const caught = code === 1 && failures.length === 1 && failures[0] === id;
    checks.push({ id, exitCode: code, failures, caught, ...(!caught ? { error: stderr.slice(-1600) } : {}) });
    console.log(`${id}: ${caught ? "caught" : `FAILED (exit ${code}, failures ${failures.join(",")})`}`);
  }
  await writeFile(join(dir, "seeds.json"), JSON.stringify({ version: 1, checks }, null, 2) + "\n");
  await writeFile(join(dir, "seeds.md"), ["# Performance budget regression seeds", "", "| Gate | Exit | Failed gates | Caught |", "|---|---:|---|:---:|",
    ...checks.map(({ id, exitCode, failures, caught }) => `| ${id} | ${exitCode} | ${failures.join(", ") || "none"} | ${caught ? "yes" : "NO"} |`), ""].join("\n"));
  if (checks.some(({ exitCode }) => exitCode === 2)) process.exitCode = 2;
  else if (checks.some(({ caught }) => !caught)) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 2; });
