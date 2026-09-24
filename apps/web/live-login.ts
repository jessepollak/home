import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { defaultOtpSender, gmailCredentialsPath, pollGmailOtp, readGmailCredentials, runGmailAuth, verifyAccountEmail, type GmailCredentials } from "./gmail";

type BrowserCommand = (args: string[], input?: string) => string;
type LoginOptions = { command?: BrowserCommand; home?: string; env?: Record<string, string | undefined>; getOtp?: (email: string, submittedAt: number) => Promise<string> };

function browserCommand(env: Record<string, string | undefined>, session: string): BrowserCommand {
  const browserEnv: Record<string, string | undefined> = { ...env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_HEADED: env.AGENT_BROWSER_HEADED ?? "true" };
  delete browserEnv.HOME_ACCESS_PASSWORD;
  delete browserEnv.AGENT_BROWSER_ALLOWED_DOMAINS;
  return (args, input) => {
    const result = Bun.spawnSync({
      cmd: ["bunx", "agent-browser", ...args, "--json"],
      env: browserEnv,
      stdin: input === undefined ? undefined : Buffer.from(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(`Browser ${args[0]} failed.`);
    const parsed = JSON.parse(result.stdout.toString()) as { data?: { result?: unknown } };
    return String(parsed.data?.result ?? "");
  };
}

function inputExpression(label: string): string {
  const name = JSON.stringify(label);
  return `[...document.querySelectorAll('input')].find((input)=>input.getAttribute('aria-label')===${name}||[...(input.labels??[])].some((element)=>element.textContent?.replace('*','').trim()===${name}))`;
}

function fillSecret(label: string, value: string, command: BrowserCommand): void {
  const script = `(()=>{const input=${inputExpression(label)};if(!input)throw Error('Secret field missing');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`;
  command(["eval", "--stdin"], script);
}

function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

export async function liveLogin(args: string[], options: LoginOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const email = verifyAccountEmail(env);
  const name = option(args, "--session") ?? "home-live";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error("--session must be a short alphanumeric name (hyphens and underscores allowed).");
  const base = option(args, "--base-url");
  if (!base) throw new Error("Specify --base-url <deployed-url>.");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--base-url must be an HTTPS origin.");
  const directory = resolve(options.home ?? homedir(), ".home-verify");
  const path = resolve(directory, `${name}.state.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Refusing a symlink state path.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const command = options.command ?? browserCommand(env, name);
  try {
    command(["open", new URL("/?account=signin", url).toString()]);
    if (command(["eval", "location.pathname"]) === "/access") {
      if (!env.HOME_ACCESS_PASSWORD) throw new Error("This deployment requires HOME_ACCESS_PASSWORD.");
      command(["wait", "--fn", `Boolean(${inputExpression("Access password")})`]);
      fillSecret("Access password", env.HOME_ACCESS_PASSWORD, command);
      command(["find", "role", "button", "click", "--name", "Continue", "--exact"]);
      command(["wait", "--fn", "location.pathname!='/access'"]);
      command(["open", new URL("/?account=signin", url).toString()]);
    }
    command(["wait", "--fn", `Boolean(${inputExpression("Email address")})`]);
    command(["find", "label", "Email address", "fill", email, "--exact"]);
    const submittedAt = Date.now();
    command(["find", "role", "button", "click", "--name", "Continue with email", "--exact"]);
    const code = options.getOtp
      ? await options.getOtp(email, submittedAt)
      : await pollGmailOtp(
        await readGmailCredentials(gmailCredentialsPath(env)) as Required<GmailCredentials>,
        env.HOME_VERIFY_OTP_SENDER ?? defaultOtpSender,
        submittedAt,
        { accountEmail: email },
      );
    command(["wait", "--fn", `Boolean(${inputExpression("Verification code")})`]);
    fillSecret("Verification code", code, command);
    command(["find", "role", "button", "click", "--name", "Verify and continue", "--exact"]);
    command(["wait", "--fn", "Boolean(document.querySelector('[data-app-main-authenticated]'))"]);
    command(["state", "save", path]);
    await chmod(path, 0o600);
    return path;
  } finally {
    try { command(["close"]); } catch { /* The session may already be closed. */ }
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  try {
    if (args[0] === "--gmail-auth") {
      verifyAccountEmail();
      const port = option(args, "--port");
      if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new Error("--port must be 0–65535.");
      await runGmailAuth(gmailCredentialsPath(), { open: !args.includes("--no-open"), port: port === undefined ? undefined : Number(port) });
    } else {
      console.log(await liveLogin(args));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Login failed.");
    process.exitCode = 1;
  }
}
