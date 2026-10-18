// fail2ban-client: its answers, read on a real Fail2Ban 1.1.0 (test/fixtures),
// the errors told apart, the quoting of the arguments.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseStatus,
  parseBansWithTime,
  parseBannedJails,
  parseVersion,
  commandError,
  normalizeAddress,
  quote,
  isJailName,
  createFail2BanClient,
  naiveInstant,
} from '../src/fail2ban.js';
import { fakeFail2Ban, splitCommand } from './helpers/fake-server.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('status --all: every jail, its counters and banned list', () => {
  const { jailNames, jails } = parseStatus(fixture('status-all.txt'));
  assert.deepEqual(jailNames, ['lab-app', 'lab-web']);
  assert.deepEqual(jails, [
    {
      name: 'lab-app',
      currentlyFailed: 0,
      totalFailed: 6,
      currentlyBanned: 0,
      totalBanned: 2,
      bannedIps: [],
      files: ['/var/log/app.log'],
    },
    {
      name: 'lab-web',
      currentlyFailed: 0,
      totalFailed: 5,
      currentlyBanned: 2,
      totalBanned: 5,
      bannedIps: ['192.0.2.0/24', '198.51.100.20'],
      files: ['/var/log/web.log'],
    },
  ]);
});

test('status and status <jail>: the list of jails, then one jail (IPv6 kept whole)', () => {
  assert.deepEqual(parseStatus(fixture('status.txt')), {
    jailNames: ['lab-app', 'lab-web'],
    jails: [],
  });
  const [jail] = parseStatus(fixture('status-jail.txt')).jails;
  assert.equal(jail.name, 'lab-app');
  assert.deepEqual(jail.bannedIps, ['203.0.113.7', '2001:db8::5']);
  assert.equal(jail.currentlyFailed, 2);
});

test('--with-time: start, bantime, permanent bans', () => {
  const bans = parseBansWithTime(fixture('with-time.txt'));
  assert.deepEqual(bans[0], {
    ip: '203.0.113.7',
    start: naiveInstant('2026-10-17 21:24:45'),
    bantime: 600,
    permanent: false,
  });
  assert.equal(bans[1].ip, '2001:db8::5');
  const permanent = parseBansWithTime(fixture('with-time-permanent.txt'));
  assert.equal(permanent.length, 3);
  assert.ok(permanent.every((ban) => ban.permanent && ban.bantime === -1));
});

test('banned <ip>, version', () => {
  assert.deepEqual(parseBannedJails(fixture('banned-ip.txt')), ['lab-web']);
  assert.deepEqual(parseBannedJails('[[]]'), []);
  assert.equal(parseVersion('1.1.0\n'), '1.1.0');
  assert.equal(parseVersion('Fail2Ban v0.10.2'), '0.10.2');
});

test('the errors of the real server are told apart', () => {
  const kind = (name, code) => commandError({ stdout: '', stderr: fixture(name), code })?.kind;
  assert.equal(kind('err-unknown-jail.txt', 255), 'unknown_jail');
  assert.equal(kind('err-permission.txt', 255), 'permission');
  assert.equal(kind('err-sudo.txt', 1), 'sudo');
  assert.equal(kind('err-not-running.txt', 255), 'not_running');
  assert.equal(
    commandError({ stdout: '', stderr: 'sh: fail2ban-client: not found\n', code: 127 }).kind,
    'not_found',
  );
  assert.equal(commandError({ stdout: '1\n', stderr: '', code: 0 }), null);
});

test('addresses: IPv4, IPv6, CIDR; anything else refused (banip would accept it)', () => {
  assert.equal(normalizeAddress(' 203.0.113.7 '), '203.0.113.7');
  assert.equal(normalizeAddress('2001:DB8::5'), '2001:db8::5');
  assert.equal(normalizeAddress('192.0.2.0/24'), '192.0.2.0/24');
  for (const bad of [
    'notanip',
    '192.0.2.0/33',
    '1.2.3.4; rm -rf /',
    "1.2.3.4' x",
    '',
    null,
    'a/b/c',
  ]) {
    assert.equal(normalizeAddress(bad), null, String(bad));
  }
  assert.ok(isJailName('nginx-http-auth'));
  assert.ok(!isJailName('sshd; reboot'));
});

test('arguments are single-quoted: nothing reaches the shell unquoted', async () => {
  assert.equal(quote("it's"), "'it'\\''s'");
  const seen = [];
  const client = createFail2BanClient({
    run: async (command) => {
      seen.push(command);
      return { stdout: '1\n', stderr: '', code: 0 };
    },
    getCommand: () => 'docker exec fail2ban fail2ban-client',
  });
  await client.ban('sshd', '203.0.113.7');
  await client.unban('203.0.113.7', '');
  await client.unban('203.0.113.7', 'sshd');
  assert.deepEqual(seen, [
    "docker exec fail2ban fail2ban-client 'set' 'sshd' 'banip' '203.0.113.7'",
    "docker exec fail2ban fail2ban-client 'unban' '203.0.113.7'",
    "docker exec fail2ban fail2ban-client 'set' 'sshd' 'unbanip' '203.0.113.7'",
  ]);
  assert.deepEqual(splitCommand(seen[0]).args, ['set', 'sshd', 'banip', '203.0.113.7']);
});

test('the fake server answers in the format of the real one', async () => {
  const server = fakeFail2Ban();
  const answer = await server.run("sudo -n fail2ban-client 'status' '--all'");
  const shape = (text) =>
    text
      .split('\n')
      .map((line) => line.replace(/:\t.*$/, ':').replace(/Jail: .*/, 'Jail:'))
      .filter(Boolean);
  assert.deepEqual(shape(answer.stdout), shape(fixture('status-all.txt')));
  const jail = await server.run("sudo -n fail2ban-client 'status' 'sshd'");
  assert.deepEqual(shape(jail.stdout).slice(1), shape(fixture('status-jail.txt')).slice(1));
});

test('a server without status --all is read jail by jail', async () => {
  const server = fakeFail2Ban({ statusAll: false });
  const client = createFail2BanClient({ run: server.run, getCommand: () => '' });
  const jails = await client.readJails();
  assert.deepEqual(
    jails.map((jail) => [jail.name, jail.currentlyBanned]),
    [
      ['sshd', 2],
      ['recidive', 1],
    ],
  );
  server.calls.length = 0;
  await client.readJails();
  assert.deepEqual(server.calls, [
    "sudo -n fail2ban-client 'status'",
    "sudo -n fail2ban-client 'status' 'sshd'",
    "sudo -n fail2ban-client 'status' 'recidive'",
  ]);
});

test('a refused sudo is an error, not an empty server', async () => {
  const client = createFail2BanClient({
    run: async () => ({ stdout: '', stderr: 'sudo: a password is required\n', code: 1 }),
    getCommand: () => '',
  });
  await assert.rejects(client.readJails(), { kind: 'sudo' });
});
