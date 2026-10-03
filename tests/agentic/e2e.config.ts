import type { E2EConfig } from 'e2e';
import { gateway } from 'ai';
import { existsSync } from 'node:fs';
import { engine } from './fixture';

for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  if (existsSync(new URL(`../../apps/web/${name}`, import.meta.url))) {
    throw new Error('Run the pilot in a credential-free worktree: Next loads app dotenv files.');
  }
}
const model = process.env.HOME_E2E_MODEL?.trim();

export default {
  projectId: 'home-agentic-pilot',
  tests: 'tests/**/*.e2e.ts',
  targets: [{
    name: 'chromium-mobile-viewport', engine,
    app: {
      url: 'http://127.0.0.1:0', identity: 'home-fixture-agentic-v1', environment: 'test',
      command: {
        executable: 'bun', args: ['run', 'dev', '--', '--port', '{port}'], cwd: '../../apps/web',
        startupTimeout: 120_000, log: '.e2e/server.log',
        env: { HOME_PLAYWRIGHT_SMOKE: '1', HOME_ACCESS_REQUIRED: '0', NEXT_TELEMETRY_DISABLED: '1' },
      },
    },
  }],
  workers: 1, retries: 0, timeout: 90_000, actionTimeout: 15_000, assertionTimeout: 15_000,
  trace: 'retain-on-failure', reporters: ['list', 'junit', 'markdown'],
  cache: { mode: 'read-only', strict: true },
  ...(model ? { agents: { default: {
    model: gateway(model), maxSteps: 12, maxModelCalls: 12,
    context: 'Use the exact requested amount, recipient and currency. Stop at the requested checkpoint. Never confirm or retry unless explicitly requested.',
  } } } : {}),
} satisfies E2EConfig;
