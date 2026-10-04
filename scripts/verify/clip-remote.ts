import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { cleanupSteps, loopbackPort, shellQuote } from "./clip-core.mjs";
import { CommandError, commandTerminationGrace, run, save, stopChild, until, type ClipState } from "./clip-runtime";

export const remoteTimeouts = { tunnel: 30000, pin: 90000, start: 180000, status: 15000 };
const statusAttempts = 2;
export const remoteStartTimeout = remoteTimeouts.tunnel + remoteTimeouts.pin + remoteTimeouts.start + statusAttempts * remoteTimeouts.status + (2 + statusAttempts) * commandTerminationGrace + 10000;

export function remoteCommand(state: ClipState, args: string[]) {
  const directory = state.remoteDir!;
  const path = directory.startsWith("~/") ? `"$HOME"/${shellQuote(directory.slice(2))}` : shellQuote(directory);
  return `if [ -d /opt/homebrew/bin ]; then export PATH=/opt/homebrew/bin:$PATH; fi; export PATH="$HOME/.bun/bin:$PATH"; cd ${path} && bun run --silent clip ${args.map(shellQuote).join(" ")}`;
}
export function sshArgs(state: ClipState, command: string) {
  return ["-o", "BatchMode=yes", "-o", "ControlMaster=no", "-o", "ConnectTimeout=30", "-S", state.socket!, state.remoteHost!, command];
}
const defaults = { spawn, run, save, stopChild, until, now: Date.now };
export function remoteTarget(state: ClipState, directory: string, dependencies: Partial<typeof defaults> = {}) {
  const { spawn, run, save, stopChild, until, now } = { ...defaults, ...dependencies };
  let tunnel: ChildProcess | undefined, remoteActive = Boolean(state.remoteStarted);
  let tunnelError = "", tunnelFailed = false, lastCheck = 0;
  function checkTunnel() {
    if (tunnelFailed || (tunnel && (tunnel.exitCode !== null || tunnel.signalCode !== null))) throw new Error(`SSH tunnel dropped; recording discarded: ${tunnelError}`);
  }
  const remoteOutput = state.remoteOutput ?? `/tmp/home-clip-${crypto.randomUUID()}.mp4`;
  const ssh = async (command: string, timeout = 90000) => {
    try { return await run("ssh", sshArgs(state, command), { timeout }); }
    catch (error) {
      if (error instanceof CommandError && error.exitCode === 255) throw new Error(`Remote is unreachable; cleanup may remain pending. Retry: bun run clip cleanup --session ${state.session}. ${String(error)}`);
      throw error;
    }
  };
  async function status() {
    for (let attempt = 1; ; attempt++) {
      checkTunnel();
      let remoteState;
      try { remoteState = JSON.parse(await ssh(remoteCommand(state, ["__status", state.session]), remoteTimeouts.status)); }
      catch (error) { if (attempt < statusAttempts) continue; throw error; }
      if (remoteState.error) throw new Error(remoteState.error);
      return remoteState;
    }
  }
  return {
    async start() {
      const host = process.env.HOME_CLIP_REMOTE, checkout = process.env.HOME_CLIP_REMOTE_DIR;
      if (!host || !checkout) throw new Error("--remote requires HOME_CLIP_REMOTE and HOME_CLIP_REMOTE_DIR");
      if (host.startsWith("-") || !/^[A-Za-z0-9_.@:\[\]-]+$/.test(host)) throw new Error("HOME_CLIP_REMOTE requires an SSH destination, not SSH options");
      state.remoteHost = host; state.remoteDir = checkout; state.socket = join(directory, "s");
      await save(join(directory, "state.json"), state);
      const port = loopbackPort(state.url);
      const args = ["-N", "-M", "-S", state.socket, "-o", "ControlPersist=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
      if (port) args.push("-R", `${port}:127.0.0.1:${port}`);
      args.push(host);
      tunnel = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
      tunnel.stderr?.on("data", (data) => { tunnelError += data; });
      tunnel.on("error", (cause) => { tunnelFailed = true; tunnelError += String(cause); });
      state.tunnelPid = tunnel.pid;
      await save(join(directory, "state.json"), state);
      await until(async () => {
        checkTunnel();
        return run("ssh", ["-S", state.socket!, "-O", "check", host], { timeout: 2000 }).then(() => true).catch(() => false);
      }, remoteTimeouts.tunnel);
      const pin = (await import("../../package.json")).default.devDependencies["agent-browser"];
      const pinCommand = remoteCommand(state, []).replace(/bun run --silent clip $/, `bun -e ${shellQuote('console.log(require("./package.json").devDependencies["agent-browser"])')}`);
      const remotePin = await ssh(pinCommand, remoteTimeouts.pin);
      if (remotePin !== pin) throw new Error(`Remote checkout agent-browser pin differs: expected ${pin}, found ${remotePin}`);
      const flags = ["start", "--target", state.target, "--session", state.session];
      if (state.url) flags.push("--url", state.url);
      if (state.device) flags.push("--device", state.device);
      if (state.serial) flags.push("--serial", state.serial);
      if (state.target === "chromium") flags.push("--viewport", `${state.viewport.width}x${state.viewport.height}`);
      flags.push("--max-age", String(state.maxAge));
      remoteActive = true;
      state.remoteStarted = true; state.remoteOutput = remoteOutput;
      await save(join(directory, "state.json"), state);
      await ssh(remoteCommand(state, flags), remoteTimeouts.start);
      const remoteState = await status();
      Object.assign(state, { css: remoteState.css, emulator: remoteState.emulator, model: remoteState.model, chromeVersion: remoteState.chromeVersion });
      await save(join(directory, "state.json"), state);
    },
    async monitor(force = false) {
      checkTunnel();
      if (force || now() - lastCheck >= 1000) {
        await status();
        lastCheck = now();
      }
      checkTunnel();
    },
    async stop(out: string) {
      checkTunnel();
      const result = await ssh(remoteCommand(state, ["stop", "--session", state.session, "--out", remoteOutput]), 180000);
      remoteActive = false;
      state.remoteStarted = false;
      await save(join(directory, "state.json"), state);
      const pixels = result.match(/^Pixels: (\d+)×(\d+)$/m);
      const label = result.match(/^Preview: (.+)$/m)?.[1];
      if (!pixels || !label) throw new Error("Remote clip stop did not report pixel size and Preview label");
      await run("scp", ["-o", "BatchMode=yes", "-o", `ControlPath=${state.socket}`, `${state.remoteHost}:${remoteOutput}`, out], { timeout: 180000 });
      checkTunnel();
      return { width: Number(pixels[1]), height: Number(pixels[2]), label };
    },
    async cleanup() {
      await cleanupSteps([
        ["remote recorder", async () => {
          if (!remoteActive) return;
          try {
            await ssh(remoteCommand(state, ["cleanup", "--session", state.session]), 180000);
            remoteActive = false; state.remoteStarted = false;
            await save(join(directory, "state.json"), state);
          } catch (error) {
            if (!String(error).includes("No active clip session")) throw error;
            remoteActive = false; state.remoteStarted = false;
          }
        }],
        ["remote output", async () => { if (state.remoteOutput && state.remoteHost && state.socket && !remoteActive) await ssh(`rm -f ${shellQuote(remoteOutput)}`); }],
        ["SSH tunnel", async () => {
          if (tunnel) await stopChild(tunnel);
          if (state.socket && state.remoteHost) await run("ssh", ["-S", state.socket, "-O", "exit", state.remoteHost], { timeout: 5000 }).catch(() => {});
          if (!tunnel && state.tunnelPid) {
            const command = await run("ps", ["-p", String(state.tunnelPid), "-o", "command="]).catch(() => "");
            if (state.socket && command.includes(state.socket)) process.kill(state.tunnelPid, "SIGTERM");
          }
        }],
      ]);
    },
  };
}
