# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Fail2Ban: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Fail2Ban has no network API (a Unix socket on the machine it protects), so
the integration logs in over SSH ([`ssh2`](https://github.com/mscdex/ssh2), the
second runtime dependency) and runs `fail2ban-client` there: `status --all`
(1.1+) or `status` + `status <jail>`, `get <jail> banip --with-time`,
`set <jail> banip|unbanip`, `unban`, `banned <ip>`, `version`.
Transport: local only. Formats checked against a real Fail2Ban 1.1.0
(`test/fixtures/`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/widgets.test.js          # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the reading timer
src/ssh.js              SSH: generated ed25519 key in /data, host key (pinned or TOFU), one kept connection
src/fail2ban.js         fail2ban-client commands (validated, single-quoted) and the parsers of its answers
src/events.js           ban / unban detection, quiet changes, trigger payloads, action outputs
src/device.js           the server and jail devices and their states
src/widgets.js          overview and recent bans dashboard widgets (button forms)
src/store.js            /data/fail2ban.json: host keys, `seen`, clock offset
src/time.js             server wall clock -> instants (TZ, learned offset), formats
src/config.js           configuration (host, port, user, auth, command, host key, jails, interval, language)
src/i18n.js             runtime texts, en / fr / de / es, plurals
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
test/fixtures/          real answers of fail2ban-client 1.1.0
test/helpers/fake-server.js         a fake fail2ban-client in memory, behind the `run` option
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: device and
  feature external ids (`server:main`, `jail:<jail name folded>`), feature
  `category` / `type` / `unit` / `min` / `max` / `step`, the keys of
  `config_schema`, `actions`, the widgets and their settings, scene triggers
  (fields, options, variables) and scene actions (fields, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update the baseline to make a
  test pass without a documented migration.
- **Category / type pairs.** Counters are `counter-sensor` / `integer`
  (0-1 000 000), the last banned IP `text` / `text` (published as `text`).
- **`should_poll` stays false**: the integration reads on its own timer
  (`interval`, 30 s to 5 min). A widget or a scene action reuses a reading of
  less than 60 s.
- **Nothing typed reaches the shell unquoted.** IPs go through
  `normalizeAddress` (IPv4, IPv6, CIDR — `banip` accepts any text without an
  error), jail names through `isJailName` and must exist in the last reading;
  every argument is single-quoted (`quote`). The configured command prefix is
  the only free text, and only the admin sets it.
- **Secrets.** The password is a `secret` field; the private key stays in
  `/data/ssh` (mode 600). Neither is ever logged; the diagnostic says only
  `set` / `missing`.
- **Host key.** Pinned fingerprints win; otherwise the first key seen is kept
  per `host:port` and any other is refused (`host_key`) until the user presses
  "Forget the host key".
- **Events once, never loops.** `seen` (in /data) keeps the banned lists per
  jail: the first reading of a jail (or of another server) is a baseline. A
  ban or unban made by a scene action or a widget button is quiet for 5 min
  (`QUIET_MS`). At most 20 ban and 20 unban events per reading.
  `server_down` waits for a second failed reading on a network error.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it. German uses "du", Spanish "usted",
  like the Gladys interface; "jail" stays "jail".
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. The widget buttons with a form need `gladys_version` `>=5.2.0`.
  Transport: `["local"]`. No permission.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the fake fail2ban-client of
  `test/helpers/fake-server.js`, a fake ssh2 client in `test/ssh.test.js`).
