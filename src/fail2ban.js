// -----------------------------------------------------------------------------
// Fail2Ban: the commands of `fail2ban-client` and the parsing of their answers.
//
// Fail2Ban has no network API: its server listens on a Unix socket of the
// machine it protects, which a container cannot reach. The integration runs
// `fail2ban-client` on that machine over SSH (ssh.js), with the prefix the
// user configured — `sudo -n fail2ban-client` by default, `docker exec
// fail2ban fail2ban-client` for a containerized Fail2Ban.
//
// Commands used (fail2ban-client 0.10 to 1.1):
//   version                         "1.1.0"
//   status --all                    every jail in one answer (1.1+), else
//   status + status <jail>          one answer per jail (older versions)
//   get <jail> banip --with-time    "<ip> \t<start> + <bantime> = <end>"
//   set <jail> banip <ip>           "1" (count of IPs banned)
//   set <jail> unbanip <ip>         "1" / "0"
//   unban <ip>                      count of jails the IP left
//   banned <ip>                     "[['sshd', 'recidive']]"
//
// Every argument is validated (jail names, IP addresses) and single-quoted:
// nothing typed in a scene or a widget reaches the remote shell unquoted.
// `banip` accepts any text without an error (a host name, a typo), so the
// addresses are checked here, not by Fail2Ban.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';

const DEFAULT_COMMAND = 'sudo -n fail2ban-client';
const JAIL_PATTERN = /^[A-Za-z0-9_.@-]{1,64}$/;
// The keys of the status trees, as fail2ban-client prints them.
const KEYS = {
  'Number of jail': 'jailCount',
  'Jail list': 'jailList',
  'Currently failed': 'currentlyFailed',
  'Total failed': 'totalFailed',
  'File list': 'files',
  'Journal matches': 'journal',
  'Currently banned': 'currentlyBanned',
  'Total banned': 'totalBanned',
  'Banned IP list': 'bannedIps',
};
const COUNTERS = ['currentlyFailed', 'totalFailed', 'currentlyBanned', 'totalBanned'];
// "9999-12-31 23:59:59": the end of a permanent ban (bantime -1).
const PERMANENT_YEAR = 9999;

/**
 * @description An error of Fail2Ban or of its command, with a kind the
 * messages can tell apart.
 */
class Fail2BanError extends Error {
  /**
   * @param {string} kind - `sudo`, `permission`, `not_running`, `not_found`,
   * `unknown_jail`, `invalid`, `failed`.
   * @param {string} message - The message.
   */
  constructor(kind, message) {
    super(message);
    this.name = 'Fail2BanError';
    this.kind = kind;
  }
}

/**
 * @description Quote one argument for a POSIX shell.
 * @param {string} value - The argument.
 * @returns {string} The quoted argument.
 * @example
 * quote("it's"); // -> "'it'\\''s'"
 */
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * @description Whether a jail name is acceptable.
 * @param {unknown} name - The name.
 * @returns {boolean} True when it is.
 */
const isJailName = (name) => typeof name === 'string' && JAIL_PATTERN.test(name);

/**
 * @description Normalize an IP address or a network typed by a user.
 * @param {unknown} raw - "203.0.113.7", " 2001:DB8::5 ", "192.0.2.0/24".
 * @returns {string|null} The address, null when it is not one.
 * @example
 * normalizeAddress('2001:DB8::5'); // -> '2001:db8::5'
 */
function normalizeAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim().toLowerCase();
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || !address) {
    return null;
  }
  const family = isIP(address);
  if (!family) {
    return null;
  }
  if (prefix === undefined) {
    return address;
  }
  const bits = Number(prefix);
  if (!/^\d{1,3}$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
    return null;
  }
  return `${address}/${bits}`;
}

/**
 * @description Read the "key: value" lines of a status tree.
 * @param {string} line - One line, with its tree drawing.
 * @returns {{ key: string, value: string }|null} The pair, null for a title.
 * @example
 * treeEntry('|  |- Currently failed:\t2'); // -> { key: 'Currently failed', value: '2' }
 */
function treeEntry(line) {
  const text = line.replace(/^[\s|`-]+/, '');
  const colon = text.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  return { key: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() };
}

/**
 * @description A jail of a status tree, its values typed.
 * @param {string} name - The jail.
 * @param {object} raw - The raw values, by KEYS name.
 * @returns {object} `{ name, currentlyFailed, totalFailed, currentlyBanned,
 * totalBanned, bannedIps, files }`.
 */
function typedJail(name, raw) {
  const jail = { name };
  for (const key of COUNTERS) {
    const value = Number.parseInt(raw[key], 10);
    jail[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  jail.bannedIps = String(raw.bannedIps ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
  jail.files = String(raw.files ?? raw.journal ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);
  return jail;
}

/**
 * @description Parse the answer of `status`, `status <jail>` or `status --all`.
 * @param {string} text - The answer.
 * @returns {{ jailNames: string[], jails: object[] }} The jail names of the
 * server, and the jails whose status the answer holds.
 */
function parseStatus(text) {
  const server = {};
  const jails = [];
  let current = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const header = /Status for the jail:\s*(\S+)/.exec(line);
    if (header) {
      current = { name: header[1], raw: {} };
      jails.push(current);
      continue;
    }
    const entry = treeEntry(line);
    if (!entry) {
      continue;
    }
    if (entry.key === 'Jail') {
      current = { name: entry.value, raw: {} };
      jails.push(current);
      continue;
    }
    const key = KEYS[entry.key];
    if (key) {
      (current ? current.raw : server)[key] = entry.value;
    }
  }
  const jailNames = String(server.jailList ?? '')
    .split(/\s*,\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    jailNames: jailNames.length ? jailNames : jails.map((jail) => jail.name),
    jails: jails.map(({ name, raw }) => typedJail(name, raw)),
  };
}

/**
 * @description Read "2026-10-17 21:09:25" as if it were UTC (the server's
 * wall clock, whose timezone is not given).
 * @param {string} text - The date.
 * @returns {number|null} The "naive" instant in ms.
 */
function naiveInstant(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * @description Parse the answer of `get <jail> banip --with-time`.
 * @param {string} text - "203.0.113.7 \t2026-10-17 21:09:25 + 600 = 2026-10-17 21:19:25".
 * @returns {Array<{ ip: string, start: number|null, bantime: number|null,
 * permanent: boolean }>} The bans; `start` is naive (naiveInstant).
 */
function parseBansWithTime(text) {
  const bans = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match =
      /^\s*(\S+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\+\s*(-?\d+)\s*=\s*(\d{4})-/.exec(line);
    if (!match) {
      continue;
    }
    const bantime = Number(match[3]);
    bans.push({
      ip: match[1],
      start: naiveInstant(match[2]),
      bantime: Number.isFinite(bantime) ? bantime : null,
      permanent: bantime < 0 || Number(match[4]) === PERMANENT_YEAR,
    });
  }
  return bans;
}

/**
 * @description Parse the answer of `banned <ip>`: "[['sshd', 'recidive']]".
 * @param {string} text - The answer.
 * @returns {string[]} The jails where the IP is banned.
 */
function parseBannedJails(text) {
  return [...String(text ?? '').matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((name) => isJailName(name));
}

/**
 * @description Read a count answer ("1", "0").
 * @param {string} text - The answer.
 * @returns {number} The count, 0 when none.
 */
function parseCount(text) {
  const value = Number.parseInt(String(text ?? '').trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * @description The version of Fail2Ban: "1.1.0" (older ones print "Fail2Ban v0.10.2").
 * @param {string} text - The answer of `version`.
 * @returns {string} The version, '' when unknown.
 */
function parseVersion(text) {
  const match = /(\d+\.\d+(?:\.\d+)?(?:[.-]?\w+)?)/.exec(String(text ?? ''));
  return match ? match[1] : '';
}

/**
 * @description What went wrong with a command, from its output.
 * @param {{ stdout: string, stderr: string, code: number|null }} result - The result.
 * @returns {Fail2BanError|null} The error, null when it succeeded.
 */
function commandError({ stdout = '', stderr = '', code = 0 }) {
  const text = `${stderr}\n${stdout}`;
  const first = (pattern) =>
    (text.split(/\r?\n/).find((line) => pattern.test(line)) ?? '').trim().slice(0, 200);
  if (
    /a password is required|a terminal is required|is not in the sudoers|not allowed to execute|sorry, user/i.test(
      text,
    )
  ) {
    return new Fail2BanError('sudo', first(/sudo|sorry/i) || 'sudo refused the command');
  }
  if (/Permission denied to socket|you must be root/i.test(text)) {
    return new Fail2BanError('permission', first(/Permission denied/i));
  }
  if (
    /Failed to access socket path|Is fail2ban running|Unable to contact server|Connection refused/i.test(
      text,
    )
  ) {
    return new Fail2BanError('not_running', first(/socket|running|contact|refused/i));
  }
  if (code === 127 || /command not found|not found|No such file or directory/i.test(stderr)) {
    return new Fail2BanError('not_found', first(/not found|No such file/i) || 'Command not found');
  }
  if (/jail '?[^']*'? does not exist/i.test(text)) {
    return new Fail2BanError('unknown_jail', first(/does not exist/i));
  }
  if (/Invalid command|Wrong number of arguments|Usage:/i.test(text)) {
    return new Fail2BanError('invalid', first(/Invalid|Wrong|Usage/i));
  }
  if (code !== 0 && code !== null) {
    return new Fail2BanError(
      'failed',
      first(/ERROR|NOK|\S/) || `fail2ban-client exited with the code ${code}`,
    );
  }
  return null;
}

/**
 * @description A client of `fail2ban-client`, over a command runner.
 * @param {object} options - Options.
 * @param {Function} options.run - `(command) => Promise<{ stdout, stderr, code }>`.
 * @param {Function} options.getCommand - `() => string`, the configured prefix.
 * @returns {object} The client.
 */
function createFail2BanClient({ run, getCommand }) {
  // Whether `status --all` works on this server (1.1+); null until known.
  let statusAll = null;

  /**
   * @description Run fail2ban-client with arguments.
   * @param {string[]} args - The arguments (quoted here).
   * @returns {Promise<string>} The standard output.
   */
  async function call(args) {
    const prefix = (getCommand() || DEFAULT_COMMAND).trim();
    const result = await run(`${prefix} ${args.map(quote).join(' ')}`);
    const error = commandError(result);
    if (error) {
      throw error;
    }
    return String(result.stdout ?? '');
  }

  /**
   * @description The status of every jail.
   * @returns {Promise<object[]>} The jails (typedJail), in the server order.
   */
  async function readJails() {
    if (statusAll !== false) {
      try {
        const answer = parseStatus(await call(['status', '--all']));
        if (answer.jails.length > 0 || answer.jailNames.length === 0) {
          statusAll = true;
          return answer.jails;
        }
        statusAll = false;
      } catch (err) {
        // Older versions do not know `--all`; anything else is a real error.
        if (statusAll === true || !['invalid', 'unknown_jail', 'failed'].includes(err.kind)) {
          throw err;
        }
        statusAll = false;
      }
    }
    const { jailNames } = parseStatus(await call(['status']));
    const jails = [];
    for (const name of jailNames.filter(isJailName)) {
      const [jail] = parseStatus(await call(['status', name])).jails;
      if (jail) {
        jails.push({ ...jail, name });
      }
    }
    return jails;
  }

  return {
    readJails,
    async version() {
      return parseVersion(await call(['version']));
    },
    async bansWithTime(jail) {
      return parseBansWithTime(await call(['get', jail, 'banip', '--with-time']));
    },
    async ban(jail, ip) {
      return parseCount(await call(['set', jail, 'banip', ip]));
    },
    async unban(ip, jail) {
      return parseCount(await call(jail ? ['set', jail, 'unbanip', ip] : ['unban', ip]));
    },
    async jailsOf(ip) {
      return parseBannedJails(await call(['banned', ip]));
    },
    forgetCapabilities() {
      statusAll = null;
    },
  };
}

export {
  DEFAULT_COMMAND,
  Fail2BanError,
  quote,
  isJailName,
  normalizeAddress,
  treeEntry,
  parseStatus,
  naiveInstant,
  parseBansWithTime,
  parseBannedJails,
  parseCount,
  parseVersion,
  commandError,
  createFail2BanClient,
};
