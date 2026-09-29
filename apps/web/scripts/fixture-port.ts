import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_SOURCE = `
const net = require("node:net");
const server = net.createServer();
server.once("error", (error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  server.close(() => process.stdout.write(String(port)));
});
`;
const RESERVATION_DIRECTORY = join(tmpdir(), "home-fixture-ports");
const heldReservations = new Set<string>();
export const FIXTURE_PORT_ATTEMPTS = 32;

process.on("exit", () => {
  for (const path of heldReservations) {
    try {
      releaseFixturePort(path);
    } catch (error) {
      process.stderr.write(`Could not release fixture port reservation ${path}: ${String(error)}\n`);
    }
  }
});

export function probeFixturePort(): number | null {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ["-e", PROBE_SOURCE], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
  const port = Number(stdout);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

export function reserveFixturePort(port: number, directory: string = RESERVATION_DIRECTORY): string | undefined {
  mkdirSync(directory, { recursive: true });
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const claimPattern = new RegExp(`^${escapedPort}\\.(\\d+)\\.lock$`);
  for (const entry of readdirSync(directory)) {
    const match = claimPattern.exec(entry);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        if ((error as NodeJS.ErrnoException).code === "EPERM") continue;
        throw error;
      }
      try {
        unlinkSync(join(directory, entry));
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      }
    }
  }
  const path = join(directory, `${port}.${process.pid}.lock`);
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    writeSync(descriptor, `${process.pid}\n`);
  } finally {
    closeSync(descriptor);
  }
  if (readdirSync(directory).some((entry) => entry !== `${port}.${process.pid}.lock` && claimPattern.test(entry))) {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return undefined;
  }
  heldReservations.add(path);
  return path;
}

export function releaseFixturePort(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    heldReservations.delete(path);
  }
}

export function selectFixturePort(
  requested: string | undefined,
  probe: () => number | null,
  reserve: (port: number) => string | undefined = reserveFixturePort,
): string {
  if (requested !== undefined && requested !== "") {
    if (!/^[1-9]\d{0,4}$/.test(requested) || Number(requested) > 65535) {
      throw new Error("HOME_FIXTURE_PORT must be a valid TCP port.");
    }
    return requested;
  }
  for (let attempt = 0; attempt < FIXTURE_PORT_ATTEMPTS; attempt++) {
    const candidate = probe();
    if (candidate === null) break;
    if (reserve(candidate)) return String(candidate);
  }
  throw new Error("Could not reserve a free port for the Playwright fixture server.");
}

export function resolveFixturePort(requested: string | undefined): string {
  return selectFixturePort(requested, probeFixturePort, reserveFixturePort);
}
