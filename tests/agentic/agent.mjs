import { spawnSync } from 'node:child_process';

if (!process.env.HOME_E2E_MODEL?.trim() || !process.env.AI_GATEWAY_API_KEY?.trim()) {
  console.error('Set HOME_E2E_MODEL and AI_GATEWAY_API_KEY explicitly; there is no model fallback.');
  process.exit(2);
}
const result = spawnSync(process.execPath, [
  'node_modules/e2e/dist/cli/bin.js', 'run', 'tests/agent.e2e.ts',
  '--workers', '1', '--retries', '0', ...process.argv.slice(2),
], { stdio: 'inherit', env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' } });
if (result.error) console.error(result.error);
process.exit(result.status ?? 3);
