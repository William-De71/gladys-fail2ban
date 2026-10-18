// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// Fail2Ban answering like fail2ban-client 1.1.0 (test/helpers/fake-server.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, SCENE_ACTIONS, ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS, ALL_JAILS } from '../src/widgets.js';
import { TRIGGERS, QUIET_MS } from '../src/events.js';
import { fakeFail2Ban, dataPaths, silent, NOW, TZ } from './helpers/fake-server.js';

const CONFIG = { host: '192.168.1.10', username: 'gladys', interval: '60', language: 'fr' };
const PREFIX = 'ext:test-integration';
const SERVER = `${PREFIX}:server:main`;
const SSHD = `${PREFIX}:jail:sshd`;
const RECIDIVE = `${PREFIX}:jail:recidive`;
const MINUTE = 60 * 1000;

/**
 * @description The integration, connected to a fake Gladys and a fake Fail2Ban.
 * @param {object} [options] - `{ config, server, paths }`.
 * @returns {Promise<object>} `{ gladys, app, server, clock, paths }`.
 */
async function startApp({ config = CONFIG, server, paths = dataPaths() } = {}) {
  const clock = { now: NOW };
  const fake = server ?? fakeFail2Ban({ now: () => clock.now });
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    run: fake.run,
    ...paths,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  return { gladys, app, server: fake, clock, paths };
}

const created = async (gladys, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, `${externalId} is offered`);
  await gladys.fake.deviceCreated(device);
  return device;
};
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('the server and its jails become devices; the status says what was read', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.external_id, device.name, device.model]),
    [
      [SERVER, 'Fail2Ban 192.168.1.10', 'Fail2Ban 1.1.0'],
      [SSHD, 'Fail2Ban jail sshd', 'Fail2Ban jail'],
      [RECIDIVE, 'Fail2Ban jail recidive', 'Fail2Ban jail'],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to Fail2Ban 1.1.0 on 192.168.1.10: 2 jails, 3 IPs banned.',
      fr: 'Connecté à Fail2Ban 1.1.0 sur 192.168.1.10 : 2 jails, 3 IP bannies.',
      de: 'Verbunden mit Fail2Ban 1.1.0 auf 192.168.1.10: 2 Jails, 3 gesperrte IPs.',
      es: 'Conectado a Fail2Ban 1.1.0 en 192.168.1.10: 2 jails, 3 IP bloqueadas.',
    },
  });
  // The bans already there are a baseline.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('only the configured jails become devices', async (t) => {
  const { gladys } = await startApp({ config: { ...CONFIG, jails: 'sshd, nope' } });
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.external_id),
    [SERVER, SSHD],
  );
});

test('created devices get their states, sent again after the creation', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, SERVER);
  await created(gladys, SSHD);
  assert.equal(gladys.fake.lastState(`${SERVER}:banned`), 3);
  assert.equal(gladys.fake.lastState(`${SERVER}:failed`), 3);
  assert.equal(gladys.fake.lastState(`${SERVER}:total_banned`), 6);
  assert.equal(gladys.fake.lastState(`${SERVER}:jails`), 2);
  assert.equal(gladys.fake.lastState(`${SSHD}:banned`), 2);
  assert.equal(gladys.fake.lastState(`${SSHD}:total_failed`), 42);
  assert.equal(gladys.fake.lastState(`${RECIDIVE}:banned`), undefined, 'not created');
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.OVERVIEW));
});

test('a new ban fires ip_banned once, with its duration and end; an expiry fires ip_unbanned', async (t) => {
  const { gladys, app, server, clock, paths } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, SSHD);
  clock.now += MINUTE;
  server.ban('sshd', '192.0.2.44', clock.now - 20000);
  server.jails.get('sshd').bans.delete('2001:db8::5');
  await app.readNow();
  assert.deepEqual(eventsOf(gladys, TRIGGERS.IP_BANNED), [
    {
      key: TRIGGERS.IP_BANNED,
      data: {
        ip: '192.0.2.44',
        jail: 'sshd',
        banned_count: 2,
        total_banned: 6,
        ban_seconds: 600,
        permanent: false,
        until: '21:40',
        server: '192.168.1.10',
      },
    },
  ]);
  assert.deepEqual(eventsOf(gladys, TRIGGERS.IP_UNBANNED), [
    {
      key: TRIGGERS.IP_UNBANNED,
      data: { ip: '2001:db8::5', jail: 'sshd', banned_count: 2, server: '192.168.1.10' },
    },
  ]);
  assert.equal(gladys.fake.lastState(`${SSHD}:last_banned`), '192.0.2.44');
  // Read again, and after a restart: nothing fires twice.
  clock.now += MINUTE;
  await app.readNow();
  await gladys.fake.shutdown();
  const again = await startApp({ server, paths });
  t.after(() => again.gladys.fake.shutdown());
  assert.deepEqual(again.gladys.fake.sceneEvents, []);
});

test('a server in UTC: its clock is learned from a fresh ban', async (t) => {
  const clock = { now: NOW };
  const server = fakeFail2Ban({ offset: 0, now: () => clock.now });
  const { gladys, app } = await startApp({ server });
  t.after(() => gladys.fake.shutdown());
  clock.now = NOW + MINUTE;
  server.ban('sshd', '192.0.2.44', clock.now - 30000);
  await app.readNow();
  assert.equal(eventsOf(gladys, TRIGGERS.IP_BANNED)[0].data.until, '21:40', 'Paris time');
  assert.equal(app.store.data.clock.offset, 0);
});

test('Fail2Ban down: server_down after two failed readings, server_up when back', async (t) => {
  const { gladys, app, server } = await startApp();
  t.after(() => gladys.fake.shutdown());
  server.state.failure = Object.assign(new Error('connect ECONNREFUSED'), { kind: 'unreachable' });
  await assert.rejects(app.readNow());
  assert.deepEqual(eventsOf(gladys, TRIGGERS.SERVER_DOWN), [], 'one failure is not an outage');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await assert.rejects(app.readNow());
  assert.deepEqual(eventsOf(gladys, TRIGGERS.SERVER_DOWN)[0].data, {
    server: '192.168.1.10',
    reason: 'unreachable',
    message: 'Connexion SSH impossible vers 192.168.1.10 : vérifiez l’adresse et le port.',
  });
  await assert.rejects(app.readNow());
  assert.equal(eventsOf(gladys, TRIGGERS.SERVER_DOWN).length, 1, 'once');
  server.state.failure = null;
  server.state.running = false;
  await assert.rejects(app.readNow());
  server.state.running = true;
  await app.readNow();
  assert.deepEqual(eventsOf(gladys, TRIGGERS.SERVER_UP), [
    { key: TRIGGERS.SERVER_UP, data: { server: '192.168.1.10', version: '1.1.0' } },
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a stopped Fail2Ban is down at once, with its reason', async (t) => {
  const { gladys, app, server } = await startApp();
  t.after(() => gladys.fake.shutdown());
  server.state.running = false;
  await assert.rejects(app.readNow(), { kind: 'not_running' });
  assert.equal(eventsOf(gladys, TRIGGERS.SERVER_DOWN)[0].data.reason, 'not_running');
  assert.equal(gladys.fake.connectionStatus.message.en, 'Fail2Ban is not running on 192.168.1.10.');
});

test('scene actions: ban, check, unban — without firing a scene event', async (t) => {
  const { gladys, app, server, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const banned = await gladys.fake.sceneAction(SCENE_ACTIONS.BAN_IP, {
    ip: '198.51.100.9',
    jail: 'recidive',
  });
  assert.deepEqual(banned.data.outputs, {
    banned: true,
    ip: '198.51.100.9',
    jail: 'recidive',
    banned_count: 2,
  });
  assert.ok(server.jails.get('recidive').bans.has('198.51.100.9'));
  const again = await gladys.fake.sceneAction(SCENE_ACTIONS.BAN_IP, {
    ip: '198.51.100.9',
    jail: 'recidive',
  });
  assert.equal(again.data.outputs.banned, false, 'already banned');
  const check = await gladys.fake.sceneAction(SCENE_ACTIONS.CHECK_IP, { ip: '198.51.100.9' });
  assert.deepEqual(check.data.outputs, { banned: true, jails: 'recidive', jail_count: 1 });
  const unbanned = await gladys.fake.sceneAction(SCENE_ACTIONS.UNBAN_IP, { ip: '198.51.100.9' });
  assert.deepEqual(unbanned.data.outputs, { unbanned: true, ip: '198.51.100.9', jail_count: 1 });
  clock.now += MINUTE;
  await app.readNow();
  assert.deepEqual(gladys.fake.sceneEvents, [], 'what Gladys did fires nothing');
  // Later, Fail2Ban itself bans the same address: that is news again.
  clock.now += QUIET_MS;
  server.ban('recidive', '198.51.100.9');
  await app.readNow();
  assert.equal(eventsOf(gladys, TRIGGERS.IP_BANNED).length, 1);
});

test('scene actions refuse bad input: no address, unknown jail', async (t) => {
  const { gladys, server } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const bad = await gladys.fake.sceneAction(SCENE_ACTIONS.BAN_IP, {
    ip: '1.2.3.4; reboot',
    jail: 'sshd',
  });
  assert.equal(bad.success, false);
  assert.match(bad.error, /not an IP address/);
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.BAN_IP, {
    ip: '192.0.2.1',
    jail: 'nope',
  });
  assert.match(unknown.error, /does not exist/);
  assert.ok(!server.calls.some((command) => command.includes('reboot')));
});

test('the summary for a message', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const answer = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_SUMMARY);
  assert.deepEqual(answer.data.outputs, {
    banned: 3,
    failed: 3,
    total_banned: 6,
    jail_count: 2,
    summary:
      'Fail2Ban sur 192.168.1.10 : 3 IP bannies dans 2 jails, 3 échecs en cours, 6 bannissements depuis le démarrage.',
  });
});

test('widgets: valid contents in every language, recent bans newest first', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const [key, settings] of [
      [WIDGETS.OVERVIEW, {}],
      [WIDGETS.RECENT_BANS, {}],
      [WIDGETS.RECENT_BANS, { jail: 'recidive', count: 1 }],
    ]) {
      const answer = await gladys.fake.widgetGet(key, { language, settings });
      assert.ok(answer.success, `${key} ${language}`);
      assert.deepEqual(validateWidgetContent(answer.data.content), [], `${key} ${language}`);
    }
  }
  const recent = await gladys.fake.widgetGet(WIDGETS.RECENT_BANS, { language: 'fr' });
  const list = recent.data.content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge.text]),
    [
      ['203.0.113.7', 'sshd · depuis 21:26', '6 min'],
      ['2001:db8::5', 'sshd · depuis 21:10', 'bannie'],
      ['198.51.100.20', 'recidive · depuis 16/10 19:30', 'définitif'],
    ],
  );
  const unknown = await gladys.fake.widgetGet(WIDGETS.RECENT_BANS, {
    language: 'en',
    settings: { jail: 'nope' },
  });
  assert.equal(unknown.data.content.components[0].text, 'The jail nope does not exist.');
});

test('widget buttons: ban and unban forms, unban from the list, refresh', async (t) => {
  const { gladys, server } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const ban = await gladys.fake.widgetAction(
    WIDGETS.OVERVIEW,
    WIDGET_ACTIONS.BAN,
    {},
    {
      values: { ip: '192.0.2.7', jail: 'sshd' },
    },
  );
  assert.equal(ban.data.message.fr, '192.0.2.7 bannie dans sshd.');
  const all = await gladys.fake.widgetAction(
    WIDGETS.OVERVIEW,
    WIDGET_ACTIONS.UNBAN,
    {},
    {
      values: { ip: '192.0.2.7', jail: ALL_JAILS },
    },
  );
  assert.equal(all.data.message.en, '192.0.2.7 unbanned from 1 jail.');
  const none = await gladys.fake.widgetAction(
    WIDGETS.OVERVIEW,
    WIDGET_ACTIONS.UNBAN,
    {},
    {
      values: { ip: '192.0.2.7', jail: 'sshd' },
    },
  );
  assert.equal(none.data.message.en, '192.0.2.7 was not banned.');
  const bad = await gladys.fake.widgetAction(
    WIDGETS.OVERVIEW,
    WIDGET_ACTIONS.BAN,
    {},
    {
      values: { ip: 'example.com', jail: 'sshd' },
    },
  );
  assert.equal(bad.data.message.de, '„example.com“ ist keine IP-Adresse.');
  const listed = await gladys.fake.widgetAction(
    WIDGETS.RECENT_BANS,
    WIDGET_ACTIONS.UNBAN_LISTED,
    {},
    {
      values: { ban: 'recidive|198.51.100.20' },
    },
  );
  assert.equal(listed.data.message.es, '198.51.100.20 desbloqueada en 1 jail.');
  assert.equal(server.jails.get('recidive').bans.size, 0);
  const refresh = await gladys.fake.widgetAction(WIDGETS.RECENT_BANS, WIDGET_ACTIONS.REFRESH);
  assert.equal(refresh.data.message.en, 'Read again: 2 IPs banned.');
  for (const message of [ban, all, none, bad, listed, refresh].map(
    (answer) => answer.data.message,
  )) {
    assert.ok(Object.values(message).every((text) => text.length <= 200));
  }
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('configuration actions: test, public key, host key, diagnostic without secrets', async (t) => {
  const config = { ...CONFIG, auth_method: 'password', password: 'p4ss-w0rd' };
  const { gladys, app } = await startApp({ config });
  t.after(() => gladys.fake.shutdown());
  const tested = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(
    tested.data.message.en,
    /^Connected to 192\.168\.1\.10 .* Fail2Ban 1\.1\.0: 2 jails \(sshd, recidive\), 3 IPs banned\.$/,
  );
  const key = await gladys.fake.action(ACTIONS.SHOW_PUBLIC_KEY);
  assert.match(key.data.message.fr, /restrict ssh-ed25519 AAAA\S+ gladys-fail2ban$/);
  const none = await gladys.fake.action(ACTIONS.FORGET_HOST_KEY);
  assert.equal(none.data.message.en, 'No host key is stored yet.');
  app.store.data.hostKeys['192.168.1.10:22'] = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const forgotten = await gladys.fake.action(ACTIONS.FORGET_HOST_KEY);
  assert.match(forgotten.data.message.en, /forgotten/);
  assert.deepEqual(app.store.data.hostKeys, {});
  const logged = [];
  const logger = { ...silent, info: (line) => logged.push(line) };
  const second = createFakeGladys({ config });
  createApp(second, {
    run: fakeFail2Ban().run,
    ...dataPaths(),
    timers: false,
    logger,
    timeZone: TZ,
  });
  await second.connect();
  t.after(() => second.fake.shutdown());
  await second.fake.action(ACTIONS.DIAGNOSTIC);
  const report = logged.filter((line) => line.startsWith('Fail2Ban diagnostic')).join('');
  assert.match(report, /"password":"set"/);
  assert.doesNotMatch(report, /p4ss-w0rd|PRIVATE KEY/);
});

test('not configured: a clear status, no command, widgets that say so', async (t) => {
  const { gladys, server } = await startApp({ config: { language: 'en' } });
  t.after(() => gladys.fake.shutdown());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the address/);
  assert.deepEqual(server.calls, []);
  const widget = await gladys.fake.widgetGet(WIDGETS.OVERVIEW, { language: 'fr' });
  assert.match(widget.data.content.components[0].text, /Renseignez/);
  assert.equal((await gladys.fake.sceneAction(SCENE_ACTIONS.GET_SUMMARY)).success, false);
});

test('another server: its bans are a new baseline', async (t) => {
  const { gladys, server, paths } = await startApp();
  await gladys.fake.shutdown();
  server.ban('sshd', '192.0.2.99');
  const other = await startApp({ config: { ...CONFIG, host: '192.168.1.11' }, server, paths });
  t.after(() => other.gladys.fake.shutdown());
  assert.deepEqual(other.gladys.fake.sceneEvents, []);
});
