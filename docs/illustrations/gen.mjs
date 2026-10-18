// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The two widgets on a home server one Saturday evening: four jails parsed by
// the real parser (src/fail2ban.js, from a status --all answer in the format
// of fail2ban-client 1.1.0) and the latest bans, through the real widget
// builders (src/widgets.js). Addresses from the documentation ranges only
// (RFC 5737, RFC 3849): fictitious but realistic, and the same at every run.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildOverviewWidget, buildRecentBansWidget } = await load('src/widgets.js');
const { parseStatus } = await load('src/fail2ban.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

// Saturday 17 October 2026, 21:30 in Paris.
const NOW = Date.parse('2026-10-17T19:30:00Z');
const TZ = 'Europe/Paris';
const MINUTE = 60 * 1000;

const jail = (name, failed, totalFailed, ips, totalBanned, file, last) =>
  [
    `   ${last ? '`' : '|'}- Jail: ${name}`,
    `   ${last ? ' ' : '|'}  |- Filter`,
    `   ${last ? ' ' : '|'}  |  |- Currently failed:\t${failed}`,
    `   ${last ? ' ' : '|'}  |  |- Total failed:\t${totalFailed}`,
    `   ${last ? ' ' : '|'}  |  \`- File list:\t${file}`,
    `   ${last ? ' ' : '|'}  \`- Actions`,
    `   ${last ? ' ' : '|'}     |- Currently banned:\t${ips.length}`,
    `   ${last ? ' ' : '|'}     |- Total banned:\t${totalBanned}`,
    `   ${last ? ' ' : '|'}     \`- Banned IP list:\t${ips.join(' ')}`,
  ].join('\n');
const status = [
  'Status',
  '|- Number of jail:\t4',
  '|- Jail list:\tsshd, recidive, nginx-http-auth, postfix-sasl',
  '`- Status for the jails:',
  jail('sshd', 3, 214, ['203.0.113.7', '198.51.100.23', '2001:db8::5'], 41, '/var/log/auth.log'),
  jail('recidive', 0, 12, ['198.51.100.20', '192.0.2.66'], 4, '/var/log/fail2ban.log'),
  jail('nginx-http-auth', 1, 37, ['203.0.113.80'], 9, '/var/log/nginx/error.log'),
  jail('postfix-sasl', 0, 5, [], 1, '/var/log/mail.log', true),
].join('\n');
const { jails } = parseStatus(status);

const ban = (ip, jailName, minutesAgo, bantime) => {
  const start = NOW - minutesAgo * MINUTE;
  return {
    ip,
    jail: jailName,
    start,
    bantime,
    permanent: bantime < 0,
    until: bantime < 0 ? null : start + bantime * 1000,
  };
};
const bans = [
  ban('203.0.113.7', 'sshd', 3, 600),
  ban('203.0.113.80', 'nginx-http-auth', 11, 3600),
  ban('198.51.100.23', 'sshd', 26, 3600),
  ban('2001:db8::5', 'sshd', 48, 3600),
  ban('192.0.2.66', 'recidive', 5 * 60, 7 * 86400),
  ban('198.51.100.20', 'recidive', 26 * 60, -1),
];

const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    overview: buildOverviewWidget({
      server: { host: 'nas.home.arpa', version: '1.1.0' },
      jails,
      readAt: NOW,
      language,
      timeZone: TZ,
      now: NOW,
    }),
    recent_bans: buildRecentBansWidget({
      bans,
      total: bans.length,
      count: 6,
      readAt: NOW,
      language,
      timeZone: TZ,
      now: NOW,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
