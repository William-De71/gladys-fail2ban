import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectBanChanges,
  bannedData,
  unbannedData,
  downReason,
  totals,
  pick,
  BAN_OUTPUTS,
} from '../src/events.js';

const jail = (name, bannedIps) => ({
  name,
  bannedIps,
  currentlyBanned: bannedIps.length,
  currentlyFailed: 1,
  totalBanned: 10,
  totalFailed: 20,
});

test('the first reading of a jail is a baseline', () => {
  const { banned, unbanned, next } = detectBanChanges({
    jails: [jail('sshd', ['203.0.113.7'])],
    previous: {},
    now: 0,
  });
  assert.deepEqual([banned, unbanned], [[], []]);
  assert.deepEqual(next, { sshd: ['203.0.113.7'] });
});

test('bans and unbans between two readings, one event each', () => {
  const { banned, unbanned } = detectBanChanges({
    jails: [jail('sshd', ['203.0.113.7', '198.51.100.1']), jail('recidive', [])],
    previous: { sshd: ['203.0.113.7', '2001:db8::5'], recidive: ['198.51.100.20'] },
    now: 0,
  });
  assert.deepEqual(banned, [{ jail: 'sshd', ip: '198.51.100.1' }]);
  assert.deepEqual(unbanned, [
    { jail: 'sshd', ip: '2001:db8::5' },
    { jail: 'recidive', ip: '198.51.100.20' },
  ]);
});

test('a change made by the integration stays quiet', () => {
  const quiet = new Map([['sshd|198.51.100.1', 1000]]);
  const changes = detectBanChanges({
    jails: [jail('sshd', ['198.51.100.1'])],
    previous: { sshd: [] },
    quiet,
    now: 500,
  });
  assert.deepEqual([changes.banned, changes.quieted], [[], 1]);
  const later = detectBanChanges({
    jails: [jail('sshd', ['198.51.100.1'])],
    previous: { sshd: [] },
    quiet,
    now: 2000,
  });
  assert.equal(later.banned.length, 1);
});

test('payloads are flat, scalar and within the limits', () => {
  const payloads = [
    bannedData(
      { jail: 'sshd', ip: '2001:db8::5' },
      {
        jail: jail('sshd', ['2001:db8::5']),
        ban: { bantime: 600, permanent: false },
        until: '21:34',
        server: 'nas',
      },
    ),
    bannedData(
      { jail: 'recidive', ip: '198.51.100.20' },
      { jail: undefined, ban: { bantime: -1, permanent: true }, until: 'permanent', server: 'nas' },
    ),
    bannedData(
      { jail: 'sshd', ip: '203.0.113.7' },
      { jail: undefined, ban: null, until: '', server: 'nas' },
    ),
    unbannedData({ jail: 'sshd', ip: '203.0.113.7' }, { jail: jail('sshd', []), server: 'nas' }),
  ];
  for (const data of payloads) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
      assert.ok(typeof value !== 'string' || value.length <= 1000);
    }
  }
  assert.equal(payloads[0].ban_seconds, 600);
  assert.equal(payloads[1].ban_seconds, null);
  assert.equal(payloads[1].permanent, true);
});

test('reasons, totals, declared outputs only', () => {
  assert.equal(downReason('timeout'), 'unreachable');
  assert.equal(downReason('sudo'), 'permission');
  assert.equal(downReason('whatever'), 'other');
  assert.deepEqual(totals([jail('a', ['x']), jail('b', ['y', 'z'])]), {
    banned: 3,
    failed: 2,
    totalBanned: 20,
    totalFailed: 40,
  });
  assert.deepEqual(
    Object.keys(pick({ banned: true, ip: 'x', jail: 'j', banned_count: 1, extra: 1 }, BAN_OUTPUTS)),
    BAN_OUTPUTS,
  );
});
