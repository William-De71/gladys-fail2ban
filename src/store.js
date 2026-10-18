// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data/fail2ban.json (the only
// writable place of the container):
//   - `hostKeys`  the SSH host key fingerprint seen first, per `host:port`
//                 (trust on first use, see ssh.js);
//   - `seen`      what the scene triggers already know: the server the
//                 readings came from, the banned IPs of each jail at the last
//                 reading, when each ban was first seen, and whether the
//                 server was down. A restart never fires the same event twice;
//   - `clock`     the offset of the server's clock (the times of
//                 `--with-time` carry no timezone), learned from fresh bans.
// The SSH key pair lives next to it, in /data/ssh (ssh.js).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/fail2ban.json';
const EMPTY = () => ({
  hostKeys: {},
  seen: { server: '', jails: {}, firstSeen: {}, down: null },
  clock: { offset: null },
});

/**
 * @description The store.
 * @param {object} [options] - `{ path, logger }`.
 * @returns {object} `{ data, load, save }`.
 */
function createStore({ path = DEFAULT_PATH, logger } = {}) {
  const store = {
    data: EMPTY(),
    /**
     * @description Read the file; an absent or broken file is an empty store.
     * @returns {Promise<void>}
     */
    async load() {
      try {
        const raw = JSON.parse(await readFile(path, 'utf8'));
        const base = EMPTY();
        const value = raw && typeof raw === 'object' ? raw : {};
        const part = (name) => (value[name] && typeof value[name] === 'object' ? value[name] : {});
        store.data = {
          hostKeys: { ...part('hostKeys') },
          seen: { ...base.seen, ...part('seen') },
          clock: { ...base.clock, ...part('clock') },
        };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger?.warn(`Unable to read ${path}: ${err.message}`);
        }
        store.data = EMPTY();
      }
    },
    /**
     * @description Write the file (atomically: a temporary file, then a rename).
     * @returns {Promise<void>}
     */
    async save() {
      try {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify(store.data));
        await rename(temporary, path);
      } catch (err) {
        logger?.warn(`Unable to write ${path}: ${err.message}`);
      }
    },
  };
  return store;
}

export { DEFAULT_PATH, createStore };
