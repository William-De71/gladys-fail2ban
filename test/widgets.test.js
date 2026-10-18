// The widget contents pass the validator of the SDK (what the core would
// drop or truncate), in every language and in their edge cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildOverviewWidget,
  buildRecentBansWidget,
  messageContent,
  readCount,
  banBadge,
  BANS_COUNT,
  WIDGET_ACTIONS,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ } from './helpers/fake-server.js';

const assertValid = (content, label) => assert.deepEqual(validateWidgetContent(content), [], label);
const jail = (name, banned, failed) => ({
  name,
  currentlyBanned: banned,
  currentlyFailed: failed,
  totalBanned: banned * 3,
  totalFailed: failed * 5,
  bannedIps: Array.from({ length: banned }, (_, i) => `192.0.2.${i + 1}`),
});
const ban = (ip, minutesAgo, bantime = 600, jailName = 'sshd') => ({
  ip,
  jail: jailName,
  start: NOW - minutesAgo * 60000,
  bantime,
  permanent: bantime < 0,
  until: bantime < 0 ? null : NOW - minutesAgo * 60000 + bantime * 1000,
});

test('overview: tiles, one row per jail (ten at most), buttons, in every language', () => {
  const many = Array.from({ length: 14 }, (_, i) =>
    jail(`jail-with-a-long-name-${i}`, i % 3, i % 2),
  );
  for (const language of LANGUAGES) {
    for (const jails of [[jail('sshd', 2, 3), jail('recidive', 1, 0)], many, []]) {
      const content = buildOverviewWidget({
        server: { host: 'nas.home.arpa', version: '1.1.0' },
        jails,
        readAt: NOW,
        language,
        timeZone: TZ,
        now: NOW,
      });
      assertValid(content, `${language} ${jails.length}`);
      assert.ok(content.components.length <= 8);
    }
  }
  const content = buildOverviewWidget({
    server: { host: 'nas', version: '1.1.0' },
    jails: [jail('sshd', 2, 3), jail('recidive', 1, 0)],
    readAt: NOW,
    language: 'en',
    timeZone: TZ,
    now: NOW,
  });
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['sshd', '2 banned · 3 failures', 'danger'],
      ['recidive', '1 banned · 0 failures', 'danger'],
    ],
  );
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    [WIDGET_ACTIONS.BAN, WIDGET_ACTIONS.UNBAN, WIDGET_ACTIONS.REFRESH],
  );
  assert.equal(buttons[0].action.fields[1].default, 'recidive', 'recidive first: the long ban');
  assert.equal(
    content.components.find((c) => c.variant === 'caption').text,
    'nas · Updated 21:30 · Fail2Ban 1.1.0',
  );
});

test('recent bans: newest first, what is left, permanent, the unban form', () => {
  const bans = [
    ban('203.0.113.7', 4),
    ban('2001:db8::5', 90, 7200),
    ban('198.51.100.20', 26 * 60, -1, 'recidive'),
  ];
  for (const language of LANGUAGES) {
    for (const count of [1, 6, 8]) {
      const content = buildRecentBansWidget({
        bans,
        total: 3,
        count,
        readAt: NOW,
        language,
        timeZone: TZ,
        now: NOW,
      });
      assertValid(content, `${language} ${count}`);
    }
    assertValid(
      buildRecentBansWidget({
        bans: [],
        total: 0,
        jail: 'sshd',
        count: 6,
        readAt: NOW,
        language,
        timeZone: TZ,
        now: NOW,
      }),
      language,
    );
  }
  const content = buildRecentBansWidget({
    bans,
    total: 3,
    count: 6,
    readAt: NOW,
    language: 'en',
    timeZone: TZ,
    now: NOW,
  });
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.badge.text),
    ['6 min', '30 min', 'permanent'],
  );
  assert.equal(list.items[0].description, 'Jail: sshd\nBanned at 21:26\nUntil 21:36 (10 min)');
  const form = content.components.find((c) => c.action?.key === WIDGET_ACTIONS.UNBAN_LISTED).action
    .fields[0];
  assert.deepEqual(
    form.options.map((option) => option.value),
    ['sshd|203.0.113.7', 'sshd|2001:db8::5', 'recidive|198.51.100.20'],
  );
});

test('badges, counts, messages', () => {
  assert.equal(banBadge({ permanent: false, until: null }, 'fr', NOW).text, 'bannie');
  assert.equal(banBadge({ permanent: false, until: NOW + 3 * 86400000 }, 'de', NOW).text, '3 T.');
  assert.equal(readCount(undefined, BANS_COUNT), 6);
  assert.equal(readCount('99', BANS_COUNT), 8);
  assertValid(messageContent('x'.repeat(400), { refresh: true }), 'message');
});
