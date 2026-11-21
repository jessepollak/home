import { parseArgs } from "node:util";
import { INVARIANTS } from "./invariants";
import type { RunResult } from "./run";
import { simulateSeeds, type Crashed, type WorkerOutput } from "./worker";

const DEFAULT_FORK_BLOCK = "60173963";
const RESULT_MARKER = "MONEY_SIM_RESULT ";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    runs: { type: "string", default: "100" },
    seed: { type: "string" },
    "base-seed": { type: "string", default: "1" },
    block: { type: "string", default: DEFAULT_FORK_BLOCK },
    workers: { type: "string", default: "4" },
    "worker-seeds": { type: "string" },
    repro: { type: "string" },
    "land-first": { type: "string", default: "B" },
    verbose: { type: "boolean", default: false },
  },
});
const forkBlock = BigInt(values.block);
const silence = () => {
  if (values.verbose) return;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) console[method] = () => undefined;
};

if (values.repro !== undefined) {
  if (values.repro !== "cashout-swap" || (values["land-first"] !== "A" && values["land-first"] !== "B")) throw new Error("--repro takes cashout-swap; --land-first takes A or B");
  const print = console.log.bind(console);
  silence();
  const { reproCashoutSwap } = await import("./repro-cashout-swap");
  const { reproduced, lines } = await reproCashoutSwap(forkBlock, values["land-first"]);
  print([`cash-out swap repro (two identical cash-outs prepared before either confirms; ${values["land-first"]}'s deposit lands first)`, ...lines,
    reproduced ? "REPRODUCED: each finalized cash-out is still linked to the other's deposit" : "not reproduced"].join("\n"));
  process.exit(reproduced ? 1 : 0);
}

if (values["worker-seeds"] !== undefined) {
  const seeds = values["worker-seeds"].split(",").map(Number);
  const write = process.stdout.write.bind(process.stdout);
  const progress = process.stderr.write.bind(process.stderr);
  silence();
  const output = await simulateSeeds(seeds, forkBlock, (done) => { if (done % 25 === 0) progress("."); });
  write(`${RESULT_MARKER}${JSON.stringify(output)}\n`);
  process.exit(0);
}

const replay = values.seed !== undefined;
const seeds = replay
  ? [Number(values.seed)]
  : Array.from({ length: Number(values.runs) }, (_, index) => Number(values["base-seed"]) + index);
if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new Error("--runs, --seed and --base-seed take non-negative integers");
const workers = Math.max(1, Math.min(replay ? 1 : Number(values.workers) || 1, seeds.length));
const startedAt = performance.now();
const print = console.log.bind(console);

let output: WorkerOutput;
if (workers === 1) {
  silence();
  output = await simulateSeeds(seeds, forkBlock);
} else {
  const chunks = Array.from({ length: workers }, (_, worker) => seeds.filter((_, index) => index % workers === worker));
  const outputs = await Promise.all(chunks.map(async (chunk) => {
    const child = Bun.spawn(["bun", "--conditions=react-server", import.meta.path, "--block", forkBlock.toString(), "--worker-seeds", chunk.join(",")],
      { stdout: "pipe", stderr: "inherit", env: process.env });
    const text = await new Response(child.stdout).text();
    await child.exited;
    const line = text.split("\n").find((entry) => entry.startsWith(RESULT_MARKER));
    if (!line) return { results: chunk.map((seed) => ({ seed, crashed: `worker exited ${child.exitCode} without a result` })), stubbed: [], upstream: "BASE_RPC_URL", retried: [], peerRequestsRefused: 0 } satisfies WorkerOutput;
    return JSON.parse(line.slice(RESULT_MARKER.length)) as WorkerOutput;
  }));
  process.stderr.write("\n");
  output = { results: outputs.flatMap((entry) => entry.results).sort((a, b) => a.seed - b.seed), stubbed: outputs[0]!.stubbed, upstream: outputs[0]!.upstream,
    retried: outputs.flatMap((entry) => entry.retried).sort((a, b) => a - b),
    peerRequestsRefused: outputs.reduce((total, entry) => total + entry.peerRequestsRefused, 0) };
}

const results = output.results;
const completed = results.filter((result): result is RunResult => !("crashed" in result));
const crashed = results.filter((result): result is Crashed => "crashed" in result);
const passing = completed.filter((result) => result.violations.length === 0);
const sum = (pick: (result: RunResult) => number) => completed.reduce((total, result) => total + pick(result), 0);
const share = results.length ? (100 * passing.length) / results.length : 0;
const brokenIn = (name: string) => completed.filter((result) => result.violations.some((violation) => violation.invariant === name)).length;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Phase = "entry" | "exit";
const phaseLines = (phase: Phase, label: string, kinds: string) => [
  `${label.padEnd(10)}${sum((r) => r[phase].actions)} actions (${kinds}): ` +
    `${sum((r) => r[phase].landed.succeeded)} landed ok, ${sum((r) => r[phase].landed.reverted)} landed reverted, ${sum((r) => r[phase].prepareRefused)} refused by Home before dispatch`,
  `          faults: lost handle post ${sum((r) => r[phase].faults.lostHandle)}; reverted ${sum((r) => r[phase].faults.innerRevert)} in the wallet + ` +
    `${sum((r) => r[phase].faults.bundleRevert)} as a bundle (then resubmitted); double confirm ${sum((r) => r[phase].faults.doubleConfirm)} ` +
    `(both accepted ${sum((r) => r[phase].doubleConfirmBothAccepted)}); decline then retry ${sum((r) => r[phase].faults.declineRetry)}`,
  `          ${completed.filter((r) => r[phase].maxInFlight >= 2).length} runs had 2+ confirmed actions in flight at once; ` +
    `${sum((r) => r[phase].lostHandleUnresolved)} lost-handle actions stay unresolved in Home (documented: no handle, no trigger can find them)`,
];
const kindCount = (phase: Phase, kind: keyof RunResult["entry"]["kinds"]) => sum((r) => r[phase].kinds[kind]);

const lines = [
  "Home money-action simulation: send, Save deposit, Save withdraw and Peer cash-out on a Base mainnet fork",
  `fork      Base mainnet at block ${forkBlock} (anvil, ${output.upstream} upstream); scratch Postgres with every migration`,
  `runs      ${plural(results.length, "seeded run")} (${replay ? `seed ${seeds[0]}` : `seeds ${seeds[0]}-${seeds.at(-1)}`}), ` +
    `${workers} ${workers === 1 ? "world" : "parallel worlds"}, ${((performance.now() - startedAt) / 60_000).toFixed(1)} min; each run is an entry phase then an exit phase`,
  ...phaseLines("entry", "entry", `${kindCount("entry", "send")} send, ${kindCount("entry", "savings-deposit")} Save deposit`),
  ...phaseLines("exit", "exit", `${kindCount("exit", "savings-withdraw")} Save withdraw, ${kindCount("exit", "cash-out")} cash-out, ` +
    `${kindCount("exit", "cash-out-withdraw")} cash-out cancel, ${kindCount("exit", "send")} send, ${kindCount("exit", "savings-deposit")} Save deposit`),
  `guard     ${plural(sum((r) => r.guard.pairs), "same-amount cash-out pair")} reached prepare; the Peer guard refused ${plural(sum((r) => r.guard.refused), "cash-out")} ` +
    `(unexpected refusals count under cash-out-guard); ${plural(sum((r) => r.guard.accepted), "cash-out")} accepted; ${plural(sum((r) => r.guard.cancelsSkipped), "cancel")} skipped (deposit never landed); ` +
    `${output.peerRequestsRefused} requests to Peer's real services refused locally`,
  "",
  `RESULT    ${share.toFixed(1)}% of seeded runs held every invariant (${passing.length}/${results.length})`,
  "",
  ...INVARIANTS.map((name) => `  ${name.padEnd(24)} broken in ${plural(brokenIn(name), "run")}`),
  ...(crashed.length ? [`  ${"simulation crashed".padEnd(24)} in ${plural(crashed.length, "run")}`] : []),
  ...(output.retried.length ? ["", `harness   ${plural(output.retried.length, "run")} hit a fork or RPC error and ran again from the baseline: ${output.retried.slice(0, 20).join(", ")}${output.retried.length > 20 ? ", ..." : ""}`] : []),
];
const failing: Array<RunResult | Crashed> = [...completed.filter((result) => result.violations.length), ...crashed];
if (failing.length) {
  lines.push("", "failing seeds (first violation):");
  for (const result of failing.slice(0, 40)) {
    lines.push("crashed" in result
      ? `  ${String(result.seed).padStart(6)}  crashed: ${result.crashed}`
      : `  ${String(result.seed).padStart(6)}  ${result.violations[0]!.invariant} at step ${result.violations[0]!.step}: ${result.violations[0]!.detail}` +
        (result.violations.length > 1 ? ` (+${result.violations.length - 1} more)` : ""));
  }
  if (failing.length > 40) lines.push(`  ... ${failing.length - 40} more`);
  if (!replay) lines.push("", "replay one: bun run --cwd apps/web sim:money -- --seed <seed>");
}
if (replay && completed[0]) {
  lines.push("", "violations:", ...(completed[0].violations.length
    ? completed[0].violations.map((violation) => `  step ${violation.step} ${violation.invariant}: ${violation.detail}`) : ["  none"]));
}
lines.push("", "stand-ins: Peer's offchain services (payee registration hashes, the deposit indexer read from the fork's escrow events " +
  "with no lag, withdraw calldata in the form Home's boundary check verifies, no buyer ever fills, no fill-time statistics); " +
  "the customer's CDP wallet and bundler are a Coinbase Smart Wallet v1.1 with a seeded test key whose user operations " +
  "a local EOA submits to EntryPoint v0.6 (CDP idempotency modelled per action id); USDC comes from an impersonated Morpho Blue balance; " +
  "the session authorizer returns the seeded owner; a balances read that fails is retried once before it counts; Next after() is a queue whose tasks each run one follow-through step; one virtual clock " +
  "(2 s per block) drives Home, Postgres now() and the fork; Save prepare skips the Morpho GraphQL rate read" +
  (output.stubbed.length ? `; ${output.stubbed.length} B20 registry tokens anvil cannot execute read as balance 0 (${output.stubbed.join(", ")})` : "") + ".");
print(lines.join("\n"));
process.exit(passing.length === results.length ? 0 : 1);
