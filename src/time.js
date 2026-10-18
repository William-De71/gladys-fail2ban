// -----------------------------------------------------------------------------
// Times.
//
// `get <jail> banip --with-time` prints the start of a ban in the wall clock
// of the Fail2Ban server, without a timezone. By default that clock is taken
// to be in the timezone of the Gladys instance (the supervisor injects TZ):
// both usually sit in the same house. A server in another timezone (a VPS in
// UTC) is detected on the first ban seen as it happens — its start then
// differs from the time of the reading by a whole number of quarter hours —
// and that offset is kept (store.clock).
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const QUARTER_MS = 15 * MINUTE_MS;

/**
 * @description The timezone of the instance.
 * @returns {string|undefined} An IANA name, undefined for the system one.
 */
function defaultTimeZone() {
  return process.env.TZ || undefined;
}

/**
 * @description How far a timezone's wall clock is ahead of UTC at an instant.
 * @param {number} instant - The instant, in ms.
 * @param {string} [timeZone] - IANA timezone.
 * @returns {number} The offset in ms (+7 200 000 for Paris in summer).
 */
function zoneOffset(instant, timeZone = defaultTimeZone()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * @description The instant of a wall-clock time of the server.
 * @param {number|null} naive - The wall time read as UTC (fail2ban.naiveInstant).
 * @param {object} options - `{ offset, timeZone }`: the learned offset (ms)
 * or null to use the timezone of the instance.
 * @returns {number|null} The instant in ms.
 */
function serverInstant(naive, { offset = null, timeZone = defaultTimeZone() } = {}) {
  if (!Number.isFinite(naive)) {
    return null;
  }
  if (Number.isFinite(offset)) {
    return naive - offset;
  }
  // The offset at the instant itself (a DST change in between is an edge case).
  const guess = naive - zoneOffset(naive, timeZone);
  return naive - zoneOffset(guess, timeZone);
}

/**
 * @description Learn the offset of the server clock from a ban seen as it
 * happened: it started between the previous reading and this one.
 * @param {number} naive - Its start, read as UTC.
 * @param {number} readAt - When the reading saw it (ms).
 * @returns {number} The offset in ms, a whole number of quarter hours.
 */
function learnOffset(naive, readAt) {
  // `+ 0` turns -0 into 0.
  return Math.round((naive - readAt) / QUARTER_MS) * QUARTER_MS + 0;
}

/**
 * @description "21:09", or "17/10 21:09" when not today, in the language and
 * timezone of the user.
 * @param {number|null} instant - The instant, in ms.
 * @param {object} options - `{ language, timeZone, now }`.
 * @returns {string} The text, '' when none.
 */
function formatWhen(
  instant,
  { language = 'en', timeZone = defaultTimeZone(), now = Date.now() } = {},
) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const day = (value) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  const time = new Intl.DateTimeFormat(language, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
  if (day(instant) === day(now)) {
    return time;
  }
  const date = new Intl.DateTimeFormat(language, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(instant));
  return `${date} ${time}`;
}

/**
 * @description A duration in words: "45 s", "10 min", "2 h", "3 d".
 * @param {number|null} seconds - The duration.
 * @param {object} units - `{ s, min, h, d }` in the user's language.
 * @returns {string} The text, '' when none.
 */
function formatDuration(seconds, units) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} ${units.s}`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} ${units.min}`;
  }
  if (seconds < 86400 * 2) {
    return `${Math.round(seconds / 3600)} ${units.h}`;
  }
  return `${Math.round(seconds / 86400)} ${units.d}`;
}

export {
  MINUTE_MS,
  QUARTER_MS,
  defaultTimeZone,
  zoneOffset,
  serverInstant,
  learnOffset,
  formatWhen,
  formatDuration,
};
