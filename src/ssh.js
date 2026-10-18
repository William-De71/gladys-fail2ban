// -----------------------------------------------------------------------------
// The SSH connection to the machine running Fail2Ban.
//
//   - Authentication: the ed25519 key the integration generates in /data on
//     first start (the user copies its public key into `authorized_keys`), or
//     a password. The private key never leaves /data and is never logged.
//   - Host key: the SHA256 fingerprint typed in the configuration, otherwise
//     the one seen at the first connection (trust on first use, kept in
//     /data). A different key afterwards is refused until the user forgets
//     the stored one (configuration action) — it is what a man in the middle
//     would look like.
//   - One connection, kept open between readings (keepalive) and closed after
//     IDLE_CLOSE_MS without a command; the commands run one at a time, so a
//     restrictive `MaxSessions` never refuses a channel.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import ssh2 from 'ssh2';

const { Client, utils } = ssh2;

const DEFAULT_KEY_PATH = '/data/ssh/id_ed25519';
const KEY_COMMENT = 'gladys-fail2ban';
const READY_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 20000;
const KEEPALIVE_MS = 30000;
const IDLE_CLOSE_MS = 10 * 60 * 1000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/**
 * @description An SSH error, with a kind the messages can tell apart.
 */
class SshError extends Error {
  /**
   * @param {string} kind - `unreachable`, `auth`, `host_key`, `timeout`,
   * `config`, `failed`.
   * @param {string} message - The message.
   */
  constructor(kind, message) {
    super(message);
    this.name = 'SshError';
    this.kind = kind;
  }
}

/**
 * @description The OpenSSH fingerprint of a host key: "SHA256:<base64>".
 * @param {Buffer} key - The raw host key.
 * @returns {string} The fingerprint.
 */
function fingerprint(key) {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * @description Normalize a fingerprint typed by a user ("SHA256:abc…", with
 * or without the prefix and the padding).
 * @param {unknown} raw - The text.
 * @returns {string} "SHA256:<base64>", '' when empty or not one.
 */
function normalizeFingerprint(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const match = /^(?:SHA256:)?([A-Za-z0-9+/]{43})=?$/.exec(value);
  return match ? `SHA256:${match[1]}` : '';
}

/**
 * @description The fingerprints of a list typed by a user (a server offers
 * one key per algorithm: ED25519, ECDSA, RSA).
 * @param {unknown} raw - "SHA256:abc…, SHA256:def…".
 * @returns {string[]} The valid fingerprints.
 */
function normalizeFingerprints(raw) {
  return [
    ...new Set(
      (typeof raw === 'string' ? raw : '')
        .split(/[\s,;]+/)
        .map(normalizeFingerprint)
        .filter(Boolean),
    ),
  ];
}

/**
 * @description What an error of ssh2 means for the user.
 * @param {Error} err - The error.
 * @returns {SshError} The classified error.
 */
function classify(err) {
  if (err instanceof SshError) {
    return err;
  }
  const message = String(err?.message ?? err);
  if (err?.level === 'client-authentication' || /authentication methods failed/i.test(message)) {
    return new SshError('auth', message);
  }
  if (err?.level === 'client-timeout' || /timed out/i.test(message)) {
    return new SshError('timeout', message);
  }
  if (
    [
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'ECONNRESET',
    ].includes(err?.code)
  ) {
    return new SshError('unreachable', `${err.code}: ${message}`);
  }
  return new SshError('failed', message);
}

/**
 * @description The key pair of the integration, generated on first use.
 * @param {object} [options] - `{ path, logger }`.
 * @returns {object} `{ privateKey(), publicKey(), path }`.
 */
function createKeyStore({ path = DEFAULT_KEY_PATH, logger } = {}) {
  let pair = null;

  /**
   * @description Read the pair, or generate and write it.
   * @returns {Promise<{ private: string, public: string }>} The pair.
   */
  async function load() {
    if (pair) {
      return pair;
    }
    try {
      const privateKey = await readFile(path, 'utf8');
      const parsed = utils.parseKey(privateKey);
      if (parsed instanceof Error) {
        throw parsed;
      }
      pair = {
        private: privateKey,
        public: `${parsed.type} ${parsed.getPublicSSH().toString('base64')} ${KEY_COMMENT}`,
      };
      return pair;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger?.warn(`Unable to read the SSH key, a new one is generated: ${err.message}`);
      }
    }
    const generated = utils.generateKeyPairSync('ed25519', { comment: KEY_COMMENT });
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, generated.private, { mode: 0o600 });
    await writeFile(`${path}.pub`, `${generated.public}\n`, { mode: 0o644 });
    await chmod(path, 0o600).catch(() => {});
    logger?.info('A new SSH key was generated for the integration');
    pair = { private: generated.private, public: generated.public };
    return pair;
  }

  return {
    path,
    privateKey: async () => (await load()).private,
    publicKey: async () => (await load()).public,
  };
}

/**
 * @description The runner of remote commands.
 * @param {object} options - Options.
 * @param {Function} options.getTarget - `() => { host, port, username,
 * authMethod, password, hostKey }`.
 * @param {object} options.keys - The key store (createKeyStore).
 * @param {Function} options.getKnownHostKey - `() => string`, the stored fingerprint.
 * @param {Function} options.onNewHostKey - `(fingerprint) => Promise`, first use.
 * @param {Function} [options.createClient] - `() => Client` (tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} `{ run(command), close(), lastHostKey }`.
 */
function createSshRunner({
  getTarget,
  keys,
  getKnownHostKey,
  onNewHostKey,
  createClient = () => new Client(),
  logger,
}) {
  let client = null;
  let connecting = null;
  let idleTimer = null;
  let queue = Promise.resolve();
  let seenHostKey = '';

  /**
   * @description Close the connection.
   */
  function close() {
    clearTimeout(idleTimer);
    const current = client;
    client = null;
    connecting = null;
    if (current) {
      try {
        current.end();
      } catch {
        // already closed
      }
    }
  }

  /**
   * @description Close the connection once it has been idle for a while.
   */
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, IDLE_CLOSE_MS);
    idleTimer.unref?.();
  }

  /**
   * @description Open the connection.
   * @returns {Promise<object>} The ready client.
   */
  async function connect() {
    const target = getTarget();
    if (!target.host || !target.username) {
      throw new SshError('config', 'The host and the user are not configured');
    }
    if (target.authMethod === 'password' && !target.password) {
      throw new SshError('config', 'The password is not configured');
    }
    const credentials =
      target.authMethod === 'password'
        ? { password: target.password }
        : { privateKey: await keys.privateKey() };
    const pinned = normalizeFingerprints(target.hostKey);
    const stored = normalizeFingerprint(getKnownHostKey());
    const known = pinned.length > 0 ? pinned : [stored].filter(Boolean);
    let refused = '';
    let firstUse = '';
    return new Promise((resolve, reject) => {
      const candidate = createClient();
      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          try {
            candidate.end();
          } catch {
            // nothing to close
          }
          reject(err);
        }
      };
      candidate.on('ready', async () => {
        if (settled) {
          return;
        }
        if (firstUse) {
          await Promise.resolve(onNewHostKey(firstUse)).catch((err) =>
            logger?.warn(`Unable to store the host key: ${err.message}`),
          );
        }
        settled = true;
        resolve(candidate);
      });
      candidate.on('error', (err) => {
        if (refused) {
          fail(
            new SshError(
              'host_key',
              `The host key of ${target.host} is ${refused}, not ${known.join(' or ')}`,
            ),
          );
          return;
        }
        fail(classify(err));
      });
      candidate.on('close', () => {
        if (client === candidate) {
          client = null;
        }
        fail(new SshError('unreachable', 'The SSH connection closed'));
      });
      try {
        candidate.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          ...credentials,
          readyTimeout: READY_TIMEOUT_MS,
          keepaliveInterval: KEEPALIVE_MS,
          keepaliveCountMax: 3,
          tryKeyboard: false,
          hostVerifier: (key) => {
            seenHostKey = fingerprint(key);
            if (known.length === 0) {
              firstUse = seenHostKey;
              return true;
            }
            if (!known.includes(seenHostKey)) {
              refused = seenHostKey;
              return false;
            }
            return true;
          },
        });
      } catch (err) {
        fail(classify(err));
      }
    });
  }

  /**
   * @description The open connection, opened when needed.
   * @returns {Promise<object>} The client.
   */
  async function ready() {
    if (client) {
      return client;
    }
    if (!connecting) {
      connecting = connect()
        .then((connected) => {
          client = connected;
          return connected;
        })
        .finally(() => {
          connecting = null;
        });
    }
    return connecting;
  }

  /**
   * @description Run one command on an open connection.
   * @param {object} connection - The client.
   * @param {string} command - The command.
   * @returns {Promise<{ stdout: string, stderr: string, code: number|null }>} Its result.
   */
  function exec(connection, command) {
    return new Promise((resolve, reject) => {
      connection.exec(command, (err, stream) => {
        if (err) {
          reject(classify(err));
          return;
        }
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          try {
            stream.close();
          } catch {
            // already closed
          }
          reject(
            new SshError(
              'timeout',
              `The command did not answer within ${COMMAND_TIMEOUT_MS / 1000} s`,
            ),
          );
        }, COMMAND_TIMEOUT_MS);
        stream.on('data', (chunk) => {
          if (stdout.length < MAX_OUTPUT) {
            stdout += chunk.toString('utf8');
          }
        });
        stream.stderr.on('data', (chunk) => {
          if (stderr.length < MAX_OUTPUT) {
            stderr += chunk.toString('utf8');
          }
        });
        stream.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: typeof code === 'number' ? code : null });
        });
      });
    });
  }

  /**
   * @description Run a command (one at a time), reconnecting once when the
   * kept connection turns out to be dead.
   * @param {string} command - The command.
   * @returns {Promise<{ stdout: string, stderr: string, code: number|null }>} Its result.
   */
  function run(command) {
    const task = queue.then(async () => {
      let attempt = 0;
      for (;;) {
        const reused = Boolean(client);
        const connection = await ready();
        try {
          const result = await exec(connection, command);
          armIdle();
          return result;
        } catch (err) {
          close();
          if (!reused || attempt > 0 || err.kind === 'timeout') {
            throw err;
          }
          attempt += 1;
        }
      }
    });
    queue = task.catch(() => {});
    return task;
  }

  return {
    run,
    close,
    get lastHostKey() {
      return seenHostKey;
    },
  };
}

export {
  DEFAULT_KEY_PATH,
  KEY_COMMENT,
  COMMAND_TIMEOUT_MS,
  IDLE_CLOSE_MS,
  SshError,
  fingerprint,
  normalizeFingerprint,
  normalizeFingerprints,
  classify,
  createKeyStore,
  createSshRunner,
};
