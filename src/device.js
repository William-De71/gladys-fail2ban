// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// "Fail2Ban <host>": the server. Read-only features:
//   - `banned`        counter: the IPs banned now, every jail together;
//   - `failed`        counter: the failures counted now (not banned yet);
//   - `total_banned`  counter: the bans since Fail2Ban started;
//   - `jails`         counter: the jails running.
//
// "Fail2Ban jail <name>": one per jail (all of them, or the ones listed in the
// configuration). Read-only features:
//   - `banned`, `failed`, `total_banned`, `total_failed`  counters, as
//     `fail2ban-client status <jail>` prints them;
//   - `last_banned`   text: the last IP the integration saw banned.
//
// External ids: `ext:fail2ban:server:main` (one server per integration;
// `main` leaves room for more) and `ext:fail2ban:jail:<jail name folded>` —
// the jail name is a key of the Fail2Ban configuration, not a label.
// `should_poll` stays false: the integration reads on its own timer.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { totals } from './events.js';

const DEVICE_TYPES = { SERVER: 'server', JAIL: 'jail' };
const SERVER_KEY = 'main';
const FEATURE_KEYS = {
  BANNED: 'banned',
  FAILED: 'failed',
  TOTAL_BANNED: 'total_banned',
  TOTAL_FAILED: 'total_failed',
  JAILS: 'jails',
  LAST_BANNED: 'last_banned',
};
const MAX_COUNT = 1000000;
const MAX_JAILS = 1000;

/**
 * @description The device key of a jail: its name folded.
 * @param {string} name - "nginx-http-auth", "Postfix.SASL".
 * @returns {string} "nginx-http-auth", "postfix-sasl".
 */
const jailKey = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');

/**
 * @description The external ids of the server or of a jail.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} type - DEVICE_TYPES.
 * @param {string} [name] - The jail name.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys, type, name) =>
  gladys.externalIds(type, type === DEVICE_TYPES.SERVER ? SERVER_KEY : jailKey(name));

/**
 * @description What a device (or feature) external id stands for.
 * @param {unknown} externalId - The id.
 * @returns {{ type: string, key: string }|null} The type and key.
 * @example
 * parseExternalId('ext:fail2ban:jail:sshd'); // -> { type: 'jail', key: 'sshd' }
 */
function parseExternalId(externalId) {
  const match = /:(server|jail):([a-z0-9_-]+)(?::[a-z_]+)?$/.exec(String(externalId ?? ''));
  return match ? { type: match[1], key: match[2] } : null;
}

/**
 * @description A read-only feature.
 * @param {object} feature - Its fields.
 * @returns {object} The feature.
 */
const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

const counterShape = (max = MAX_COUNT) => ({
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  min: 0,
  max,
});
const textShape = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  keep_history: false,
  min: 0,
  max: 0,
};

/**
 * @description Build the server device.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} server - `{ host, port, version }`.
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildServerDevice(gladys, server, language = 'en') {
  const ids = idsOf(gladys, DEVICE_TYPES.SERVER);
  const feature = (key, name, shape) =>
    sensor({ name: t(name, language), external_id: ids.feature(key), ...shape });
  return {
    name: t('serverDeviceName', language, { host: server.host }),
    external_id: ids.device,
    model: server.version ? `Fail2Ban ${server.version}` : 'Fail2Ban',
    should_poll: false,
    params: [
      {
        name: 'FAIL2BAN_HOST',
        value: server.port === 22 ? server.host : `${server.host}:${server.port}`,
      },
    ],
    features: [
      feature(FEATURE_KEYS.BANNED, 'featureBannedAll', counterShape()),
      feature(FEATURE_KEYS.FAILED, 'featureFailedAll', counterShape()),
      feature(FEATURE_KEYS.TOTAL_BANNED, 'featureTotalBanned', counterShape()),
      feature(FEATURE_KEYS.JAILS, 'featureJails', counterShape(MAX_JAILS)),
    ],
  };
}

/**
 * @description Build the device of a jail.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} jail - The jail (`name`, `files`).
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildJailDevice(gladys, jail, language = 'en') {
  const ids = idsOf(gladys, DEVICE_TYPES.JAIL, jail.name);
  const feature = (key, name, shape) =>
    sensor({ name: t(name, language), external_id: ids.feature(key), ...shape });
  const params = [{ name: 'FAIL2BAN_JAIL', value: jail.name }];
  if (jail.files?.length) {
    params.push({ name: 'FAIL2BAN_LOGS', value: jail.files.join(' ').slice(0, 250) });
  }
  return {
    name: t('jailDeviceName', language, { jail: jail.name }),
    external_id: ids.device,
    model: 'Fail2Ban jail',
    should_poll: false,
    params,
    features: [
      feature(FEATURE_KEYS.BANNED, 'featureBanned', counterShape()),
      feature(FEATURE_KEYS.FAILED, 'featureFailed', counterShape()),
      feature(FEATURE_KEYS.TOTAL_BANNED, 'featureTotalBanned', counterShape()),
      feature(FEATURE_KEYS.TOTAL_FAILED, 'featureTotalFailed', counterShape()),
      feature(FEATURE_KEYS.LAST_BANNED, 'featureLastBanned', textShape),
    ],
  };
}

/**
 * @description The states of the server device.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object[]} jails - Every jail of the server.
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildServerStates(gladys, jails) {
  const ids = idsOf(gladys, DEVICE_TYPES.SERVER);
  const sum = totals(jails);
  return [
    { device_feature_external_id: ids.feature(FEATURE_KEYS.BANNED), state: sum.banned },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.FAILED), state: sum.failed },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.TOTAL_BANNED), state: sum.totalBanned },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.JAILS), state: jails.length },
  ];
}

/**
 * @description The states of a jail device.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} jail - The jail.
 * @param {string} [lastBanned] - The last IP seen banned, '' when none.
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildJailStates(gladys, jail, lastBanned = '') {
  const ids = idsOf(gladys, DEVICE_TYPES.JAIL, jail.name);
  const states = [
    { device_feature_external_id: ids.feature(FEATURE_KEYS.BANNED), state: jail.currentlyBanned },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.FAILED), state: jail.currentlyFailed },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.TOTAL_BANNED), state: jail.totalBanned },
    { device_feature_external_id: ids.feature(FEATURE_KEYS.TOTAL_FAILED), state: jail.totalFailed },
  ];
  if (lastBanned) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_KEYS.LAST_BANNED),
      text: lastBanned.slice(0, 250),
    });
  }
  return states.map((entry) =>
    typeof entry.state === 'number' ? { ...entry, state: Math.min(entry.state, MAX_COUNT) } : entry,
  );
}

export {
  DEVICE_TYPES,
  SERVER_KEY,
  FEATURE_KEYS,
  MAX_COUNT,
  jailKey,
  idsOf,
  parseExternalId,
  buildServerDevice,
  buildJailDevice,
  buildServerStates,
  buildJailStates,
};
