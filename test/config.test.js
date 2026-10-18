import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  readHost,
  parseJails,
  isConfigured,
  readLanguage,
} from '../src/config.js';

test('defaults: port 22, the key of the integration, sudo, every jail, one minute', () => {
  assert.deepEqual(normalizeConfig({ host: '192.168.1.10', username: 'gladys' }), {
    host: '192.168.1.10',
    port: 22,
    username: 'gladys',
    authMethod: 'key',
    password: '',
    command: 'sudo -n fail2ban-client',
    hostKey: '',
    jails: [],
    interval: 60,
    language: 'auto',
  });
  assert.deepEqual(normalizeConfig(null).host, '');
});

test('the host as users type it', () => {
  assert.equal(readHost('ssh://root@nas.local:2222'), 'nas.local');
  assert.equal(readHost(' 192.168.1.10:22 '), '192.168.1.10');
  assert.equal(readHost('fd00::10'), 'fd00::10');
  assert.equal(readHost('[fd00::10]:22'), 'fd00::10');
});

test('values out of range fall back', () => {
  const config = normalizeConfig({
    port: '70000',
    interval: '7',
    auth_method: 'x',
    language: 'it',
    command: '  docker  exec f2b   fail2ban-client ',
  });
  assert.equal(config.port, 22);
  assert.equal(config.interval, 60);
  assert.equal(config.authMethod, 'key');
  assert.equal(config.language, 'auto');
  assert.equal(config.command, 'docker exec f2b fail2ban-client');
  assert.equal(normalizeConfig({ port: 2222, interval: '300' }).port, 2222);
});

test('jails: names only, without duplicates', () => {
  assert.deepEqual(parseJails('sshd, recidive;sshd  nginx-http-auth bad;name'), [
    'sshd',
    'recidive',
    'nginx-http-auth',
    'bad',
    'name',
  ]);
  assert.deepEqual(parseJails('sshd$(reboot)'), []);
});

test('configured: host and user, and the password when chosen', () => {
  assert.ok(isConfigured(normalizeConfig({ host: 'h', username: 'u' })));
  assert.ok(!isConfigured(normalizeConfig({ host: 'h' })));
  assert.ok(!isConfigured(normalizeConfig({ host: 'h', username: 'u', auth_method: 'password' })));
  assert.ok(
    isConfigured(
      normalizeConfig({ host: 'h', username: 'u', auth_method: 'password', password: 'p' }),
    ),
  );
  assert.equal(readLanguage({ last_language: 'de' }, 'en'), 'de');
  assert.equal(readLanguage({}, 'en'), 'en');
});
