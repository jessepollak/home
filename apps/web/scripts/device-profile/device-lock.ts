import { link, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeName } from "./model";

const lockExists = (error: unknown) => (error as { code?: string }).code === "EEXIST";
const running = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as { code?: string }).code === "EPERM"; }
};
const ownerOf = async (path: string) => {
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  return /^[1-9]\d*$/.test(text) ? Number(text) : null;
};

export async function acquireDeviceLock(key: string): Promise<() => Promise<void>> {
  const path = join(tmpdir(), `home-device-profile-${safeName(key)}.lock`);
  const claim = `${path}.${process.pid}.${crypto.randomUUID()}`;
  await writeFile(claim, String(process.pid));
  try {
    await link(claim, path);
  } catch (error) {
    if (!lockExists(error)) throw error;
    const owner = await ownerOf(path);
    const state = owner !== null && !running(owner) ? `was interrupted while using ${key}` : `is already using ${key}`;
    throw new Error(`${state} (${path}); delete that file if no run is active`);
  } finally {
    await rm(claim, { force: true }).catch(() => {});
  }
  return async () => { if (await ownerOf(path) === process.pid) await rm(path, { force: true }); };
}
