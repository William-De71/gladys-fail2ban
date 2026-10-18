import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serverInstant, learnOffset, formatWhen, formatDuration, zoneOffset } from '../src/time.js';
import { naiveInstant } from '../src/fail2ban.js';

const TZ = 'Europe/Paris';

test('a server time is read in the timezone of Gladys, or with the learned offset', () => {
  const naive = naiveInstant('2026-10-17 21:24:45');
  assert.equal(
    new Date(serverInstant(naive, { timeZone: TZ })).toISOString(),
    '2026-10-17T19:24:45.000Z',
  );
  assert.equal(
    new Date(serverInstant(naive, { offset: 0, timeZone: TZ })).toISOString(),
    '2026-10-17T21:24:45.000Z',
  );
  assert.equal(
    new Date(serverInstant(naiveInstant('2026-01-10 12:00:00'), { timeZone: TZ })).toISOString(),
    '2026-01-10T11:00:00.000Z',
  );
  assert.equal(serverInstant(null, {}), null);
  assert.equal(zoneOffset(Date.parse('2026-07-01T00:00:00Z'), TZ), 7200000);
});

test('the offset of a UTC server, learned from a ban seen as it happened', () => {
  const readAt = Date.parse('2026-10-17T19:30:00Z');
  // The ban happened 40 s before the reading, on a server in UTC.
  assert.equal(learnOffset(naiveInstant('2026-10-17 19:29:20'), readAt), 0);
  assert.equal(learnOffset(naiveInstant('2026-10-17 21:28:10'), readAt), 2 * 3600 * 1000);
  assert.equal(learnOffset(naiveInstant('2026-10-18 01:00:00'), readAt), 5.5 * 3600 * 1000);
});

test('times and durations for the widgets', () => {
  const now = Date.parse('2026-10-17T19:30:00Z');
  assert.equal(formatWhen(now - 60000, { language: 'fr', timeZone: TZ, now }), '21:29');
  assert.equal(
    formatWhen(now - 2 * 86400000, { language: 'fr', timeZone: TZ, now }),
    '15/10 21:30',
  );
  assert.equal(formatWhen(null, {}), '');
  const units = { s: 's', min: 'min', h: 'h', d: 'd' };
  assert.equal(formatDuration(45, units), '45 s');
  assert.equal(formatDuration(600, units), '10 min');
  assert.equal(formatDuration(7200, units), '2 h');
  assert.equal(formatDuration(5 * 86400, units), '5 d');
  assert.equal(formatDuration(-1, units), '');
});
