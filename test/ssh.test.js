// The SSH runner against a fake ssh2 client: the key of the integration,
// trust on first use of the host key, a changed key refused, one reconnection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { statSync, readFileSync } from 'node:fs';

import {
  createKeyStore,
  createSshRunner,
  fingerprint,
  normalizeFingerprint,
  normalizeFingerprints,
  classify,
} from '../src/ssh.js';
import { dataPaths } from './helpers/fake-server.js';

const HOST_KEY = Buffer.from('a fake host key');
const OTHER_KEY = Buffer.from('another host key');

/**
 * @description A fake ssh2 Client: checks the host key, answers commands.
 * @param {object} options - `{ hostKey, answer, failAuth, log }`.
 * @returns {Function} The factory.
 */
function fakeClients({
  hostKey = HOST_KEY,
  answer = () => ({ out: 'ok', code: 0 }),
  failAuth = false,
  log = [],
} = {}) {
  return () => {
    const client = new EventEmitter();
    client.connect = (options) => {
      log.push({ type: 'connect', options });
      setImmediate(() => {
        if (!options.hostVerifier(hostKey)) {
          client.emit(
            'error',
            Object.assign(new Error('Host denied (verification failed)'), { level: 'handshake' }),
          );
          return;
        }
        if (failAuth) {
          client.emit(
            'error',
            Object.assign(new Error('All configured authentication methods failed'), {
              level: 'client-authentication',
            }),
          );
          return;
        }
        client.emit('ready');
      });
    };
    client.exec = (command, callback) => {
      log.push({ type: 'exec', command });
      if (client.dead) {
        callback(new Error('No response from server'));
        return;
      }
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.close = () => {};
      callback(null, stream);
      setImmediate(() => {
        const { out, code } = answer(command);
        stream.emit('data', Buffer.from(out));
        stream.emit('close', code);
      });
    };
    client.end = () => log.push({ type: 'end' });
    log.push({ type: 'client', client });
    return client;
  };
}

const target = (extra = {}) => ({
  host: '192.168.1.10',
  port: 22,
  username: 'gladys',
  authMethod: 'key',
  password: '',
  hostKey: '',
  ...extra,
});

test('fingerprints: the OpenSSH form, typed with or without prefix, several at once', () => {
  const value = fingerprint(HOST_KEY);
  assert.match(value, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(normalizeFingerprint(value.slice(7)), value);
  assert.equal(normalizeFingerprint(`${value}=`), value);
  assert.equal(normalizeFingerprint('nope'), '');
  assert.deepEqual(normalizeFingerprints(`${value}, ${fingerprint(OTHER_KEY)} junk`), [
    value,
    fingerprint(OTHER_KEY),
  ]);
});

test('ssh2 errors are classified', () => {
  assert.equal(
    classify(Object.assign(new Error('x'), { level: 'client-authentication' })).kind,
    'auth',
  );
  assert.equal(
    classify(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })).kind,
    'unreachable',
  );
  assert.equal(
    classify(
      Object.assign(new Error('Timed out while waiting for handshake'), {
        level: 'client-timeout',
      }),
    ).kind,
    'timeout',
  );
});

test('the key of the integration: generated once, private (0600), reloaded', async () => {
  const { keyPath } = dataPaths();
  const keys = createKeyStore({ path: keyPath });
  const publicKey = await keys.publicKey();
  assert.match(publicKey, /^ssh-ed25519 AAAA[A-Za-z0-9+/=]+ gladys-fail2ban$/);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.match(readFileSync(keyPath, 'utf8'), /BEGIN OPENSSH PRIVATE KEY/);
  assert.equal(
    await createKeyStore({ path: keyPath }).publicKey(),
    publicKey,
    'the same key after a restart',
  );
});

test('first connection: the host key is trusted and kept; a different one is refused', async () => {
  const { keyPath } = dataPaths();
  let stored = '';
  const log = [];
  const runner = createSshRunner({
    getTarget: () => target(),
    keys: createKeyStore({ path: keyPath }),
    getKnownHostKey: () => stored,
    onNewHostKey: (value) => {
      stored = value;
    },
    createClient: fakeClients({ log }),
  });
  const result = await runner.run("fail2ban-client 'version'");
  assert.deepEqual(result, { stdout: 'ok', stderr: '', code: 0 });
  assert.equal(stored, fingerprint(HOST_KEY));
  const options = log.find((entry) => entry.type === 'connect').options;
  assert.match(options.privateKey, /BEGIN OPENSSH PRIVATE KEY/);
  assert.equal(options.password, undefined);
  runner.close();

  const changed = createSshRunner({
    getTarget: () => target(),
    keys: createKeyStore({ path: keyPath }),
    getKnownHostKey: () => stored,
    onNewHostKey: () => assert.fail('never stored again'),
    createClient: fakeClients({ hostKey: OTHER_KEY }),
  });
  await assert.rejects(changed.run('x'), { kind: 'host_key' });
  assert.equal(changed.lastHostKey, fingerprint(OTHER_KEY));
});

test('pinned fingerprints win over the stored one; password authentication', async () => {
  const { keyPath } = dataPaths();
  const log = [];
  const runner = createSshRunner({
    getTarget: () =>
      target({
        authMethod: 'password',
        password: 's3cret',
        hostKey: `${fingerprint(OTHER_KEY)} ${fingerprint(HOST_KEY)}`,
      }),
    keys: createKeyStore({ path: keyPath }),
    getKnownHostKey: () => 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    onNewHostKey: () => assert.fail('pinned: nothing stored'),
    createClient: fakeClients({ log }),
  });
  await runner.run('x');
  const options = log.find((entry) => entry.type === 'connect').options;
  assert.equal(options.password, 's3cret');
  assert.equal(options.privateKey, undefined);
});

test('missing configuration, refused login', async () => {
  const keys = createKeyStore({ path: dataPaths().keyPath });
  const base = { keys, getKnownHostKey: () => '', onNewHostKey: () => {} };
  await assert.rejects(
    createSshRunner({
      ...base,
      getTarget: () => target({ host: '' }),
      createClient: fakeClients(),
    }).run('x'),
    { kind: 'config' },
  );
  await assert.rejects(
    createSshRunner({
      ...base,
      getTarget: () => target({ authMethod: 'password' }),
      createClient: fakeClients(),
    }).run('x'),
    { kind: 'config' },
  );
  await assert.rejects(
    createSshRunner({
      ...base,
      getTarget: () => target(),
      createClient: fakeClients({ failAuth: true }),
    }).run('x'),
    { kind: 'auth' },
  );
});

test('one connection for several commands; a dead one is reopened once', async () => {
  const log = [];
  const runner = createSshRunner({
    getTarget: () => target(),
    keys: createKeyStore({ path: dataPaths().keyPath }),
    getKnownHostKey: () => '',
    onNewHostKey: () => {},
    createClient: fakeClients({ log, answer: (command) => ({ out: command, code: 0 }) }),
  });
  const answers = await Promise.all(['a', 'b', 'c'].map((command) => runner.run(command)));
  assert.deepEqual(
    answers.map((answer) => answer.stdout),
    ['a', 'b', 'c'],
  );
  assert.equal(log.filter((entry) => entry.type === 'connect').length, 1);
  log.find((entry) => entry.type === 'client').client.dead = true;
  assert.equal((await runner.run('d')).stdout, 'd');
  assert.equal(log.filter((entry) => entry.type === 'connect').length, 2);
  runner.close();
});
