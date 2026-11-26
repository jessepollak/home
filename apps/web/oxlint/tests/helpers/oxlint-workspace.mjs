import { afterAll, expect } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Rule cases share one Oxlint language server per workspace while the configuration is unchanged, so each phase gets its own
// budget instead of sharing bun's 5 s default: under concurrent load the first lint, which starts it, can outlast it.
export const budgetMs = 60_000;

const appsWebDir = fileURLToPath(new URL("../../..", import.meta.url));
const oxlintBin = path.join(appsWebDir, "node_modules", ".bin", "oxlint");
const homePlugin = "./oxlint/home-plugin.mjs";

function normalized(rule) {
  return rule.includes("/") ? rule : `home/${rule}`;
}

function ruleSettings(request) {
  if (request.rule !== undefined) {
    return { [normalized(request.rule)]: request.options === undefined ? "error" : ["error", request.options] };
  }
  const rules = request.rules;
  if (typeof rules === "string") return { [normalized(rules)]: "error" };
  if (Array.isArray(rules)) return Object.fromEntries(rules.map((rule) => [normalized(rule), "error"]));
  return Object.fromEntries(Object.entries(rules).map(([rule, setting]) => [normalized(rule), setting]));
}

function diagnosticCodes(settings) {
  return new Set(Object.keys(settings).map((rule) => `home(${rule.replace(/^home\//u, "")})`));
}

function destination(directory, value) {
  return path.resolve(directory, String(value));
}

const lintableFile = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/u;

function utf8Offset(text, { line, character }) {
  let index = 0;
  for (let current = 0; current < line; current += 1) {
    const next = text.indexOf("\n", index);
    if (next < 0) return Buffer.byteLength(text);
    index = next + 1;
  }
  return Buffer.byteLength(text.slice(0, index + character));
}

function span(text, range) {
  const offset = utf8Offset(text, range.start);
  return { offset, length: utf8Offset(text, range.end) - offset, line: range.start.line + 1, column: range.start.character + 1 };
}

// The JSON reporter's shape for one language-server diagnostic: tests read its code, message, filename and labels.
function reported(diagnostic, filename, text) {
  const related = diagnostic.relatedInformation?.length ? diagnostic.relatedInformation : [{ location: { range: diagnostic.range }, message: "" }];
  return {
    message: diagnostic.message,
    code: String(diagnostic.code ?? ""),
    severity: diagnostic.severity === 1 ? "error" : "warning",
    url: diagnostic.codeDescription?.href,
    filename,
    labels: related.map((entry) => ({ ...(entry.message ? { label: entry.message } : {}), span: span(text, entry.location.range) })),
  };
}

// One long-lived `oxlint --lsp` per workspace, restarted only when a case needs another configuration: every case opens
// its fixtures, waits for the diagnostics published for exactly that document version, then closes them.
function startLanguageServer(directory, config, label) {
  const child = spawn(oxlintBin, ["--lsp"], { cwd: directory, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let stderr = "";
  let nextId = 0;
  let failure = null;
  const requests = new Map();
  const published = new Map();
  const fail = (error) => {
    failure ??= error;
    for (const { reject } of [...requests.values(), ...published.values()]) reject(failure);
    requests.clear();
    published.clear();
  };
  const send = (message) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const receive = (message) => {
    if (message.method !== undefined && message.id !== undefined) return send({ id: message.id, result: null });
    if (message.id !== undefined) {
      const request = requests.get(message.id);
      requests.delete(message.id);
      return message.error ? request?.reject(new Error(`${label}: ${message.error.message}`)) : request?.resolve(message.result);
    }
    if (message.method !== "textDocument/publishDiagnostics") return;
    const key = `${message.params.uri}@${message.params.version}`;
    published.get(key)?.resolve(message.params.diagnostics);
    published.delete(key);
  };
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: *(\d+)/iu.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
      if (buffer.length < headerEnd + 4 + length) return;
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
      buffer = buffer.subarray(headerEnd + 4 + length);
      receive(JSON.parse(body));
    }
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`${label}: oxlint --lsp exited (${signal ?? code}): ${stderr}`)));
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    send({ id, method, params });
  });
  const workspaceUri = pathToFileURL(directory).href;
  const ready = request("initialize", {
    processId: process.pid,
    rootUri: workspaceUri,
    workspaceFolders: [{ uri: workspaceUri, name: label }],
    capabilities: {},
    initializationOptions: [{ workspaceUri, options: { run: "onType", configPath: config, disableNestedConfig: true } }],
  }).then(() => send({ method: "initialized", params: {} }));
  let version = 0;

  async function lintDocuments(documents) {
    await ready;
    const opened = documents.map((document) => {
      version += 1;
      const uri = pathToFileURL(document.file).href;
      const diagnostics = new Promise((resolve, reject) => {
        if (failure) return reject(failure);
        published.set(`${uri}@${version}`, { resolve, reject });
      });
      send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version, text: document.code } } });
      return { uri, diagnostics };
    });
    try {
      return await Promise.all(opened.map((entry) => entry.diagnostics));
    } finally {
      for (const { uri } of opened) send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
    }
  }

  function stop() {
    fail(new Error(`${label}: language server stopped`));
    child.kill();
  }
  return { lintDocuments, stop };
}

// A workspace is a throwaway project mirror that resolves the home plugin the way apps/web does:
// the pinned Oxlint binary, the plugin from ./oxlint, and node_modules linked to the real tree.
export async function createOxlintWorkspace(prefix, options = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  await cp(path.join(appsWebDir, "oxlint"), path.join(directory, "oxlint"), { recursive: true });
  await symlink(path.join(appsWebDir, "node_modules"), path.join(directory, "node_modules"), "dir");
  const fixturePath = options.path ?? ((name) => `${name}.ts`);
  let configIndex = 0;
  let server = null;

  async function writeConfig(settings) {
    configIndex += 1;
    const config = `.oxlintrc-${configIndex}.json`;
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [homePlugin],
      rules: settings,
    }));
    return config;
  }

  function collect(fixtures) {
    const entries = Object.entries(fixtures).map(([name, fixture]) => {
      const value = typeof fixture === "string" ? { code: fixture } : fixture;
      return { name, code: value.code, path: value.path ?? fixturePath(name) };
    });
    const keys = new Set(entries.map((entry) => destination(directory, entry.path)));
    if (keys.size !== entries.length) throw new Error(`Duplicate fixture paths in ${prefix}: ${entries.map((entry) => entry.path).join(", ")}`);
    return entries;
  }

  function lintWithCli(entries, config, flags) {
    const result = spawnSync(oxlintBin,
      ["-c", config, "--disable-nested-config", "-f", "json", ...flags, ...entries.map((entry) => entry.path)],
      { cwd: directory, encoding: "utf8" });
    expect(result.signal).toBeNull();
    expect([0, 1]).toContain(result.status);
    expect(result.stdout).not.toBeEmpty();
    try {
      return JSON.parse(result.stdout).diagnostics ?? [];
    } catch {
      throw new Error(`Oxlint produced no JSON report for ${prefix} (status ${result.status}): ${result.stdout.slice(0, 300)} ${result.stderr.slice(0, 300)}`);
    }
  }

  async function lintWithServer(entries, config) {
    const configText = await readFile(path.join(directory, config), "utf8");
    if (server?.configText !== configText) {
      server?.stop();
      server = { configText, ...startLanguageServer(directory, config, prefix) };
    }
    const documents = entries.filter((entry) => lintableFile.test(entry.path))
      .map((entry) => ({ entry, file: destination(directory, entry.path), code: entry.code }));
    const published = await server.lintDocuments(documents);
    return documents.flatMap(({ entry, code }, index) => published[index].map((diagnostic) => reported(diagnostic, entry.path, code)));
  }

  // Every fixture is written before any is linted and each finding is attributed back by fixture path. The language
  // server lints only files inside its workspace and loads the plugin once, so requests with CLI flags, fixtures outside
  // the workspace, or `freshProcess` (a case that changes files the plugin reads at load) run a new Oxlint CLI process.
  async function lintWithConfig(fixtures, { config, flags = [], freshProcess = false } = {}) {
    const entries = collect(fixtures);
    await Promise.all(entries.map(async (entry) => {
      const file = destination(directory, entry.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.code);
    }));
    const outside = entries.some((entry) => path.relative(directory, destination(directory, entry.path)).startsWith(".."));
    const diagnostics = flags.length || freshProcess || outside ? lintWithCli(entries, config, flags) : await lintWithServer(entries, config);
    const names = new Map(entries.map((entry) => [destination(directory, entry.path), entry.name]));
    const findings = Object.fromEntries(entries.map((entry) => [entry.name, []]));
    for (const diagnostic of diagnostics) {
      const filename = String(diagnostic.filename ?? "");
      const name = names.get(destination(directory, filename));
      if (name === undefined) throw new Error(`Unattributed diagnostic for ${diagnostic.filename} in ${prefix}`);
      findings[name].push(diagnostic);
    }
    return findings;
  }

  // `request` is { rule, options } for one home rule, or { rules } as a rule name, a list, or a
  // settings map. Without either, the workspace rules from the options argument apply.
  async function lint(fixtures, request = {}) {
    const configured = request.rule !== undefined || request.rules !== undefined;
    const settings = ruleSettings(configured ? request : { rules: options.rules ?? [] });
    const codes = diagnosticCodes(settings);
    if (!codes.size) throw new Error(`No rules configured for ${prefix}`);
    const config = await writeConfig(settings);
    const findings = await lintWithConfig(fixtures, { config, flags: request.flags, freshProcess: request.freshProcess });
    return Object.fromEntries(Object.entries(findings).map(([name, diagnostics]) =>
      [name, diagnostics.filter((diagnostic) => codes.has(diagnostic.code))]));
  }

  afterAll(async () => {
    server?.stop();
    await rm(directory, { recursive: true, force: true });
  }, budgetMs);
  return { directory, lint, lintWithConfig };
}
