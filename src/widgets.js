// -----------------------------------------------------------------------------
// Dashboard widgets of the Fail2Ban integration.
//
//   - `overview`     the server at a glance: IPs banned now, failures, bans
//                    since start, the jails (one status row each), and the
//                    buttons Ban an IP (a form: address and jail), Unban
//                    (address, one jail or all) and Refresh;
//   - `recent_bans`  the latest bans, newest first — address, jail, since
//                    when, and a badge with what is left of the ban — with
//                    an Unban button whose form lists them. Every jail, or
//                    one jail typed in the settings.
// Both need a reading of less than a minute (app.js); a button refreshes the
// card once its action is done.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, all, plural, LANGUAGES } from './i18n.js';
import { totals } from './events.js';
import { formatWhen, formatDuration } from './time.js';

const WIDGETS = {
  OVERVIEW: 'overview',
  RECENT_BANS: 'recent_bans',
};
const WIDGET_ACTIONS = {
  BAN: 'ban',
  UNBAN: 'unban',
  UNBAN_LISTED: 'unban_listed',
  REFRESH: 'refresh',
};
// The value of the jail select meaning "every jail" (an option value cannot be empty).
const ALL_JAILS = '*';
const TTL_SECONDS = { content: 60, error: 60, message: 300 };
const BANS_COUNT = { min: 1, max: 8, default: 6 };
const MAX_STATUS_ITEMS = 10;
const MAX_OPTIONS = 50;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 * @example
 * clip('nginx-botsearch-long', 12); // -> 'nginx-botse…'
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description Read a bounded integer setting.
 * @param {unknown} raw - The raw setting.
 * @param {{ min: number, max: number, default: number }} bounds - The bounds.
 * @returns {number} The value.
 */
function readCount(raw, bounds) {
  const value = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/**
 * @description A text in the four languages, clipped.
 * @param {string} key - A TEXTS key.
 * @param {number} max - The bound.
 * @param {object} [values] - The placeholder values.
 * @returns {object} `{ en, fr, de, es }`.
 */
const allClipped = (key, max, values) =>
  Object.fromEntries(
    Object.entries(all(key, values)).map(([lang, text]) => [lang, clip(text, max)]),
  );

/**
 * @description A widget content made of one message, and an optional button.
 * @param {string} message - The message.
 * @param {object} [options] - `{ ttl, refresh }`.
 * @returns {object} The content.
 */
function messageContent(message, { ttl = TTL_SECONDS.message, refresh = false } = {}) {
  const components = [{ type: 'text', variant: 'body', text: clip(message, 300) }];
  if (refresh) {
    components.push(refreshButton());
  }
  return { ttl_seconds: ttl, components };
}

/**
 * @description The Refresh button.
 * @returns {object} The button.
 */
function refreshButton() {
  return {
    type: 'button',
    label: allClipped('buttonRefresh', 24),
    icon: 'refresh-cw',
    action: { key: WIDGET_ACTIONS.REFRESH },
  };
}

/**
 * @description The options of a jail select.
 * @param {string[]} names - The jails.
 * @param {boolean} withAll - Offer "every jail" first.
 * @returns {object[]} The options.
 */
function jailOptions(names, withAll) {
  const options = names.slice(0, MAX_OPTIONS).map((name) => ({
    value: name,
    label: Object.fromEntries(LANGUAGES.map((lang) => [lang, name])),
  }));
  return withAll ? [{ value: ALL_JAILS, label: all('allJails') }, ...options] : options;
}

/**
 * @description The address field of a form.
 * @returns {object} The field.
 */
const addressField = () => ({
  key: 'ip',
  type: 'string',
  label: all('fieldIp'),
  placeholder: all('fieldIpPlaceholder'),
  required: true,
});

/**
 * @description The color of a jail: red with bans, orange with failures.
 * @param {object} jail - The jail.
 * @returns {string} A widget color.
 */
function jailColor(jail) {
  if (jail.currentlyBanned > 0) {
    return WIDGET_COLORS.DANGER;
  }
  return jail.currentlyFailed > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
}

/**
 * @description The "overview" widget.
 * @param {object} options - Options.
 * @param {object} options.server - `{ host, version }`.
 * @param {object[]} options.jails - Every jail.
 * @param {number} options.readAt - When they were read (ms).
 * @param {string} options.language - The user language.
 * @param {string} [options.timeZone] - IANA timezone.
 * @param {number} [options.now] - Now (ms).
 * @returns {object} The content.
 */
function buildOverviewWidget({ server, jails, readAt, language, timeZone, now = Date.now() }) {
  const sum = totals(jails);
  // No heading: the card title already says Fail2Ban, the caption names the
  // server (a heading would cost one of the eight components).
  const components = [
    {
      type: 'value',
      value: sum.banned,
      label: clip(t('tileBanned', language), 24),
      icon: 'slash',
      color: sum.banned > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      value: sum.failed,
      label: clip(t('tileFailed', language), 24),
      icon: 'alert-triangle',
      color: sum.failed > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: sum.totalBanned,
      label: clip(t('tileTotalBanned', language), 24),
      icon: 'shield',
      color: WIDGET_COLORS.INFO,
    },
  ];
  if (jails.length > 0) {
    const shown = [...jails]
      .sort(
        (a, b) => b.currentlyBanned - a.currentlyBanned || b.currentlyFailed - a.currentlyFailed,
      )
      .slice(0, MAX_STATUS_ITEMS);
    components.push({
      type: 'status',
      items: shown.map((jail) => ({
        label: clip(jail.name, 40),
        value: clip(
          `${plural('countBanned', jail.currentlyBanned, language)} · ${plural('countFailed', jail.currentlyFailed, language)}`,
          40,
        ),
        color: jailColor(jail),
      })),
    });
  }
  const updated = t('updatedAt', language, {
    time: formatWhen(readAt, { language, timeZone, now }),
  });
  const caption = [
    server.host,
    jails.length > MAX_STATUS_ITEMS
      ? t('moreJails', language, { n: jails.length - MAX_STATUS_ITEMS })
      : '',
    updated,
    server.version ? `Fail2Ban ${server.version}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (jails.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(`${t('noJail', language)} ${updated}.`, 300),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: clip(caption, 80) });
  }
  const names = jails.map((jail) => jail.name);
  if (names.length > 0) {
    components.push({
      type: 'button',
      label: allClipped('buttonBan', 24),
      icon: 'slash',
      style: 'danger',
      action: {
        key: WIDGET_ACTIONS.BAN,
        fields: [
          addressField(),
          {
            key: 'jail',
            type: 'select',
            label: all('fieldJail'),
            required: true,
            options: jailOptions(names, false),
            default: names.includes('recidive') ? 'recidive' : names[0],
          },
        ],
      },
    });
    components.push({
      type: 'button',
      label: allClipped('buttonUnban', 24),
      icon: 'unlock',
      action: {
        key: WIDGET_ACTIONS.UNBAN,
        fields: [
          addressField(),
          {
            key: 'jail',
            type: 'select',
            label: all('fieldJail'),
            required: true,
            options: jailOptions(names, true),
            default: ALL_JAILS,
          },
        ],
      },
    });
  }
  components.push(refreshButton());
  return { ttl_seconds: TTL_SECONDS.content, components };
}

/**
 * @description The badge of a ban: what is left of it.
 * @param {object} ban - `{ until, permanent }`.
 * @param {string} language - The language.
 * @param {number} now - Now (ms).
 * @returns {{ text: string, color: string }} The badge.
 */
function banBadge(ban, language, now) {
  if (ban.permanent) {
    return { text: clip(t('badgePermanent', language), 16), color: WIDGET_COLORS.DANGER };
  }
  if (!Number.isFinite(ban.until)) {
    return { text: clip(t('badgeBanned', language), 16), color: WIDGET_COLORS.WARNING };
  }
  const seconds = (ban.until - now) / 1000;
  // Fail2Ban lifts an expired ban at its next check: "banned" until then.
  const text =
    seconds >= 1 ? formatDuration(seconds, unitsOf(language)) : t('badgeBanned', language);
  return { text: clip(text, 16), color: WIDGET_COLORS.WARNING };
}

/**
 * @description The duration units of a language.
 * @param {string} language - The language.
 * @returns {{ s: string, min: string, h: string, d: string }} The units.
 */
const unitsOf = (language) => ({
  s: t('unitSeconds', language),
  min: t('unitMinutes', language),
  h: t('unitHours', language),
  d: t('unitDays', language),
});

/**
 * @description The "recent_bans" widget.
 * @param {object} options - Options.
 * @param {object[]} options.bans - The bans `{ ip, jail, start, until,
 * permanent, bantime }`, newest first.
 * @param {number} options.total - How many IPs are banned (in these jails).
 * @param {string} [options.jail] - The jail of the settings, '' for all.
 * @param {number} options.count - How many to show.
 * @param {number} options.readAt - When they were read (ms).
 * @param {string} options.language - The user language.
 * @param {string} [options.timeZone] - IANA timezone.
 * @param {number} [options.now] - Now (ms).
 * @returns {object} The content.
 */
function buildRecentBansWidget({
  bans,
  total,
  jail = '',
  count,
  readAt,
  language,
  timeZone,
  now = Date.now(),
}) {
  const when = (instant) => formatWhen(instant, { language, timeZone, now });
  // The card title already says "Fail2Ban bans": a heading only for one jail.
  const heading = jail
    ? [
        {
          type: 'text',
          variant: 'heading',
          text: clip(t('recentTitleJail', language, { jail }), 40),
        },
      ]
    : [];
  const updated = t('updatedAt', language, { time: when(readAt) });
  if (bans.length === 0) {
    return {
      ttl_seconds: TTL_SECONDS.content,
      components: [
        ...heading,
        { type: 'text', variant: 'body', text: clip(`${t('noBan', language)} ${updated}.`, 300) },
        refreshButton(),
      ],
    };
  }
  const shown = bans.slice(0, Math.min(count, BANS_COUNT.max));
  const units = unitsOf(language);
  const components = [
    ...heading,
    {
      type: 'card-list',
      display: 'list',
      items: shown.map((ban) => {
        const since = Number.isFinite(ban.start) ? when(ban.start) : '';
        const item = {
          title: clip(ban.ip, 60),
          subtitle: clip(
            since ? t('banSubtitle', language, { jail: ban.jail, since }) : ban.jail,
            60,
          ),
          badge: banBadge(ban, language, now),
        };
        const details = [
          t('detailJail', language, { jail: ban.jail }),
          since ? t('detailSince', language, { since }) : '',
          ban.permanent
            ? t('detailPermanent', language)
            : Number.isFinite(ban.until)
              ? t('detailUntil', language, {
                  until: when(ban.until),
                  duration: formatDuration(ban.bantime, units),
                })
              : '',
        ].filter(Boolean);
        item.description = clip(details.join('\n'), 2000);
        return item;
      }),
    },
    {
      type: 'text',
      variant: 'caption',
      text: clip(`${plural('bannedCount', total, language)} · ${updated}`, 80),
    },
    {
      type: 'button',
      label: allClipped('buttonUnban', 24),
      icon: 'unlock',
      action: {
        key: WIDGET_ACTIONS.UNBAN_LISTED,
        fields: [
          {
            key: 'ban',
            type: 'select',
            label: all('fieldBan'),
            required: true,
            options: shown.map((ban) => ({
              value: `${ban.jail}|${ban.ip}`,
              label: Object.fromEntries(
                LANGUAGES.map((lang) => [lang, clip(`${ban.ip} (${ban.jail})`, 60)]),
              ),
            })),
            default: `${shown[0].jail}|${shown[0].ip}`,
          },
        ],
      },
    },
    refreshButton(),
  ];
  return { ttl_seconds: TTL_SECONDS.content, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  ALL_JAILS,
  TTL_SECONDS,
  BANS_COUNT,
  MAX_STATUS_ITEMS,
  clip,
  readCount,
  messageContent,
  jailColor,
  banBadge,
  buildOverviewWidget,
  buildRecentBansWidget,
};
