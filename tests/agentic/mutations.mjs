import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--agent'), 'Only --agent is supported.');
const agent = args.includes('--agent');
if (agent && (!process.env.HOME_E2E_MODEL?.trim() || !process.env.AI_GATEWAY_API_KEY?.trim())) {
  console.error('Set HOME_E2E_MODEL and AI_GATEWAY_API_KEY explicitly; there is no model fallback.');
  process.exit(2);
}
mkdirSync('.e2e/mutations', { recursive: true });
const comparison = mkdtempSync(`.e2e/mutations/${agent ? 'agent' : 'scripted'}-`);

function run(name, grep) {
  const output = `${comparison}/${name || 'baseline'}`;
  const result = spawnSync(process.execPath, [
    'node_modules/e2e/dist/cli/bin.js', 'run', `tests/${agent ? 'agent' : 'deterministic'}.e2e.ts`,
    '--workers', '1', '--retries', '0', '--no-cache', '--output', output,
    ...(grep ? ['--grep', grep] : []),
  ], {
    stdio: 'inherit', timeout: 360_000,
    env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', HOME_E2E_MUTATION: name },
  });
  assert.ifError(result.error);
  const report = JSON.parse(readFileSync(`${output}/report.json`, 'utf8'));
  return { status: result.status, results: report.run.results.filter(result => result.kind === 'test' && result.selected) };
}

const baseline = run('');
assert.equal(baseline.status, 0, 'A failed baseline cannot establish mutation detection.');
assert.equal(baseline.results.length, 3);
assert(baseline.results.every(result => result.status === 'passed'), 'Baseline must pass without skips or retries.');

for (const [name, grep, message] of [
  ['funding-first-tap', '^Fund:', /dialog.*Add money/i],
  ['funding-wrong-amount', '^Fund:', /(?:99999[\s\S]*20000|20000[\s\S]*99999)/],
  ['send-duplicate-dispatch', '^Send:', /expected "2" to be "1"/],
]) {
  const fault = run(name, grep);
  assert.equal(fault.status, 1, `${name}: expected a test failure, not a runner error.`);
  assert.equal(fault.results.length, 1);
  const result = fault.results[0];
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 1);
  const attempt = result.attempts[0];
  assert.equal(attempt.error?.code, 'ASSERTION_FAILED');
  assert.match(attempt.error.message, message);
  assert.equal(attempt.cleanup, 'complete');
  assert.equal(attempt.secondaryErrors.length, 0);
  assert(!JSON.stringify(attempt.failure).includes('chrome-error://'), 'Browser error pages do not count as fault detection.');
  console.log(`Detected ${name} at its intended oracle.`);
}
console.log(`All three seeded faults detected. Evidence: ${comparison}`);
