// A fake Fail2Ban server for the tests, behind the `run` option of the
// integration (in place of SSH). It answers like fail2ban-client 1.1.0 — the
// formats of test/fixtures, read on a real Fail2Ban 1.1.0 (Debian trixie) on
// 2026-10-17 — and keeps its jails in memory, so a test bans, unbans, stops
// the service or breaks SSH. Tests never touch the network.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 2026-10-17 21:30 in Paris: the time of the readings.
const NOW = Date.parse('2026-10-17T19:30:00Z');
const TZ = 'Europe/Paris';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A temporary directory for what is kept in /data.
 * @returns {{ storePath: string, keyPath: string }} The paths (the directory exists).
 */
function dataPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'fail2ban-'));
  return { storePath: join(dir, 'fail2ban.json'), keyPath: join(dir, 'ssh', 'id_ed25519') };
}

/**
 * @description Split the arguments of a command quoted by the integration.
 * @param {string} command - `sudo -n fail2ban-client 'status' 'sshd'`.
 * @returns {{ prefix: string, args: string[] }} The prefix and the arguments.
 */
function splitCommand(command) {
  const first = command.indexOf(" '");
  const prefix = first < 0 ? command : command.slice(0, first);
  const args = [];
  const pattern = /'((?:[^']|'\\'')*)'/g;
  for (const match of command.slice(prefix.length).matchAll(pattern)) {
    args.push(match[1].replace(/'\\''/g, "'"));
  }
  return { prefix, args };
}

/**
 * @description "2026-10-17 21:24:45" in the server's wall clock.
 * @param {number} instant - The instant (ms).
 * @param {number} offset - How far the server's clock is ahead of UTC (ms).
 * @returns {string} The time.
 */
function wall(instant, offset) {
  return new Date(instant + offset).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * @description The fake server.
 * @param {object} [options] - Options.
 * @param {string} [options.version] - Its version.
 * @param {boolean} [options.statusAll] - Whether it knows `status --all` (1.1+).
 * @param {number} [options.offset] - Its clock ahead of UTC (Paris summer by default).
 * @param {Function} [options.now] - The clock of the test.
 * @returns {object} `{ run, jails, calls, state }`.
 */
function fakeFail2Ban({
  version = '1.1.0',
  statusAll = true,
  offset = 2 * 3600 * 1000,
  now = () => NOW,
} = {}) {
  const state = { failure: null, running: true };
  const jails = new Map();
  const calls = [];

  const jail = (
    name,
    { failed = 0, totalFailed = 0, totalBanned = 0, bantime = 600, files } = {},
  ) => {
    jails.set(name, {
      name,
      failed,
      totalFailed,
      totalBanned,
      bantime,
      files: files ?? [`/var/log/${name}.log`],
      bans: new Map(),
    });
  };
  jail('sshd', { failed: 3, totalFailed: 42, totalBanned: 5, files: ['/var/log/auth.log'] });
  jail('recidive', {
    totalFailed: 4,
    totalBanned: 1,
    bantime: -1,
    files: ['/var/log/fail2ban.log'],
  });
  const ban = (name, ip, at = now()) => {
    const entry = jails.get(name);
    if (entry.bans.has(ip)) {
      return 0;
    }
    entry.bans.set(ip, at);
    entry.totalBanned += 1;
    return 1;
  };
  ban('sshd', '203.0.113.7', NOW - 4 * 60 * 1000);
  ban('sshd', '2001:db8::5', NOW - 20 * 60 * 1000);
  ban('recidive', '198.51.100.20', NOW - 26 * 3600 * 1000);
  jails.get('sshd').totalBanned = 5;
  jails.get('recidive').totalBanned = 1;

  const jailTree = (entry, indent, last) => {
    const ips = [...entry.bans.keys()].join(' ');
    const lines = [
      `|- Filter`,
      `|  |- Currently failed:\t${entry.failed}`,
      `|  |- Total failed:\t${entry.totalFailed}`,
      `|  \`- File list:\t${entry.files.join(' ')}`,
      `\`- Actions`,
      `   |- Currently banned:\t${entry.bans.size}`,
      `   |- Total banned:\t${entry.totalBanned}`,
      `   \`- Banned IP list:\t${ips}`,
    ];
    return lines.map((line) => `${indent}${last ? '   ' : '|  '}${line}`);
  };
  const ok = (stdout) => ({ stdout: `${stdout}\n`, stderr: '', code: 0 });
  const error = (message, code = 255) => ({
    stdout: '',
    stderr: `2026-10-17 21:24:35,334 fail2ban                [332]: ERROR   ${message}\n`,
    code,
  });
  const noJail = (name) => ({
    stdout: '',
    stderr: `2026-10-17 21:24:35,334 fail2ban                [332]: ERROR   NOK: ('${name}',)\nSorry but the jail '${name}' does not exist\n`,
    code: 255,
  });

  /**
   * @description Answer a command like fail2ban-client would.
   * @param {string} command - The command.
   * @returns {Promise<{ stdout: string, stderr: string, code: number }>} The result.
   */
  async function run(command) {
    calls.push(command);
    if (state.failure) {
      throw state.failure;
    }
    const { args } = splitCommand(command);
    if (!state.running) {
      return error(
        'Failed to access socket path: /var/run/fail2ban/fail2ban.sock. Is fail2ban running?',
      );
    }
    const [verb, target, sub, value] = args;
    const names = [...jails.keys()];
    if (verb === 'version') {
      return ok(version);
    }
    if (verb === 'status' && target === undefined) {
      return ok(`Status\n|- Number of jail:\t${names.length}\n\`- Jail list:\t${names.join(', ')}`);
    }
    if (verb === 'status' && target === '--all') {
      if (!statusAll) {
        return noJail('--all');
      }
      const lines = [
        'Status',
        `|- Number of jail:\t${names.length}`,
        `|- Jail list:\t${names.join(', ')}`,
        '`- Status for the jails:',
      ];
      names.forEach((name, index) => {
        const last = index === names.length - 1;
        lines.push(`   ${last ? '`' : '|'}- Jail: ${name}`);
        lines.push(...jailTree(jails.get(name), '   ', last));
      });
      return ok(lines.join('\n'));
    }
    if (verb === 'status') {
      const entry = jails.get(target);
      if (!entry) {
        return noJail(target);
      }
      return ok(
        [
          `Status for the jail: ${target}`,
          ...jailTree(entry, '', true).map((l) => l.slice(3)),
        ].join('\n'),
      );
    }
    if (verb === 'get' && sub === 'banip' && value === '--with-time') {
      const entry = jails.get(target);
      if (!entry) {
        return noJail(target);
      }
      return ok(
        [...entry.bans.entries()]
          .map(([ip, at]) => {
            const end =
              entry.bantime < 0 ? '9999-12-31 23:59:59' : wall(at + entry.bantime * 1000, offset);
            return `${ip} \t${wall(at, offset)} + ${entry.bantime} = ${end}`;
          })
          .join('\n'),
      );
    }
    if (verb === 'set' && (sub === 'banip' || sub === 'unbanip')) {
      const entry = jails.get(target);
      if (!entry) {
        return noJail(target);
      }
      if (sub === 'banip') {
        ban(target, value);
        return ok('1');
      }
      return ok(entry.bans.delete(value) ? '1' : '0');
    }
    if (verb === 'unban') {
      let count = 0;
      for (const entry of jails.values()) {
        count += entry.bans.delete(target) ? 1 : 0;
      }
      return ok(String(count));
    }
    if (verb === 'banned') {
      const holding = names.filter((name) => jails.get(name).bans.has(target));
      return ok(`[[${holding.map((name) => `'${name}'`).join(', ')}]]`);
    }
    return error(`Invalid command (no get action or not yet implemented)`);
  }

  return { run, jails, calls, state, ban, addJail: jail };
}

export { NOW, TZ, silent, dataPaths, splitCommand, fakeFail2Ban };
