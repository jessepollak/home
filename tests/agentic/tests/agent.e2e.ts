import { test } from '@e2e-dev/web';
import { fund, save, send } from '../journeys';

test('Fund: first tap to IDRX receipt', async fixtures => fund(fixtures, async goal => { await fixtures.agent.act(goal); }));
test('Save: exact deposit review', async fixtures => save(fixtures, async goal => { await fixtures.agent.act(goal); }));
test('Send: recovery submits once and reload cannot reconfirm', async fixtures => send(fixtures, async goal => { await fixtures.agent.act(goal); }));
