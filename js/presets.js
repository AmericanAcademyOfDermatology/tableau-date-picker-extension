/*!
 * presets.js — named relative ranges, resolved against the viewer's local
 * calendar day. Every preset returns { start, end } as calendar days.
 *
 * "Today" deliberately means the day it is where the person is sitting, which
 * is why DRP.date.today() reads the local clock. That value is then treated as
 * a pure calendar day from there on; it never carries a time or an offset.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;

  function def(id, label, group, fn) {
    return { id: id, label: label, group: group, resolve: fn };
  }

  var LIST = [
    def('today', 'Today', 'day', function (t) {
      return { start: t, end: t };
    }),
    def('yesterday', 'Yesterday', 'day', function (t) {
      var y = D.addDays(t, -1);
      return { start: y, end: y };
    }),
    def('last7', 'Last 7 days', 'rolling', function (t) {
      return { start: D.addDays(t, -6), end: t };
    }),
    def('last14', 'Last 14 days', 'rolling', function (t) {
      return { start: D.addDays(t, -13), end: t };
    }),
    def('last30', 'Last 30 days', 'rolling', function (t) {
      return { start: D.addDays(t, -29), end: t };
    }),
    def('last90', 'Last 90 days', 'rolling', function (t) {
      return { start: D.addDays(t, -89), end: t };
    }),
    def('last365', 'Last 365 days', 'rolling', function (t) {
      return { start: D.addDays(t, -364), end: t };
    }),
    def('thisWeek', 'This week', 'calendar', function (t, weekStart) {
      return { start: D.startOfWeek(t, weekStart), end: t };
    }),
    def('lastWeek', 'Last week', 'calendar', function (t, weekStart) {
      var s = D.addDays(D.startOfWeek(t, weekStart), -7);
      return { start: s, end: D.addDays(s, 6) };
    }),
    def('thisMonth', 'This month', 'calendar', function (t) {
      return { start: D.startOfMonth(t), end: t };
    }),
    def('lastMonth', 'Last month', 'calendar', function (t) {
      var s = D.startOfMonth(D.addMonths(t, -1));
      return { start: s, end: D.endOfMonth(s) };
    }),
    def('thisQuarter', 'This quarter', 'calendar', function (t) {
      return { start: D.startOfQuarter(t), end: t };
    }),
    def('lastQuarter', 'Last quarter', 'calendar', function (t) {
      var s = D.startOfQuarter(D.addMonths(D.startOfQuarter(t), -1));
      return { start: s, end: D.endOfQuarter(s) };
    }),
    def('ytd', 'Year to date', 'calendar', function (t) {
      return { start: D.startOfYear(t), end: t };
    }),
    def('lastYear', 'Last year', 'calendar', function (t) {
      var s = D.startOfYear(D.addYears(t, -1));
      return { start: s, end: D.endOfYear(s) };
    }),
    def('mtdLast', 'Month to date, last year', 'compare', function (t) {
      var anchor = D.addYears(t, -1);
      return { start: D.startOfMonth(anchor), end: anchor };
    })
  ];

  var BY_ID = {};
  LIST.forEach(function (p) { BY_ID[p.id] = p; });

  /**
   * Resolve a preset id into { start, end }, clamped to the configured
   * selectable window. Returns null for an unknown id.
   */
  function resolve(id, options) {
    var preset = BY_ID[id];
    if (!preset) return null;
    var opts = options || {};
    var anchor = opts.today || D.today();
    var range = preset.resolve(anchor, opts.weekStart === 1 ? 1 : 0);
    var start = D.clamp(range.start, opts.min, opts.max);
    var end = D.clamp(range.end, opts.min, opts.max);
    if (D.compare(start, end) > 0) start = end;
    return { start: start, end: end };
  }

  /** The preset whose resolved range matches this one exactly, if any. */
  function match(start, end, options) {
    for (var i = 0; i < LIST.length; i++) {
      var r = resolve(LIST[i].id, options);
      if (r && D.equals(r.start, start) && D.equals(r.end, end)) return LIST[i].id;
    }
    return null;
  }

  global.DRP.presets = {
    list: LIST,
    byId: BY_ID,
    resolve: resolve,
    match: match
  };
})(typeof window !== 'undefined' ? window : globalThis);
