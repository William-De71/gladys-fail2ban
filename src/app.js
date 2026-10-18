// -----------------------------------------------------------------------------
// The Fail2Ban integration: every handler, registered on a Gladys client.
//
// Brings Fail2Ban into Gladys: the integration logs in over SSH to the machine
// running Fail2Ban and calls `fail2ban-client` there (fail2ban.js, ssh.js):
//   - devices (device.js): the server — IPs banned now, failures, bans since
//     start, jails — and one device per jail;
//   - scene triggers (events.js): IP banned, IP unbanned, Fail2Ban down,
//     Fail2Ban back;
//   - scene actions: ban an IP, unban an IP, check an IP, read a summary;
//   - dashboard widgets (widgets.js): overview (with Ban / Unban forms) and
//     recent bans.
//
// Fail2Ban has no push: the jails are read on the integration's own timer
// (every 30 s to 5 min, 1 min by default), never on a Gladys poll. A widget
// or a scene action reuses a reading of less than READING_MAX_AGE_MS.
// Transport: local only (an SSH connection to a machine the user names).
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake fail2ban-client (test/helpers/fake-server.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  isConfigured,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
  AUTH_METHODS,
} from './config.js';
import { createFail2BanClient, normalizeAddress, isJailName, Fail2BanError } from './fail2ban.js';
import {
  createKeyStore,
  createSshRunner,
  normalizeFingerprint,
  normalizeFingerprints,
  DEFAULT_KEY_PATH,
} from './ssh.js';
import { createStore, DEFAULT_PATH } from './store.js';
import {
  DEVICE_TYPES,
  idsOf,
  buildServerDevice,
  buildJailDevice,
  buildServerStates,
  buildJailStates,
} from './device.js';
import {
  TRIGGERS,
  MAX_EVENTS_PER_READING,
  QUIET_MS,
  BAN_SUMMARY_OUTPUTS,
  BAN_OUTPUTS,
  UNBAN_OUTPUTS,
  CHECK_OUTPUTS,
  downReason,
  detectBanChanges,
  bannedData,
  unbannedData,
  totals,
  pick,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  ALL_JAILS,
  BANS_COUNT,
  TTL_SECONDS,
  messageContent,
  readCount,
  buildOverviewWidget,
  buildRecentBansWidget,
} from './widgets.js';
import { defaultTimeZone, serverInstant, learnOffset, formatWhen } from './time.js';
import { t, all, plural, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  SHOW_PUBLIC_KEY: 'show_public_key',
  FORGET_HOST_KEY: 'forget_host_key',
  DIAGNOSTIC: 'diagnostic',
};
const SCENE_ACTIONS = {
  BAN_IP: 'ban_ip',
  UNBAN_IP: 'unban_ip',
  CHECK_IP: 'check_ip',
  GET_SUMMARY: 'get_summary',
};
// A widget or a scene action reuses a reading this fresh.
const READING_MAX_AGE_MS = 60 * 1000;
// The --with-time lists of the recent bans widget are reused this long.
const BANS_MAX_AGE_MS = 60 * 1000;
// Unreachable twice in a row before `server_down` (a reboot is not an outage).
const DOWN_AFTER_FAILURES = 2;
const FLAKY_KINDS = ['unreachable', 'timeout', 'failed'];
const MAX_FIRST_SEEN = 5000;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.run] - `(command) => Promise<{ stdout, stderr,
 * code }>`, in place of SSH (tests).
 * @param {Function} [options.createClient] - The ssh2 Client factory (tests).
 * @param {string} [options.storePath] - The file kept in /data.
 * @param {string} [options.keyPath] - The private key kept in /data.
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of the times (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    run: runFn,
    createClient,
    storePath = DEFAULT_PATH,
    keyPath = DEFAULT_KEY_PATH,
    now = () => Date.now(),
    timeZone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  let config = normalizeConfig();
  // Language of the last widget request: the fallback of the texts Gladys does
  // not ask for in a language, when the `language` setting is `auto`.
  let language = 'en';
  let createdDevices = new Set();
  // The last reading: every jail of the server, and the version of Fail2Ban.
  let reading = { jails: [], readAt: 0, error: null };
  let version = '';
  let failures = 0;
  let pending = null;
  // jail -> { at, bans } of `get <jail> banip --with-time`.
  const banLists = new Map();
  // `jail|ip` -> until when a change made by the integration stays quiet.
  const quiet = new Map();
  let lastStatus = null;
  let lastDiscovery = null;
  let timer = null;
  let stopped = false;

  const store = createStore({ path: storePath, logger });
  const keys = createKeyStore({ path: keyPath, logger });
  const identity = () => `${config.host}:${config.port}`;
  const runner = runFn
    ? { run: runFn, close() {}, lastHostKey: '' }
    : createSshRunner({
        getTarget: () => ({
          host: config.host,
          port: config.port,
          username: config.username,
          authMethod: config.authMethod,
          password: config.password,
          hostKey: config.hostKey,
        }),
        keys,
        getKnownHostKey: () => store.data.hostKeys[identity()] ?? '',
        onNewHostKey: async (fingerprint) => {
          logger.info(`First connection to ${identity()}: host key ${fingerprint} kept`);
          store.data.hostKeys[identity()] = fingerprint;
          await store.save();
        },
        ...(createClient ? { createClient } : {}),
        logger,
      });
  const f2b = createFail2BanClient({
    run: (command) => runner.run(command),
    getCommand: () => config.command,
  });

  /**
   * @description Remember the language of a request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (typeof next !== 'string' || !/^[a-z]{2}$/.test(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  /**
   * @description The message of an error, for a user.
   * @param {Error} err - The error.
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    const values = {
      host: config.host,
      user: config.username,
      fingerprint: runner.lastHostKey || '?',
      jail: err?.jail ?? '',
      ip: err?.ip ?? '',
      detail: String(err?.message ?? '').slice(0, 120),
    };
    const key =
      {
        config: 'errConfig',
        unreachable: 'errUnreachable',
        timeout: 'errTimeout',
        auth: 'errAuth',
        host_key: 'errHostKey',
        sudo: 'errSudo',
        permission: 'errPermission',
        not_found: 'errNotFound',
        not_running: 'errNotRunning',
        unknown_jail: 'errUnknownJail',
        invalid_ip: 'errInvalidIp',
      }[err?.kind] ?? 'errFailed';
    return t(key, lang, values);
  }

  /**
   * @description The message of an error, in the four languages.
   * @param {Error} err - The error.
   * @returns {object} `{ en, fr, de, es }`.
   */
  const errorAll = (err) =>
    Object.fromEntries(LANGUAGES.map((lang) => [lang, errorText(err, lang).slice(0, 200)]));

  /**
   * @description An error of a user input.
   * @param {string} kind - `invalid_ip`, `unknown_jail`.
   * @param {object} details - `{ ip }` or `{ jail }`.
   * @returns {Fail2BanError} The error.
   */
  function inputError(kind, details) {
    const err = new Fail2BanError(
      kind,
      kind === 'invalid_ip'
        ? `"${details.ip}" is not an IP address`
        : `The jail ${details.jail} does not exist`,
    );
    Object.assign(err, details);
    return err;
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status from the last reading.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!isConfigured(config)) {
      await reportStatus(false, all('errConfig'));
      return;
    }
    if (reading.error) {
      await reportStatus(false, errorAll(reading.error));
      return;
    }
    if (!reading.readAt) {
      return;
    }
    const jails = followedJails();
    await reportStatus(
      true,
      Object.fromEntries(
        LANGUAGES.map((lang) => [
          lang,
          t('statusConnected', lang, {
            version: version || '?',
            host: config.host,
            jails: plural('countJails', jails.length, lang),
            banned: plural('bannedCount', totals(jails).banned, lang),
          }).slice(0, 200),
        ]),
      ),
    );
  }

  /**
   * @description The jails offered as devices: all, or the configured ones.
   * @returns {object[]} The jails of the last reading.
   */
  function followedJails() {
    if (config.jails.length === 0) {
      return reading.jails;
    }
    return reading.jails.filter((jail) => config.jails.includes(jail.name));
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   * @param {string[]} [widgetKeys] - The widget keys.
   */
  function refreshWidgets(widgetKeys = Object.values(WIDGETS)) {
    for (const key of widgetKeys) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`Fail2Ban ${key}${data.ip ? `: ${data.ip} (${data.jail})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the server and its jails on the Discovery screen, when
   * they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    if (!reading.readAt) {
      return 0;
    }
    const lang = textLanguage();
    const devices = [
      buildServerDevice(gladys, { host: config.host, port: config.port, version }, lang),
      ...followedJails().map((jail) => buildJailDevice(gladys, jail, lang)),
    ];
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of the created devices.
   * @returns {Promise<void>}
   */
  async function publishStates() {
    if (!reading.readAt) {
      return;
    }
    const jails = followedJails();
    const states = [];
    if (createdDevices.has(idsOf(gladys, DEVICE_TYPES.SERVER).device)) {
      states.push(...buildServerStates(gladys, jails));
    }
    for (const jail of jails) {
      if (createdDevices.has(idsOf(gladys, DEVICE_TYPES.JAIL, jail.name).device)) {
        states.push(
          ...buildJailStates(gladys, jail, store.data.seen.lastBanned?.[jail.name] ?? ''),
        );
      }
    }
    // The host API takes 100 states per call.
    for (let start = 0; start < states.length; start += 100) {
      await gladys
        .publishChangedStates(states.slice(start, start + 100))
        .catch((err) => logger.warn(`Unable to publish the states: ${err.message}`));
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description The bans of a jail with their times, cached for a minute.
   * @param {string} jail - The jail.
   * @param {boolean} [fresh] - Read again whatever the cache.
   * @returns {Promise<object[]|null>} The bans, null when the server cannot say.
   */
  async function bansOf(jail, fresh = false) {
    const cached = banLists.get(jail);
    if (!fresh && cached && now() - cached.at <= BANS_MAX_AGE_MS) {
      return cached.bans;
    }
    try {
      const bans = await f2b.bansWithTime(jail);
      banLists.set(jail, { at: now(), bans });
      return bans;
    } catch (err) {
      // fail2ban-client older than 0.10.5 has no --with-time.
      if (['invalid', 'failed'].includes(err.kind)) {
        banLists.set(jail, { at: now(), bans: null });
        return null;
      }
      throw err;
    }
  }

  /**
   * @description The instant of a time printed by the server.
   * @param {number|null} naive - The time, read as UTC.
   * @returns {number|null} The instant.
   */
  const instantOf = (naive) => serverInstant(naive, { offset: store.data.clock.offset, timeZone });

  /**
   * @description The text of the end of a ban, for a scene.
   * @param {object|null} ban - The --with-time entry.
   * @returns {string} "21:19", "permanent", ''.
   */
  function untilText(ban) {
    if (!ban) {
      return '';
    }
    if (ban.permanent) {
      return t('untilPermanent', textLanguage());
    }
    const start = instantOf(ban.start);
    return Number.isFinite(start) && Number.isFinite(ban.bantime)
      ? formatWhen(start + ban.bantime * 1000, { language: textLanguage(), timeZone, now: now() })
      : '';
  }

  /**
   * @description Turn the bans just seen into events, and learn the clock of
   * the server from them.
   * @param {object[]} changes - `{ jail, ip }`.
   * @param {Map<string, object>} byName - The jails just read.
   * @param {number} readAt - When.
   * @param {number} previousReadAt - When the previous reading was made.
   * @returns {Promise<object[]>} The events.
   */
  async function bannedEvents(changes, byName, readAt, previousReadAt) {
    const events = [];
    const withTimes = new Map();
    for (const jail of new Set(changes.map((change) => change.jail))) {
      try {
        withTimes.set(jail, await bansOf(jail, true));
      } catch (err) {
        logger.warn(`Unable to read the ban times of ${jail}: ${err.message}`);
      }
    }
    for (const change of changes) {
      const ban = withTimes.get(change.jail)?.find((entry) => entry.ip === change.ip) ?? null;
      // A ban that started since the previous reading gives the server clock.
      if (ban && Number.isFinite(ban.start) && previousReadAt) {
        const offset = learnOffset(ban.start, readAt);
        const start = ban.start - offset;
        if (
          start <= readAt + 60000 &&
          start >= previousReadAt - 60000 &&
          store.data.clock.offset !== offset
        ) {
          store.data.clock.offset = offset;
          logger.info(
            `The clock of the Fail2Ban server is UTC${offset >= 0 ? '+' : ''}${offset / 3600000}`,
          );
        }
      }
      events.push({
        key: TRIGGERS.IP_BANNED,
        data: bannedData(change, {
          jail: byName.get(change.jail),
          ban,
          until: untilText(ban),
          server: config.host,
        }),
      });
    }
    return events;
  }

  /**
   * @description What a reading changed: events, states, devices, widgets.
   * @param {object[]} jails - Every jail just read.
   * @param {number} readAt - When.
   * @returns {Promise<void>}
   */
  async function digest(jails, readAt) {
    const seen = store.data.seen;
    const previousReadAt = reading.readAt;
    if (seen.server !== identity()) {
      // Another server: its bans are a new baseline.
      seen.server = identity();
      seen.jails = {};
      seen.firstSeen = {};
      seen.lastBanned = {};
      store.data.clock.offset = null;
    }
    seen.firstSeen ??= {};
    seen.lastBanned ??= {};
    const before = JSON.stringify(reading.jails);
    reading = { jails, readAt, error: null };
    failures = 0;
    const followed = followedJails();
    const byName = new Map(followed.map((jail) => [jail.name, jail]));
    for (const [key, until] of quiet) {
      if (until <= readAt) {
        quiet.delete(key);
      }
    }
    const { banned, unbanned, next } = detectBanChanges({
      jails: followed,
      previous: seen.jails,
      quiet,
      now: readAt,
    });
    const events = [];
    const connected = gladys.connected !== false;
    if (seen.down === true && connected) {
      events.push({ key: TRIGGERS.SERVER_UP, data: { server: config.host, version } });
    }
    for (const { jail, ip } of banned) {
      seen.firstSeen[`${jail}|${ip}`] = readAt;
      seen.lastBanned[jail] = ip;
    }
    for (const { jail, ip } of unbanned) {
      delete seen.firstSeen[`${jail}|${ip}`];
    }
    if (connected) {
      events.push(
        ...(await bannedEvents(
          banned.slice(0, MAX_EVENTS_PER_READING),
          byName,
          readAt,
          previousReadAt,
        )),
      );
      events.push(
        ...unbanned.slice(0, MAX_EVENTS_PER_READING).map((change) => ({
          key: TRIGGERS.IP_UNBANNED,
          data: unbannedData(change, { jail: byName.get(change.jail), server: config.host }),
        })),
      );
      if (banned.length + unbanned.length > 2 * MAX_EVENTS_PER_READING) {
        logger.info(
          `${banned.length} bans and ${unbanned.length} unbans in one reading: events capped`,
        );
      }
    }
    const keysSeen = Object.keys(seen.firstSeen);
    if (keysSeen.length > MAX_FIRST_SEEN) {
      keysSeen
        .sort((a, b) => seen.firstSeen[a] - seen.firstSeen[b])
        .slice(0, keysSeen.length - MAX_FIRST_SEEN)
        .forEach((key) => delete seen.firstSeen[key]);
    }
    // Disconnected, the changes would be lost: keep the old lists to compare.
    if (connected) {
      seen.jails = next;
      seen.down = false;
    }
    await store.save();
    await publishEvents(events);
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishStates();
    if (before !== JSON.stringify(jails)) {
      banLists.clear();
      refreshWidgets();
    }
  }

  /**
   * @description What a failed reading means: the status, `server_down`.
   * @param {Error} err - The error.
   * @returns {Promise<void>}
   */
  async function digestFailure(err) {
    failures += 1;
    reading = { ...reading, error: err };
    logger.warn(`Fail2Ban reading failed (${err.kind ?? 'error'}): ${err.message}`);
    const settled = !FLAKY_KINDS.includes(err.kind) || failures >= DOWN_AFTER_FAILURES;
    if (
      settled &&
      store.data.seen.down !== true &&
      gladys.connected !== false &&
      err.kind !== 'config'
    ) {
      store.data.seen.down = true;
      await store.save();
      await publishEvents([
        {
          key: TRIGGERS.SERVER_DOWN,
          data: {
            server: config.host,
            reason: downReason(err.kind),
            message: errorText(err, textLanguage()).slice(0, 1000),
          },
        },
      ]);
      refreshWidgets();
    }
  }

  /**
   * @description Read every jail now (one reading at a time).
   * @returns {Promise<object>} The reading `{ jails, readAt }`.
   */
  function readNow() {
    if (!pending) {
      pending = (async () => {
        try {
          if (!isConfigured(config)) {
            throw Object.assign(new Error('Not configured'), { kind: 'config' });
          }
          const jails = await f2b.readJails();
          if (!version) {
            version = await f2b.version().catch(() => '');
          }
          await digest(jails, now());
          return reading;
        } catch (err) {
          await digestFailure(err);
          throw err;
        } finally {
          await refreshStatus();
          pending = null;
        }
      })();
    }
    return pending;
  }

  /**
   * @description The last reading, read again when older than READING_MAX_AGE_MS.
   * @returns {Promise<object>} The reading.
   */
  async function freshReading() {
    if (reading.readAt && !reading.error && now() - reading.readAt <= READING_MAX_AGE_MS) {
      return reading;
    }
    return readNow();
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    if (!timers || stopped || !isConfigured(config)) {
      return;
    }
    timer = setInterval(() => {
      readNow().catch(() => {});
    }, config.interval * 1000);
    timer.unref?.();
  }

  /**
   * @description Read the server with the current configuration.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    runner.close();
    f2b.forgetCapabilities();
    version = '';
    banLists.clear();
    lastDiscovery = null;
    await readNow().catch(() => {});
    schedule();
  }

  // --- Ban and unban -----------------------------------------------------------------

  /**
   * @description Check an address typed by a user.
   * @param {unknown} raw - The address.
   * @returns {string} The normalized address.
   * @throws {Fail2BanError} When it is not one.
   */
  function addressOf(raw) {
    const ip = normalizeAddress(raw);
    if (!ip) {
      throw inputError('invalid_ip', { ip: String(raw ?? '').slice(0, 60) });
    }
    return ip;
  }

  /**
   * @description Check a jail typed by a user against the last reading.
   * @param {unknown} raw - The jail.
   * @returns {Promise<string>} The jail.
   * @throws {Fail2BanError} When the server has no such jail.
   */
  async function jailOf(raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    const { jails } = await freshReading();
    if (!isJailName(name) || !jails.some((jail) => jail.name === name)) {
      throw inputError('unknown_jail', { jail: name.slice(0, 60) });
    }
    return name;
  }

  /**
   * @description Ban an address in a jail; the change fires no scene event.
   * @param {unknown} rawIp - The address.
   * @param {unknown} rawJail - The jail.
   * @returns {Promise<{ ip: string, jail: string, added: boolean }>} What happened.
   */
  async function ban(rawIp, rawJail) {
    const ip = addressOf(rawIp);
    const jail = await jailOf(rawJail);
    const already = reading.jails.find((entry) => entry.name === jail)?.bannedIps.includes(ip);
    quiet.set(`${jail}|${ip}`, now() + QUIET_MS);
    const count = await f2b.ban(jail, ip);
    logger.info(`Banned ${ip} in ${jail} on request`);
    await readNow().catch(() => {});
    return { ip, jail, added: !already && count > 0 };
  }

  /**
   * @description Unban an address from a jail, or from every jail; the change
   * fires no scene event.
   * @param {unknown} rawIp - The address.
   * @param {unknown} [rawJail] - The jail, empty or ALL_JAILS for all.
   * @returns {Promise<{ ip: string, count: number }>} How many jails it left.
   */
  async function unban(rawIp, rawJail) {
    const ip = addressOf(rawIp);
    const wanted = typeof rawJail === 'string' ? rawJail.trim() : '';
    const jail = wanted && wanted !== ALL_JAILS ? await jailOf(wanted) : '';
    const current = await freshReading();
    const holding = current.jails.filter(
      (entry) => entry.bannedIps.includes(ip) && (!jail || entry.name === jail),
    );
    for (const entry of holding) {
      quiet.set(`${entry.name}|${ip}`, now() + QUIET_MS);
    }
    const count = await f2b.unban(ip, jail);
    logger.info(`Unbanned ${ip} from ${jail || 'every jail'} on request (${count})`);
    await readNow().catch(() => {});
    return { ip, count };
  }

  // --- Dashboard widgets -------------------------------------------------------------

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ language: lang }) => {
    rememberLanguage(lang);
    if (!isConfigured(config)) {
      return messageContent(t('errConfig', lang));
    }
    try {
      const current = await freshReading();
      return buildOverviewWidget({
        server: { host: config.host, version },
        jails: followedJails(),
        readAt: current.readAt,
        language: lang,
        timeZone,
        now: now(),
      });
    } catch (err) {
      return messageContent(errorText(err, lang), { ttl: TTL_SECONDS.error, refresh: true });
    }
  });

  gladys.onWidgetGet(WIDGETS.RECENT_BANS, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    if (!isConfigured(config)) {
      return messageContent(t('errConfig', lang));
    }
    const wanted = typeof settings.jail === 'string' ? settings.jail.trim() : '';
    try {
      const current = await freshReading();
      const jails = wanted ? current.jails.filter((jail) => jail.name === wanted) : followedJails();
      if (wanted && jails.length === 0) {
        return messageContent(t('errUnknownJail', lang, { jail: wanted.slice(0, 60) }), {
          ttl: TTL_SECONDS.error,
        });
      }
      const bans = [];
      for (const jail of jails.filter((entry) => entry.currentlyBanned > 0)) {
        const timed = await bansOf(jail.name);
        for (const ip of jail.bannedIps) {
          const entry = timed?.find((item) => item.ip === ip);
          const start = entry
            ? instantOf(entry.start)
            : (store.data.seen.firstSeen?.[`${jail.name}|${ip}`] ?? null);
          bans.push({
            ip,
            jail: jail.name,
            start,
            bantime: entry?.bantime ?? null,
            permanent: Boolean(entry?.permanent),
            until:
              entry && !entry.permanent && Number.isFinite(start) && Number.isFinite(entry.bantime)
                ? start + entry.bantime * 1000
                : null,
          });
        }
      }
      bans.sort((a, b) => (b.start ?? -Infinity) - (a.start ?? -Infinity));
      return buildRecentBansWidget({
        bans,
        total: bans.length,
        jail: wanted,
        count: readCount(settings.count, BANS_COUNT),
        readAt: current.readAt,
        language: lang,
        timeZone,
        now: now(),
      });
    } catch (err) {
      return messageContent(errorText(err, lang), { ttl: TTL_SECONDS.error, refresh: true });
    }
  });

  /**
   * @description Run a widget button, its result as a toast.
   * @param {Function} task - `() => Promise<object>`, the toast.
   * @returns {Promise<object>} The toast.
   */
  async function toast(task) {
    try {
      return await task();
    } catch (err) {
      logger.warn(`Widget action failed (${err.kind ?? 'error'}): ${err.message}`);
      return errorAll(err);
    }
  }

  const banToast = ({ ip, jail, added }) => all(added ? 'banDone' : 'banAlready', { ip, jail });
  const unbanToast = ({ ip, count }) =>
    count > 0
      ? all('unbanDone', (lang) => ({ ip, jails: plural('countJails', count, lang) }))
      : all('unbanNone', { ip });
  const refreshToast = async () => {
    await readNow();
    const { banned } = totals(followedJails());
    return all('refreshDone', (lang) => ({ banned: plural('bannedCount', banned, lang) }));
  };

  gladys.onWidgetAction(WIDGETS.OVERVIEW, async (actionKey, params, { values = {} } = {}) =>
    toast(async () => {
      if (actionKey === WIDGET_ACTIONS.BAN) {
        return banToast(await ban(values.ip, values.jail));
      }
      if (actionKey === WIDGET_ACTIONS.UNBAN) {
        return unbanToast(await unban(values.ip, values.jail));
      }
      return refreshToast();
    }),
  );

  gladys.onWidgetAction(WIDGETS.RECENT_BANS, async (actionKey, params, { values = {} } = {}) =>
    toast(async () => {
      if (actionKey === WIDGET_ACTIONS.UNBAN_LISTED) {
        const [jail, ip] = String(values.ban ?? '').split('|');
        return unbanToast(await unban(ip, jail));
      }
      return refreshToast();
    }),
  );

  // --- Scene actions -----------------------------------------------------------------
  // They never fire a scene event: what they change is quiet (QUIET_MS).

  /**
   * @description A scene action needs a configured server.
   * @throws {Error} When it is not.
   */
  function requireConfig() {
    if (!isConfigured(config)) {
      throw new Error('The Fail2Ban server is not configured');
    }
  }

  gladys.onSceneAction(SCENE_ACTIONS.BAN_IP, async (fields = {}) => {
    requireConfig();
    const result = await ban(fields.ip, fields.jail);
    const jail = reading.jails.find((entry) => entry.name === result.jail);
    return pick(
      {
        banned: result.added,
        ip: result.ip,
        jail: result.jail,
        banned_count: jail?.currentlyBanned ?? 0,
      },
      BAN_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.UNBAN_IP, async (fields = {}) => {
    requireConfig();
    const result = await unban(fields.ip, fields.jail);
    return pick(
      { unbanned: result.count > 0, ip: result.ip, jail_count: result.count },
      UNBAN_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.CHECK_IP, async (fields = {}) => {
    requireConfig();
    const ip = addressOf(fields.ip);
    const jails = await f2b.jailsOf(ip);
    return pick(
      { banned: jails.length > 0, jails: jails.join(', '), jail_count: jails.length },
      CHECK_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_SUMMARY, async () => {
    requireConfig();
    await freshReading();
    const jails = followedJails();
    const sum = totals(jails);
    return pick(
      {
        banned: sum.banned,
        failed: sum.failed,
        total_banned: sum.totalBanned,
        jail_count: jails.length,
        summary: t('summary', textLanguage(), {
          host: config.host,
          banned: plural('bannedCount', sum.banned, textLanguage()),
          jails: plural('countJails', jails.length, textLanguage()),
          failed: plural('countFailed', sum.failed, textLanguage()),
          total: plural('countBans', sum.totalBanned, textLanguage()),
        }),
      },
      BAN_SUMMARY_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!isConfigured(config)) {
      return all('errConfig');
    }
    runner.close();
    f2b.forgetCapabilities();
    version = '';
    try {
      await readNow();
    } catch (err) {
      return Object.fromEntries(
        LANGUAGES.map((lang) => [
          lang,
          t('testFailed', lang, { error: errorText(err, lang) }).slice(0, 1000),
        ]),
      );
    }
    refreshWidgets();
    const jails = followedJails();
    const fingerprint =
      runner.lastHostKey || normalizeFingerprint(store.data.hostKeys[identity()]) || '–';
    return Object.fromEntries(
      LANGUAGES.map((lang) => [
        lang,
        t('testOk', lang, {
          host: config.host,
          fingerprint,
          version: version || '?',
          jails: plural('countJails', jails.length, lang),
          names:
            jails
              .map((jail) => jail.name)
              .join(', ')
              .slice(0, 400) || '–',
          banned: plural('bannedCount', totals(jails).banned, lang),
        }).slice(0, 1000),
      ]),
    );
  });

  gladys.onAction(ACTIONS.SHOW_PUBLIC_KEY, async () => {
    const key = await keys.publicKey();
    logger.info(`Public key of the integration: ${key}`);
    const line = `restrict ${key}`;
    if (config.authMethod === AUTH_METHODS.PASSWORD) {
      return all('publicKeyPassword', { key: line });
    }
    return all('publicKey', { key: line, user: config.username || '?' });
  });

  gladys.onAction(ACTIONS.FORGET_HOST_KEY, async () => {
    const pinned = normalizeFingerprints(config.hostKey);
    if (pinned.length > 0) {
      return all('hostKeyPinned', { fingerprint: pinned.join(', ') });
    }
    if (!store.data.hostKeys[identity()]) {
      return all('hostKeyNone');
    }
    delete store.data.hostKeys[identity()];
    await store.save();
    runner.close();
    logger.info(`Host key of ${identity()} forgotten`);
    return all('hostKeyForgotten', { host: config.host });
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const report = {
      version: VERSION,
      timeZone: timeZone ?? null,
      server: {
        host: config.host,
        port: config.port,
        username: config.username ? 'set' : 'missing',
        authMethod: config.authMethod,
        password: config.password ? 'set' : 'missing',
        command: config.command,
        pinnedHostKeys: normalizeFingerprints(config.hostKey),
        storedHostKey: store.data.hostKeys[identity()] ?? null,
        lastHostKey: runner.lastHostKey || null,
      },
      fail2ban: version || null,
      interval: config.interval,
      language: config.language,
      jailFilter: config.jails,
      readAt: reading.readAt ? new Date(reading.readAt).toISOString() : null,
      error: reading.error
        ? { kind: reading.error.kind ?? null, message: reading.error.message }
        : null,
      failures,
      jails: reading.jails.map((jail) => ({
        name: jail.name,
        followed: followedJails().includes(jail),
        created: createdDevices.has(idsOf(gladys, DEVICE_TYPES.JAIL, jail.name).device),
        banned: jail.currentlyBanned,
        failed: jail.currentlyFailed,
        totalBanned: jail.totalBanned,
        totalFailed: jail.totalFailed,
        files: jail.files,
      })),
      serverCreated: createdDevices.has(idsOf(gladys, DEVICE_TYPES.SERVER).device),
      clockOffset: store.data.clock.offset,
      down: store.data.seen.down,
      quiet: quiet.size,
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `Fail2Ban diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await readNow().catch(() => {});
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await loadConfig();
      await store.load();
      await refreshCreatedDevices();
      lastStatus = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    runner.close();
    await store.save();
  });

  return {
    store,
    keys,
    readNow,
    applyConfig,
    ban,
    unban,
    getConfig: () => config,
    getReading: () => reading,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, SCENE_ACTIONS, READING_MAX_AGE_MS, DOWN_AFTER_FAILURES };
