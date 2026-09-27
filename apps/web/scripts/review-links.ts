const STORYBOOK_HOST = /^home-storybook-[a-z0-9-]+\.vercel\.app$/i;
const STORY_ID = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/;
const STORYBOOK_LINK = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const STORY_TOKEN = /`story:([a-z0-9-]+)`/g;
const BLOCK_START = "<!-- review-links:start -->";
const BLOCK_END = "<!-- review-links:end -->";

type Options = { host: string; revision: string };

function reviewUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if (url.pathname !== "/iframe.html" || !/^review-boards--[a-z0-9-]+$/.test(url.searchParams.get("id") ?? "")) return null;
    if (url.protocol !== "https:" || !STORYBOOK_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function changesUrl(host: string, revision: string, focus: string[], frame?: string): string {
  const url = new URL(`https://${host}/iframe.html`);
  url.searchParams.set("id", "review-boards--changes");
  url.searchParams.set("viewMode", "story");
  if (focus.length) url.searchParams.set("focus", focus.join(","));
  if (frame) url.searchParams.set("frame", frame);
  url.searchParams.set("rev", revision);
  url.searchParams.set("deployment", host);
  return url.toString().replace(/%2C/gi, ",");
}

function refreshCurated(url: URL, host: string, revision: string): string {
  url.host = host;
  url.searchParams.set("rev", revision);
  url.searchParams.set("deployment", host);
  return url.toString();
}

function tableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function firstContentLine(lines: string[]): string | undefined {
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes("-->")) inComment = false;
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith("<!--")) {
      inComment = !trimmed.includes("-->");
      continue;
    }
    return trimmed;
  }
  return undefined;
}

export function rewriteReviewLinks(body: string, { host, revision }: Options): string {
  if (!STORYBOOK_HOST.test(host) || !/^[0-9a-f]{40,64}$/i.test(revision)) throw new Error("Invalid Storybook host or revision");
  const heading = /^## Preview[ \t]*(?:\r\n|\n|$)/gm.exec(body);
  if (!heading) return body;
  const start = heading.index + heading[0].length;
  const rest = body.slice(start);
  const boundary = /^(?:<details\b|## )/gm.exec(rest);
  const section = rest.slice(0, boundary?.index ?? rest.length);
  const lines = section.split(/\r\n|\n/);
  if (firstContentLine(lines)?.startsWith("N/A")) return body;
  const eol = heading[0].endsWith("\r\n") ? "\r\n" : heading[0].endsWith("\n") ? "\n" : body.includes("\r\n") ? "\r\n" : "\n";
  const focus: string[] = [];
  for (const line of lines) {
    if (!tableRow(line)) continue;
    for (const match of line.matchAll(/`story:([a-z0-9-]+)`|\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
      const url = match[2] ? reviewUrl(match[2]) : null;
      const id = match[1] ?? (url?.searchParams.get("id") === "review-boards--changes" ? url.searchParams.get("frame") : null);
      if (id && STORY_ID.test(id) && !focus.includes(id)) focus.push(id);
    }
  }

  let top: URL | null = null;
  const hasBlock = lines.some((line) => line.trim() === BLOCK_START) && lines.some((line) => line.trim() === BLOCK_END);
  let usedStandalone = false;
  const retained: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === BLOCK_START) {
      const end = lines.findIndex((candidate, index) => index > i && candidate.trim() === BLOCK_END);
      if (end !== -1) {
        const existing = lines.slice(i + 1, end).join(eol).match(/\[Review board\]\((https?:\/\/[^\s)]+)\)/);
        top ??= existing ? reviewUrl(existing[1]) : null;
        i = end;
        continue;
      }
    }
    const standalone = line.trim().match(/^\[[^\]]+\]\((https?:\/\/[^\s)]+)\)$/);
    if (!hasBlock && !usedStandalone && standalone && reviewUrl(standalone[1])) {
      top = reviewUrl(standalone[1]);
      usedStandalone = true;
      continue;
    }
    if (tableRow(line)) {
      retained.push(line.replace(STORY_TOKEN, (token, id: string) => STORY_ID.test(id)
        ? `[Board](${changesUrl(host, revision, focus, id)})` : token).replace(STORYBOOK_LINK, (link, text: string, input: string) => {
        const url = reviewUrl(input);
        if (!url) return link;
        return `[${text}](${url.searchParams.get("id") === "review-boards--changes"
          ? changesUrl(host, revision, focus, url.searchParams.get("frame") ?? undefined)
          : refreshCurated(url, host, revision)})`;
      }));
    } else {
      retained.push(line);
    }
  }
  const topUrl = top && top.searchParams.get("id") !== "review-boards--changes"
    ? refreshCurated(top, host, revision) : changesUrl(host, revision, focus, focus[0]);
  const block = [BLOCK_START, `[Review board](${topUrl})`, BLOCK_END].join(eol);
  const content = retained.join(eol).replace(/^(?:[ \t]*(?:\r\n|\n))*/, "");
  return body.slice(0, heading.index) + heading[0] + eol + block + eol + (content ? eol + content : "") + rest.slice(section.length);
}

type PullRequest = { body: string | null; head: { sha: string } };
type Deployment = { id: number };
type Status = { state: string; environment_url: string | null };

function api<T>(path: string, args: string[] = [], input?: string): T {
  const result = Bun.spawnSync(["gh", "api", path, ...args], { stdin: input === undefined ? undefined : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`gh api ${path}: ${result.stderr.toString().trim()}`);
  return JSON.parse(result.stdout.toString()) as T;
}

function parseArgs(args: string[]) {
  let pr: string | undefined;
  let repo = "jessepollak/home";
  let sha: string | undefined;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") write = true;
    else if (arg === "--repo" || arg === "--sha") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--repo") repo = value;
      else sha = value;
    } else if (!arg.startsWith("-") && !pr) pr = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!pr || !/^[1-9][0-9]*$/.test(pr) || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo) || (sha && !/^[a-f0-9]{40,64}$/i.test(sha))) {
    throw new Error("Usage: bun run --cwd apps/web review:links <pr> [--write] [--repo owner/name] [--sha <sha>]");
  }
  return { pr, repo, sha, write };
}

function deploymentHost(repo: string, sha: string): string | null {
  const pages = api<Deployment[][]>(`repos/${repo}/deployments`, ["--method", "GET", "-f", `sha=${sha}`, "-f", "environment=Preview – home-storybook", "-f", "per_page=100", "--paginate", "--slurp"]);
  for (const deployment of pages.flat()) {
    const statuses = api<Status[]>(`repos/${repo}/deployments/${deployment.id}/statuses`, ["--method", "GET", "-f", "per_page=1"]);
    const status = statuses[0];
    if (status?.state !== "success" || !status.environment_url) continue;
    try {
      const url = new URL(status.environment_url);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && STORYBOOK_HOST.test(url.hostname)) return url.hostname;
    } catch {
      continue;
    }
  }
  return null;
}

function main() {
  const { pr, repo, sha, write } = parseArgs(process.argv.slice(2));
  const path = `repos/${repo}/pulls/${pr}`;
  const pull = api<PullRequest>(path);
  if (sha && sha !== pull.head.sha) {
    console.log(`PR #${pr} head no longer matches ${sha}; skipping.`);
    return;
  }
  const revision = sha ?? pull.head.sha;
  const host = deploymentHost(repo, revision);
  if (!host) {
    console.log(`No successful Storybook preview deployment for ${revision}; skipping.`);
    return;
  }
  const updated = rewriteReviewLinks(pull.body ?? "", { host, revision });
  if (updated === (pull.body ?? "")) {
    console.log(`PR #${pr} review links already current.`);
    return;
  }
  if (!write) {
    console.log(updated);
    return;
  }
  const current = api<PullRequest>(path);
  if (current.head.sha !== revision) throw new Error(`PR #${pr} head changed during review link update; refusing to write`);
  if (current.body !== pull.body) throw new Error(`PR #${pr} body changed during review link update; refusing to overwrite`);
  api(path, ["--method", "PATCH", "--input", "-"], JSON.stringify({ body: updated }));
  console.log(`Updated review links for PR #${pr}.`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
