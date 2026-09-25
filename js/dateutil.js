/*!
 * dateutil.js — calendar-day arithmetic for the Tableau date range picker.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Tableau Extensions API documents that date values handed to
 * applyRangeFilterAsync and Parameter.changeValueAsync are interpreted as UTC
 * (see README "Root cause"). A JavaScript `new Date(2026, 8, 24)` is midnight
 * *local* time, so in any timezone west of Greenwich it serialises to a UTC
 * instant several hours later on the same day, and in any timezone east of
 * Greenwich it serialises to the previous day.
 *
 * The classic "my end date leaks the next day" bug appears when a picker takes
 * that local Date and pads it to 23:59:59 local so the end day is inclusive.
 * In UTC-05:00 that becomes 2026-09-25T04:59:59Z, and every row stamped
 * 2026-09-25 00:00 through 04:59 is inside the filter.
 *
 * The rule enforced here: a date the user picked on a calendar is a
 * CALENDAR DAY, not an instant. It is carried as { y, m, d } with m in 1..12,
 * and it is converted to a Date exactly once, at the boundary, using Date.UTC.
 * No code path in this project calls new Date(y, m, d) or setHours().
 */
(function (global) {
  'use strict';

  var MS_PER_DAY = 86400000;

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var MONTH_ABBR = MONTH_NAMES.map(function (n) { return n.slice(0, 3); });
  var DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  /* ---------------------------------------------------------------- core --- */

  /** Build a calendar day. Month is 1-based. */
  function civil(y, m, d) {
    return { y: y, m: m, d: d };
  }

  function isCivil(c) {
    return !!c &&
      typeof c.y === 'number' && typeof c.m === 'number' && typeof c.d === 'number' &&
      isFinite(c.y) && isFinite(c.m) && isFinite(c.d);
  }

  /** Epoch milliseconds at UTC midnight of this calendar day. Used for arithmetic only. */
  function epoch(c) {
    return Date.UTC(c.y, c.m - 1, c.d);
  }

  /** Inverse of epoch(). */
  function fromEpoch(ms) {
    var d = new Date(ms);
    return civil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /** The calendar day it currently is for the person looking at the screen. */
  function today() {
    var n = new Date();
    return civil(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function toISO(c) {
    return pad(c.y, 4) + '-' + pad(c.m, 2) + '-' + pad(c.d, 2);
  }

  /** Parse "YYYY-MM-DD". Returns null on anything else, including impossible days. */
  function fromISO(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return validate(civil(+m[1], +m[2], +m[3]));
  }

  /** Returns the day unchanged if it really exists, otherwise null. */
  function validate(c) {
    if (!isCivil(c)) return null;
    if (c.m < 1 || c.m > 12) return null;
    if (c.d < 1 || c.d > daysInMonth(c.y, c.m)) return null;
    return c;
  }

  function pad(n, width) {
    var s = String(Math.abs(n));
    while (s.length < width) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  /* ---------------------------------------------------------- arithmetic --- */

  function compare(a, b) {
    if (a.y !== b.y) return a.y < b.y ? -1 : 1;
    if (a.m !== b.m) return a.m < b.m ? -1 : 1;
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    return 0;
  }

  function equals(a, b) {
    return !!a && !!b && compare(a, b) === 0;
  }

  /** True when `c` sits inside [a, b] regardless of which of a/b comes first. */
  function between(c, a, b) {
    if (!a || !b) return false;
    var lo = compare(a, b) <= 0 ? a : b;
    var hi = compare(a, b) <= 0 ? b : a;
    return compare(c, lo) >= 0 && compare(c, hi) <= 0;
  }

  function clamp(c, min, max) {
    if (min && compare(c, min) < 0) return min;
    if (max && compare(c, max) > 0) return max;
    return c;
  }

  function addDays(c, n) {
    return fromEpoch(epoch(c) + n * MS_PER_DAY);
  }

  function diffDays(a, b) {
    return Math.round((epoch(b) - epoch(a)) / MS_PER_DAY);
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /** Month arithmetic clamps the day, so Jan 31 minus one month is Dec 31, not Jan 2. */
  function addMonths(c, n) {
    var total = c.y * 12 + (c.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    return civil(y, m, Math.min(c.d, daysInMonth(y, m)));
  }

  function addYears(c, n) {
    return addMonths(c, n * 12);
  }

  function startOfMonth(c) {
    return civil(c.y, c.m, 1);
  }

  function endOfMonth(c) {
    return civil(c.y, c.m, daysInMonth(c.y, c.m));
  }

  function startOfQuarter(c) {
    return civil(c.y, Math.floor((c.m - 1) / 3) * 3 + 1, 1);
  }

  function endOfQuarter(c) {
    return endOfMonth(addMonths(startOfQuarter(c), 2));
  }

  function startOfYear(c) {
    return civil(c.y, 1, 1);
  }

  function endOfYear(c) {
    return civil(c.y, 12, 31);
  }

  /** 0 = Sunday .. 6 = Saturday, computed in UTC so it cannot drift. */
  function dayOfWeek(c) {
    return new Date(epoch(c)).getUTCDay();
  }

  /** `weekStart` is 0 for Sunday or 1 for Monday. */
  function startOfWeek(c, weekStart) {
    var ws = weekStart === 1 ? 1 : 0;
    var delta = (dayOfWeek(c) - ws + 7) % 7;
    return addDays(c, -delta);
  }

  function endOfWeek(c, weekStart) {
    return addDays(startOfWeek(c, weekStart), 6);
  }

  /* --------------------------------------------------------- formatting --- */

  var FORMATS = {
    'iso': function (c) { return toISO(c); },
    'us': function (c) { return c.m + '/' + c.d + '/' + c.y; },
    'us-padded': function (c) { return pad(c.m, 2) + '/' + pad(c.d, 2) + '/' + c.y; },
    'eu': function (c) { return pad(c.d, 2) + '/' + pad(c.m, 2) + '/' + c.y; },
    'medium': function (c) { return MONTH_ABBR[c.m - 1] + ' ' + c.d + ', ' + c.y; },
    'long': function (c) { return MONTH_NAMES[c.m - 1] + ' ' + c.d + ', ' + c.y; }
  };

  function format(c, fmt) {
    if (!c) return '';
    var fn = FORMATS[fmt] || FORMATS.iso;
    return fn(c);
  }

  /**
   * Lenient text entry. Accepts the ISO form always, plus the ordering implied
   * by `fmt` for slash- and dash-separated input, plus "Sep 24, 2026".
   * Returns null when the text is not a real day.
   */
  function parseFlexible(text, fmt) {
    if (typeof text !== 'string') return null;
    var s = text.trim();
    if (!s) return null;

    var iso = fromISO(s);
    if (iso) return iso;

    var parts = s.split(/[\/\-.\s]+/).filter(Boolean);

    if (parts.length === 3 && /^\d+$/.test(parts.join(''))) {
      var a = +parts[0], b = +parts[1], c3 = +parts[2];
      if (parts[0].length === 4) return validate(civil(a, b, c3));      // Y M D
      if (fmt === 'eu') return validate(civil(normaliseYear(c3), b, a)); // D M Y
      return validate(civil(normaliseYear(c3), a, b));                   // M D Y
    }

    // "Sep 24, 2026" / "24 September 2026"
    var monthIdx = -1, nums = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/,$/, '');
      if (/^\d+$/.test(p)) { nums.push(+p); continue; }
      var lower = p.toLowerCase();
      for (var j = 0; j < MONTH_NAMES.length; j++) {
        if (MONTH_NAMES[j].toLowerCase().indexOf(lower) === 0 && lower.length >= 3) {
          monthIdx = j;
          break;
        }
      }
    }
    if (monthIdx >= 0 && nums.length === 2) {
      var day = nums[0] > 31 ? nums[1] : nums[0];
      var year = nums[0] > 31 ? nums[0] : nums[1];
      return validate(civil(normaliseYear(year), monthIdx + 1, day));
    }
    return null;
  }

  function normaliseYear(y) {
    if (y >= 100) return y;
    return y < 70 ? 2000 + y : 1900 + y;
  }

  /* ----------------------------------------------------- Tableau bounds --- */

  /**
   * The only place in this project where a calendar day becomes a Date.
   *
   * `policy` decides what the *upper* bound looks like:
   *
   *   'midnight'  max = end day at 00:00:00.000Z
   *               Correct for a field Tableau reports as DataType.Date. The
   *               stored values have no time part, so the end day is included
   *               and nothing beyond it can match.
   *
   *   'endOfDay'  max = end day at 23:59:59.999Z
   *               Correct for DataType.DateTime. Covers every timestamp on the
   *               end day and stops 1 ms short of the next day, so the next
   *               day can never be pulled in.
   *
   * Both are computed with Date.UTC, so the wall-clock date the user clicked is
   * the wall-clock date Tableau receives, in every timezone.
   */
  function boundsFor(startDay, endDay, policy) {
    var lo = compare(startDay, endDay) <= 0 ? startDay : endDay;
    var hi = compare(startDay, endDay) <= 0 ? endDay : startDay;

    var min = new Date(Date.UTC(lo.y, lo.m - 1, lo.d, 0, 0, 0, 0));
    var max = policy === 'midnight'
      ? new Date(Date.UTC(hi.y, hi.m - 1, hi.d, 0, 0, 0, 0))
      : new Date(Date.UTC(hi.y, hi.m - 1, hi.d, 23, 59, 59, 999));

    return { min: min, max: max };
  }

  /** UTC midnight of a calendar day, for date parameters. */
  function toUtcMidnight(c) {
    return new Date(Date.UTC(c.y, c.m - 1, c.d, 0, 0, 0, 0));
  }

  /** Read a Date back as the calendar day it represents in UTC. */
  function fromUtcDate(dateLike) {
    var d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (isNaN(d.getTime())) return null;
    return civil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /* -------------------------------------------------------------- export --- */

  global.DRP = global.DRP || {};
  global.DRP.date = {
    MS_PER_DAY: MS_PER_DAY,
    MONTH_NAMES: MONTH_NAMES,
    MONTH_ABBR: MONTH_ABBR,
    DAY_ABBR: DAY_ABBR,
    DAY_NAMES: DAY_NAMES,
    FORMAT_KEYS: Object.keys(FORMATS),

    civil: civil,
    isCivil: isCivil,
    validate: validate,
    today: today,
    toISO: toISO,
    fromISO: fromISO,
    epoch: epoch,
    fromEpoch: fromEpoch,

    compare: compare,
    equals: equals,
    between: between,
    clamp: clamp,
    addDays: addDays,
    addMonths: addMonths,
    addYears: addYears,
    diffDays: diffDays,
    daysInMonth: daysInMonth,
    dayOfWeek: dayOfWeek,
    startOfWeek: startOfWeek,
    endOfWeek: endOfWeek,
    startOfMonth: startOfMonth,
    endOfMonth: endOfMonth,
    startOfQuarter: startOfQuarter,
    endOfQuarter: endOfQuarter,
    startOfYear: startOfYear,
    endOfYear: endOfYear,

    format: format,
    parseFlexible: parseFlexible,

    boundsFor: boundsFor,
    toUtcMidnight: toUtcMidnight,
    fromUtcDate: fromUtcDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
