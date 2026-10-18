// -----------------------------------------------------------------------------
// Configuration of the Fail2Ban integration.
//
// Fields of the config_schema:
//   - `host`          address of the machine running Fail2Ban (its LAN
//                     address, never `localhost`: that is the container);
//   - `port`          its SSH port, 22 by default;
//   - `username`      the SSH user;
//   - `auth_method`   `key` (the key the integration generated, by default)
//                     or `password`;
//   - `password`      the SSH password (secret), for `password` only;
//   - `command`       how to call fail2ban-client: `sudo -n fail2ban-client`
//                     by default, `docker exec fail2ban fail2ban-client` for
//                     a containerized Fail2Ban, `fail2ban-client` as root;
//   - `host_key`      the SHA256 fingerprint(s) of the host key, empty to
//                     trust the first one seen;
//   - `jails`         the jails offered as devices ("sshd, recidive"), empty
//                     for all of them;
//   - `interval`      seconds between two readings;
//   - `language`      language of the texts Gladys does not ask for in a
//                     language (device names, scene texts): `auto` follows
//                     the last widget request.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';
import { DEFAULT_COMMAND, isJailName } from './fail2ban.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const AUTH_METHODS = { KEY: 'key', PASSWORD: 'password' };
const INTERVALS = [30, 60, 120, 300];
const DEFAULT_INTERVAL = 60;
const DEFAULT_PORT = 22;
const MAX_JAILS = 50;

const readString = (raw) => (typeof raw === 'string' ? raw.trim() : '');

/**
 * @description Read the reading interval.
 * @param {unknown} raw - The raw value ("60", 60).
 * @returns {number} Seconds, one of INTERVALS.
 */
function readInterval(raw) {
  const value = Number(raw);
  return INTERVALS.includes(value) ? value : DEFAULT_INTERVAL;
}

/**
 * @description Read the SSH port.
 * @param {unknown} raw - The raw value.
 * @returns {number} The port, 22 when invalid.
 */
function readPort(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : DEFAULT_PORT;
}

/**
 * @description Split a list of jails typed by hand.
 * @param {unknown} raw - "sshd, recidive ; nginx-http-auth".
 * @returns {string[]} The valid names, without duplicates.
 * @example
 * parseJails('sshd, recidive'); // -> ['sshd', 'recidive']
 */
function parseJails(raw) {
  const seen = new Set();
  return readString(raw)
    .split(/[\s,;]+/)
    .filter((name) => {
      if (!isJailName(name) || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .slice(0, MAX_JAILS);
}

/**
 * @description Normalize the host typed by the user: no scheme, no user, no
 * port (`ssh://root@nas:22` -> `nas`).
 * @param {unknown} raw - The raw value.
 * @returns {string} The host, '' when empty.
 */
function readHost(raw) {
  let value = readString(raw)
    .replace(/^ssh:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .replace(/\/.*$/, '');
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) {
    value = bracketed[1];
  } else if ((value.match(/:/g) ?? []).length === 1) {
    value = value.replace(/:\d*$/, '');
  }
  return value;
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ host, port, username, authMethod, password, command,
 * hostKey, jails, interval, language }`.
 * @example
 * normalizeConfig({ host: '192.168.1.10', username: 'gladys' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  return {
    host: readHost(config.host),
    port: readPort(config.port),
    username: readString(config.username),
    authMethod:
      config.auth_method === AUTH_METHODS.PASSWORD ? AUTH_METHODS.PASSWORD : AUTH_METHODS.KEY,
    password: typeof config.password === 'string' ? config.password : '',
    command: readString(config.command).replace(/\s+/g, ' ') || DEFAULT_COMMAND,
    hostKey: readString(config.host_key),
    jails: parseJails(config.jails),
    interval: readInterval(config.interval),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

/**
 * @description Whether the configuration can reach a server.
 * @param {object} config - The normalized config.
 * @returns {boolean} True when the host and the user are set.
 */
const isConfigured = (config) =>
  Boolean(config.host && config.username) &&
  (config.authMethod !== AUTH_METHODS.PASSWORD || Boolean(config.password));

/**
 * @description Read the stored language of the last request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 * @example
 * readLanguage({ last_language: 'fr' }, 'en'); // -> 'fr'
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  AUTH_METHODS,
  INTERVALS,
  DEFAULT_INTERVAL,
  DEFAULT_PORT,
  readInterval,
  readPort,
  readHost,
  parseJails,
  normalizeConfig,
  isConfigured,
  readLanguage,
};
