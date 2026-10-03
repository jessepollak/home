import { test } from '@e2e-dev/web';
import { fund, save, send, scripted } from '../journeys';

test('Fund: first tap to IDRX receipt', async fixtures => fund(fixtures, scripted));
test('Save: exact deposit review', async fixtures => save(fixtures, scripted));
test('Send: recovery submits once and reload cannot reconfirm', async fixtures => send(fixtures, scripted));
