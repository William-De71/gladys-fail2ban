# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.1] - 2026-10-24

### Security

- **security:** build the image on Node.js 24.22.1 or later ([18aaef6](https://github.com/William-De71/gladys-fail2ban/commit/18aaef67b2ccdc396bb43c17b4c16fa555b62ad3))

## [0.1.0] - 2026-10-18

### Added

- Connection to Fail2Ban over SSH: the integration runs `fail2ban-client` on the machine it protects (`sudo -n fail2ban-client` by default, any command such as `docker exec fail2ban fail2ban-client`), with an ed25519 key it generates (shown by a configuration button) or a password, and the host key checked (typed fingerprint, or trusted on first use and kept).
- A server device (IPs banned now, failures, bans since start, jails) and one device per jail (IPs banned now, failures, bans and failures since start, last banned IP), for every jail or the listed ones.
- Scene triggers: IP banned (filter by jail or address, with the ban duration and its end), IP unbanned, Fail2Ban unreachable (with its reason) and Fail2Ban back.
- Scene actions: ban an IP (or a CIDR network) in a jail, unban it from one jail or all, check an IP, and read a summary with a ready-made sentence.
- Dashboard widgets: an overview with one row per jail and Ban / Unban forms, and the latest bans with what is left of each and an Unban form.
- Configuration actions: test the connection, show the public key, forget the host key, and a diagnostic written to the logs without any secret.
- Local transport: readings every 30 seconds to 5 minutes on one kept SSH connection; works with `status --all` (Fail2Ban 1.1) and jail by jail (older versions).
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.1]: https://github.com/William-De71/gladys-fail2ban/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/William-De71/gladys-fail2ban/releases/tag/v0.1.0
