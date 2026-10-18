// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import {
  idsOf,
  jailKey,
  parseExternalId,
  buildServerDevice,
  buildJailDevice,
  buildServerStates,
  buildJailStates,
  DEVICE_TYPES,
} from '../src/device.js';
import { parseStatus } from '../src/fail2ban.js';
import { LANGUAGES } from '../src/i18n.js';
import { readFileSync } from 'node:fs';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:fail2ban:${type}:${id}`,
    feature: (key) => `ext:fail2ban:${type}:${id}:${key}`,
  }),
};
const { jails } = parseStatus(
  readFileSync(new URL('./fixtures/status-all.txt', import.meta.url), 'utf8'),
);
const SERVER = { host: '192.168.1.10', port: 22, version: '1.1.0' };

const devices = (language, gladys = fakeGladys) => [
  buildServerDevice(gladys, SERVER, language),
  ...jails.map((jail) => buildJailDevice(gladys, jail, language)),
];

// Pairs with an icon and a label in the Gladys front (front/src/utils/consts.js).
const PAIRS = [
  [DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT],
  [DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER],
];

test('devices are never polled by Gladys: the integration has its own timer', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) {
          assert.equal(typeof feature[key], 'number', `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(feature.read_only, true, feature.external_id);
        assert.equal(feature.has_feedback, false, feature.external_id);
        assert.ok(feature.name.length > 0 && feature.name.length <= 255);
      }
      const names = new Set(device.features.map((feature) => feature.name));
      assert.equal(names.size, device.features.length, 'every feature has its own name');
    }
  }
});

test('category / type pairs known to the Gladys front, from the SDK constants', () => {
  for (const feature of devices('en').flatMap((device) => device.features)) {
    assert.ok(
      PAIRS.some(
        ([category, type]) =>
          feature.category === category && feature.type === type && feature.unit === undefined,
      ),
      `${feature.external_id}: ${feature.category}/${feature.type}`,
    );
  }
});

test('ids: one server, the jail name folded; read back', () => {
  const [server, app] = devices('fr');
  assert.equal(server.external_id, 'ext:fail2ban:server:main');
  assert.equal(server.name, 'Fail2Ban 192.168.1.10');
  assert.equal(app.external_id, 'ext:fail2ban:jail:lab-app');
  assert.equal(app.name, 'Fail2Ban jail lab-app');
  assert.equal(jailKey('Postfix.SASL'), 'postfix-sasl');
  assert.deepEqual(parseExternalId('ext:fail2ban:jail:lab-app:banned'), {
    type: 'jail',
    key: 'lab-app',
  });
  assert.equal(parseExternalId('nothing'), null);
  assert.deepEqual(
    app.params.map((param) => [param.name, param.value]),
    [
      ['FAIL2BAN_JAIL', 'lab-app'],
      ['FAIL2BAN_LOGS', '/var/log/app.log'],
    ],
  );
  assert.equal(
    buildServerDevice(fakeGladys, { ...SERVER, port: 2222 }).params[0].value,
    '192.168.1.10:2222',
  );
});

test('states: counters as numbers, the last banned IP as a text', () => {
  const byKey = (states) =>
    Object.fromEntries(
      states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state ?? s.text]),
    );
  assert.deepEqual(byKey(buildServerStates(fakeGladys, jails)), {
    banned: 2,
    failed: 0,
    total_banned: 7,
    jails: 2,
  });
  assert.deepEqual(byKey(buildJailStates(fakeGladys, jails[1], '198.51.100.20')), {
    banned: 2,
    failed: 0,
    total_banned: 5,
    total_failed: 5,
    last_banned: '198.51.100.20',
  });
  assert.equal(buildJailStates(fakeGladys, jails[0]).length, 4, 'no text before a ban was seen');
});

test('the discovery batch and the states pass the checks of the fake host API', async (t) => {
  const gladys = createFakeGladys({});
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  for (const language of LANGUAGES) {
    await gladys.publishDiscoveredDevices(devices(language, gladys));
  }
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await gladys.publishStates([
    ...buildServerStates(gladys, jails),
    ...buildJailStates(gladys, jails[1], '198.51.100.20'),
  ]);
  const web = idsOf(gladys, DEVICE_TYPES.JAIL, 'lab-web');
  assert.equal(gladys.fake.lastState(web.feature('banned')), 2);
  assert.equal(gladys.fake.lastState(web.feature('last_banned')), '198.51.100.20');
});
