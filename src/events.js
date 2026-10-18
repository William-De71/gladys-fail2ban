// -----------------------------------------------------------------------------
// Scene triggers and scene action outputs.
//
// Triggers (one event per transition, never a periodic snapshot):
//   - `ip_banned`     an IP appeared in the banned list of a jail;
//   - `ip_unbanned`   an IP left it (its ban expired or someone unbanned it);
//   - `server_down`   Fail2Ban stopped answering (SSH refused, service
//                     stopped, permission lost);
//   - `server_up`     it answers again.
//
// The first reading of a jail is a baseline: the IPs already banned fire
// nothing. A change made by a scene action or a widget button of the
// integration is "quiet" for a few minutes: it fires no event, so a scene
// cannot loop on its own action. A burst of bans (an attack wave) fires at
// most MAX_EVENTS_PER_READING events per reading; the others are counted in
// the logs and the devices.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  IP_BANNED: 'ip_banned',
  IP_UNBANNED: 'ip_unbanned',
  SERVER_DOWN: 'server_down',
  SERVER_UP: 'server_up',
};
const MAX_EVENTS_PER_READING = 20;
const QUIET_MS = 5 * 60 * 1000;
// The reasons of `server_down`, as its `reason` filter offers them.
const DOWN_REASONS = {
  unreachable: 'unreachable',
  timeout: 'unreachable',
  auth: 'auth',
  host_key: 'host_key',
  sudo: 'permission',
  permission: 'permission',
  not_found: 'permission',
  not_running: 'not_running',
};

const BAN_SUMMARY_OUTPUTS = ['banned', 'failed', 'total_banned', 'jail_count', 'summary'];
const BAN_OUTPUTS = ['banned', 'ip', 'jail', 'banned_count'];
const UNBAN_OUTPUTS = ['unbanned', 'ip', 'jail_count'];
const CHECK_OUTPUTS = ['banned', 'jails', 'jail_count'];

/**
 * @description The reason of a `server_down` event, from an error kind.
 * @param {string} kind - The kind of the error (ssh.js, fail2ban.js).
 * @returns {string} unreachable, auth, host_key, permission, not_running, other.
 */
const downReason = (kind) => DOWN_REASONS[kind] ?? 'other';

/**
 * @description The bans and unbans between two readings.
 * @param {object} options - Options.
 * @param {object[]} options.jails - The jails just read (`name`, `bannedIps`).
 * @param {object} options.previous - jail name -> banned IPs at the last
 * reading; a jail absent from it is a baseline.
 * @param {Map<string, number>} [options.quiet] - `jail|ip` -> until when a
 * change made by the integration itself stays quiet.
 * @param {number} options.now - Now (ms).
 * @returns {{ banned: object[], unbanned: object[], next: object, quieted: number }}
 * The changes `{ jail, ip }`, and the lists to remember.
 */
function detectBanChanges({ jails, previous = {}, quiet = new Map(), now }) {
  const banned = [];
  const unbanned = [];
  const next = {};
  let quieted = 0;
  const isQuiet = (jail, ip) => (quiet.get(`${jail}|${ip}`) ?? 0) > now;
  for (const jail of jails) {
    next[jail.name] = [...jail.bannedIps];
    const before = previous[jail.name];
    if (!Array.isArray(before)) {
      continue;
    }
    const was = new Set(before);
    const is = new Set(jail.bannedIps);
    for (const ip of jail.bannedIps) {
      if (!was.has(ip)) {
        if (isQuiet(jail.name, ip)) {
          quieted += 1;
        } else {
          banned.push({ jail: jail.name, ip });
        }
      }
    }
    for (const ip of before) {
      if (!is.has(ip)) {
        if (isQuiet(jail.name, ip)) {
          quieted += 1;
        } else {
          unbanned.push({ jail: jail.name, ip });
        }
      }
    }
  }
  return { banned, unbanned, next, quieted };
}

/**
 * @description The data of an `ip_banned` event.
 * @param {object} change - `{ jail, ip }`.
 * @param {object} context - `{ jail: the jail status, ban: its --with-time
 * entry or null, until: text, server }`.
 * @returns {object} The flat payload.
 */
function bannedData({ jail: name, ip }, { jail, ban, until, server }) {
  return {
    ip,
    jail: name,
    banned_count: jail?.currentlyBanned ?? 0,
    total_banned: jail?.totalBanned ?? 0,
    ban_seconds: ban && !ban.permanent && Number.isFinite(ban.bantime) ? ban.bantime : null,
    permanent: Boolean(ban?.permanent),
    until: until ?? '',
    server,
  };
}

/**
 * @description The data of an `ip_unbanned` event.
 * @param {object} change - `{ jail, ip }`.
 * @param {object} context - `{ jail, server }`.
 * @returns {object} The flat payload.
 */
function unbannedData({ jail: name, ip }, { jail, server }) {
  return { ip, jail: name, banned_count: jail?.currentlyBanned ?? 0, server };
}

/**
 * @description The totals of the jails.
 * @param {object[]} jails - The jails.
 * @returns {{ banned: number, failed: number, totalBanned: number, totalFailed: number }} The sums.
 */
function totals(jails) {
  return jails.reduce(
    (sum, jail) => ({
      banned: sum.banned + jail.currentlyBanned,
      failed: sum.failed + jail.currentlyFailed,
      totalBanned: sum.totalBanned + jail.totalBanned,
      totalFailed: sum.totalFailed + jail.totalFailed,
    }),
    { banned: 0, failed: 0, totalBanned: 0, totalFailed: 0 },
  );
}

/**
 * @description Keep only the declared keys of a scene action result.
 * @param {object} outputs - The values.
 * @param {string[]} keys - The declared outputs.
 * @returns {object} The result.
 */
const pick = (outputs, keys) => Object.fromEntries(keys.map((key) => [key, outputs[key]]));

export {
  TRIGGERS,
  MAX_EVENTS_PER_READING,
  QUIET_MS,
  DOWN_REASONS,
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
};
