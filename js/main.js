/*!
 * main.js — controller for the extension surface.
 *
 * Runs in two modes. Inside a Tableau dashboard it initialises the Extensions
 * API and applies real filters. Opened directly in a browser (demo.html sets
 * window.DRP_DEMO) it renders the same UI against in-memory settings so the
 * interaction can be reviewed without Tableau.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;
  var Presets = global.DRP.presets;
  var Bridge = global.DRP.tableau;
  var K = Bridge.KEYS;

  var dom = {};
  var calendar = null;
  var config = null;
  var selection = { start: null, end: null };
  var dirty = false;
  var lastApplied = null;
  var resizeFrame = 0;

  /* ------------------------------------------------------------- startup */

  document.addEventListener('DOMContentLoaded', function () {
    cacheDom();

    if (global.DRP_DEMO) {
      config = normaliseConfig(Object.assign({}, Bridge.DEFAULTS, global.DRP_DEMO_SETTINGS || {}));
      buildUi();
      setStatus('Demo mode. Nothing is sent to Tableau.', 'ok');
      return;
    }

    Bridge.initializeAsync(openConfigure).then(function () {
      config = normaliseConfig(Bridge.readSettings());
      return config.fieldName && !config.detectedType
        ? Bridge.detectFieldTypeAsync(config.fieldName).then(cacheDetectedType)
        : null;
    }).then(function () {
      buildUi();
      checkSetup();
      Bridge.onDashboardResize(scheduleLayout);
      return refreshReadback();
    }).catch(function (err) {
      showFatal(Bridge.describeError(err));
    });
  });

  function cacheDom() {
    ['shell', 'body', 'headerTitle', 'summary', 'presets', 'calendar', 'startInput',
     'endInput', 'dayCount', 'status', 'applyBtn', 'clearBtn', 'diagnostics',
     'diagDays', 'diagMin', 'diagMax', 'diagPolicy', 'diagReadback', 'diagTz',
     'setupNotice', 'setupNoticeText', 'setupConfigureBtn'
    ].forEach(function (id) { dom[id] = document.getElementById(id); });
  }

  /* -------------------------------------------------------------- config */

  function normaliseConfig(raw) {
    var worksheets;
    try {
      worksheets = JSON.parse(raw[K.worksheets] || '[]');
      if (!Array.isArray(worksheets)) worksheets = [];
    } catch (e) {
      worksheets = [];
    }

    return {
      targetMode: raw[K.targetMode] || 'filter',
      worksheets: worksheets,
      fieldName: raw[K.fieldName] || '',
      endPolicy: raw[K.endPolicy] || 'auto',
      detectedType: raw[K.detectedType] || '',
      nullOption: raw[K.nullOption] || '',
      startParam: raw[K.startParam] || '',
      endParam: raw[K.endParam] || '',
      weekStart: raw[K.weekStart] === '1' ? 1 : 0,
      dateFormat: raw[K.dateFormat] || 'medium',
      accent: raw[K.accent] || '#1f6feb',
      applyOnSelect: raw[K.applyOnSelect] !== 'false',
      showPresets: raw[K.showPresets] !== 'false',
      showDiagnostics: raw[K.showDiagnostics] === 'true',
      minDate: D.fromISO(raw[K.minDate] || ''),
      maxDate: D.fromISO(raw[K.maxDate] || ''),
      defaultPreset: raw[K.defaultPreset] || 'last30',
      currentStart: D.fromISO(raw[K.currentStart] || ''),
      currentEnd: D.fromISO(raw[K.currentEnd] || '')
    };
  }

  function cacheDetectedType(type) {
    if (!type) return;
    config.detectedType = type;
    var patch = {};
    patch[K.detectedType] = type;
    return Bridge.writeSettings(patch);
  }

  function presetOptions() {
    return {
      weekStart: config.weekStart,
      min: config.minDate,
      max: config.maxDate
    };
  }

  /* ------------------------------------------------------------------ ui */

  function buildUi() {
    applyAccent(config.accent);

    var initial = initialRange();
    selection.start = initial.start;
    selection.end = initial.end;

    calendar = new global.DRP.Calendar(dom.calendar, {
      months: monthsForWidth(),
      weekStart: config.weekStart,
      min: config.minDate,
      max: config.maxDate,
      start: selection.start,
      end: selection.end,
      onChange: onCalendarChange
    });

    buildPresets();
    wireInputs();

    dom.presets.classList.toggle('drp-presets--hidden', !config.showPresets);
    dom.diagnostics.classList.toggle('drp-diagnostics--hidden', !config.showDiagnostics);
    dom.diagTz.textContent = timezoneLabel();
    dom.applyBtn.hidden = config.applyOnSelect;

    global.addEventListener('resize', scheduleLayout);
    if (global.ResizeObserver) {
      // Tableau resizes the extension iframe without always firing a window
      // resize event, so observe the surface directly.
      new global.ResizeObserver(scheduleLayout).observe(dom.shell);
    }
    scheduleLayout();
    syncUi();
  }

  function initialRange() {
    if (config.currentStart && config.currentEnd) {
      return { start: config.currentStart, end: config.currentEnd };
    }
    return Presets.resolve(config.defaultPreset, presetOptions()) ||
      Presets.resolve('last30', presetOptions());
  }

  function applyAccent(hex) {
    var root = document.documentElement;
    root.style.setProperty('--drp-accent', hex);
    root.style.setProperty('--drp-accent-soft', tint(hex, 0.88));
    root.style.setProperty('--drp-accent-edge', tint(hex, 0.7));
  }

  /** Mix `hex` toward white by `amount` (0 = unchanged, 1 = white). */
  function tint(hex, amount) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return '#e7f0ff';
    var n = parseInt(m[1], 16);
    var parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
      return Math.round(c + (255 - c) * amount);
    });
    return 'rgb(' + parts.join(',') + ')';
  }

  function buildPresets() {
    Array.prototype.slice.call(dom.presets.querySelectorAll('.drp-preset'))
      .forEach(function (n) { n.remove(); });

    Presets.list.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drp-preset';
      btn.textContent = p.label;
      btn.setAttribute('data-preset', p.id);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        var r = Presets.resolve(p.id, presetOptions());
        if (!r) return;
        setSelection(r.start, r.end, { fromUser: true });
      });
      dom.presets.appendChild(btn);
    });
  }

  function wireInputs() {
    [['startInput', 'start'], ['endInput', 'end']].forEach(function (pair) {
      var input = dom[pair[0]];
      var which = pair[1];
      input.addEventListener('change', function () { commitInput(which, input); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitInput(which, input); }
      });
    });

    dom.applyBtn.addEventListener('click', function () { apply(); });
    dom.clearBtn.addEventListener('click', function () { clearRange(); });
    dom.setupConfigureBtn.addEventListener('click', function () { openConfigure(); });
  }

  function commitInput(which, input) {
    var parsed = D.parseFlexible(input.value, config.dateFormat);
    if (!parsed) {
      input.classList.add('drp-field__input--invalid');
      setStatus('Could not read "' + input.value + '" as a date.', 'error');
      return;
    }
    input.classList.remove('drp-field__input--invalid');
    parsed = D.clamp(parsed, config.minDate, config.maxDate);

    var start = which === 'start' ? parsed : selection.start;
    var end = which === 'end' ? parsed : selection.end;
    if (start && end && D.compare(start, end) > 0) {
      // Typing an end before the start collapses the range onto that day
      // rather than silently swapping the two values behind the user's back.
      if (which === 'end') start = end; else end = start;
    }
    setSelection(start, end, { fromUser: true });
  }

  function onCalendarChange(range, committed) {
    selection.start = range.start;
    selection.end = range.end;
    dirty = true;
    syncUi();
    if (committed && config.applyOnSelect) apply();
  }

  function setSelection(start, end, opts) {
    selection.start = start || null;
    selection.end = end || null;
    dirty = true;
    if (calendar) calendar.setRange(selection.start, selection.end);
    syncUi();
    if (opts && opts.fromUser && config.applyOnSelect && selection.start && selection.end) {
      apply();
    }
  }

  function syncUi() {
    var s = selection.start, e = selection.end;

    dom.startInput.value = s ? D.format(s, config.dateFormat) : '';
    dom.endInput.value = e ? D.format(e, config.dateFormat) : '';
    dom.startInput.classList.remove('drp-field__input--invalid');
    dom.endInput.classList.remove('drp-field__input--invalid');

    if (s && e) {
      var n = D.diffDays(s, e) + 1;
      dom.dayCount.textContent = n + (n === 1 ? ' day' : ' days');
      dom.summary.textContent = D.format(s, config.dateFormat) + '  –  ' +
        D.format(e, config.dateFormat);
    } else if (s) {
      dom.dayCount.textContent = 'Pick an end date';
      dom.summary.textContent = '';
    } else {
      dom.dayCount.textContent = '';
      dom.summary.textContent = '';
    }

    var activeId = (s && e) ? Presets.match(s, e, presetOptions()) : null;
    Array.prototype.forEach.call(dom.presets.querySelectorAll('.drp-preset'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-preset') === activeId ? 'true' : 'false');
    });

    dom.applyBtn.disabled = !(s && e) || !dirty;
    updateDiagnostics();
  }

  /* ---------------------------------------------------------------- apply */

  function apply() {
    if (!selection.start || !selection.end) return;

    if (!Bridge.isAvailable()) {
      dirty = false;
      lastApplied = D.boundsFor(selection.start, selection.end,
        Bridge.resolveEndPolicy(config.endPolicy, config.detectedType));
      setStatus('Demo mode: would filter ' + D.toISO(selection.start) +
        ' through ' + D.toISO(selection.end) + '.', 'ok');
      syncUi();
      return;
    }

    if (!isConfigured()) {
      checkSetup();
      return;
    }

    dom.applyBtn.disabled = true;
    setStatus('Applying…');

    Bridge.applyRangeAsync(selection.start, selection.end, config).then(function (result) {
      lastApplied = result.bounds;
      dirty = false;

      var patch = {};
      patch[K.currentStart] = D.toISO(selection.start);
      patch[K.currentEnd] = D.toISO(selection.end);
      Bridge.writeSettings(patch);

      if (result.applied.errors.length) {
        setStatus(result.applied.errors.join(' · '), 'error');
      } else {
        setStatus(describeSuccess(result), 'ok');
      }
      syncUi();
      return refreshReadback();
    }).catch(function (err) {
      setStatus(Bridge.describeError(err), 'error');
      syncUi();
    });
  }

  function describeSuccess(result) {
    var bits = [];
    if (result.applied.filter.length) {
      bits.push('Filtered ' + result.applied.filter.length +
        (result.applied.filter.length === 1 ? ' sheet' : ' sheets'));
    }
    if (result.applied.parameters.length) {
      bits.push('set ' + result.applied.parameters.join(' and '));
    }
    if (!bits.length) return 'Nothing to apply. Check the configuration.';
    return bits.join(', ') + '.';
  }

  function clearRange() {
    if (!Bridge.isAvailable()) {
      setSelection(null, null, {});
      setStatus('Demo mode: selection cleared.', 'ok');
      return;
    }
    setStatus('Clearing…');
    Bridge.clearRangeAsync(config).then(function () {
      selection.start = null;
      selection.end = null;
      lastApplied = null;
      dirty = false;
      if (calendar) calendar.setRange(null, null, { keepView: true });
      var patch = {};
      patch[K.currentStart] = '';
      patch[K.currentEnd] = '';
      Bridge.writeSettings(patch);
      setStatus('Filter cleared.', 'ok');
      syncUi();
      return refreshReadback();
    }).catch(function (err) {
      setStatus(Bridge.describeError(err), 'error');
    });
  }

  /* ---------------------------------------------------------- diagnostics */

  function updateDiagnostics() {
    if (!config || !config.showDiagnostics) return;
    var s = selection.start, e = selection.end;
    dom.diagDays.textContent = (s && e)
      ? D.toISO(s) + ' → ' + D.toISO(e)
      : '—';

    var policy = Bridge.resolveEndPolicy(config.endPolicy, config.detectedType);
    var bounds = (s && e) ? D.boundsFor(s, e, policy) : null;
    dom.diagMin.textContent = bounds ? bounds.min.toISOString() : '—';
    dom.diagMax.textContent = bounds ? bounds.max.toISOString() : '—';
    dom.diagPolicy.textContent = policy === 'midnight'
      ? 'midnight (field reported as ' + (config.detectedType || 'date') + ')'
      : 'end of day (field reported as ' + (config.detectedType || 'unknown') + ')';
  }

  function refreshReadback() {
    if (!config.showDiagnostics || !Bridge.isAvailable()) return Promise.resolve();
    return Bridge.readBackAsync(config).then(function (actual) {
      if (!actual || !actual.min || !actual.max) {
        dom.diagReadback.textContent = 'no range filter found';
        return;
      }
      dom.diagReadback.textContent =
        actual.min.toISOString() + '  →  ' + actual.max.toISOString() +
        '   (' + actual.worksheet + ')';
    });
  }

  function timezoneLabel() {
    var offsetMinutes = -new Date().getTimezoneOffset();
    var sign = offsetMinutes < 0 ? '-' : '+';
    var abs = Math.abs(offsetMinutes);
    var hh = String(Math.floor(abs / 60));
    var mm = String(abs % 60);
    while (hh.length < 2) hh = '0' + hh;
    while (mm.length < 2) mm = '0' + mm;
    var name = '';
    try {
      name = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) { /* older engines */ }
    return (name ? name + ' ' : '') + 'UTC' + sign + hh + ':' + mm;
  }

  /* ---------------------------------------------------------- setup state */

  function isConfigured() {
    if (config.targetMode === 'parameters') return !!(config.startParam && config.endParam);
    if (config.targetMode === 'both') {
      return !!config.fieldName && !!(config.startParam && config.endParam);
    }
    return !!config.fieldName;
  }

  function checkSetup() {
    if (isConfigured()) {
      dom.setupNotice.hidden = true;
      return;
    }
    dom.setupNotice.hidden = false;
    dom.setupNoticeText.textContent = config.targetMode === 'filter'
      ? 'Choose the date field this picker should filter.'
      : 'Choose the start and end date parameters this picker should set.';
  }

  function showFatal(message) {
    dom.body.hidden = true;
    dom.diagnostics.hidden = true;
    dom.setupNotice.hidden = false;
    dom.setupNoticeText.textContent = message;
    dom.setupConfigureBtn.hidden = true;
    dom.applyBtn.hidden = true;
    dom.clearBtn.hidden = true;
  }

  function setStatus(message, kind) {
    dom.status.textContent = message || '';
    dom.status.className = 'drp-status' + (kind ? ' drp-status--' + kind : '');
  }

  /* --------------------------------------------------------------- layout */

  /**
   * Measure the extension surface itself. Inside Tableau the shell fills the
   * iframe, so this matches the dashboard zone; in demo.html it matches the
   * resizable preview box.
   */
  function shellSize() {
    var rect = dom.shell.getBoundingClientRect();
    return {
      w: Math.round(rect.width) || document.documentElement.clientWidth,
      h: Math.round(rect.height) || document.documentElement.clientHeight
    };
  }

  function monthsForWidth() {
    // Two months need roughly 420px of calendar once the presets rail and the
    // padding are accounted for. Below that the zone gets a single month
    // instead of a horizontal scrollbar.
    var railed = config && config.showPresets ? 150 : 0;
    return (shellSize().w - railed) >= 420 ? 2 : 1;
  }

  function scheduleLayout() {
    if (resizeFrame) return;
    resizeFrame = global.requestAnimationFrame(function () {
      resizeFrame = 0;
      relayout();
    });
  }

  function relayout() {
    var size = shellSize();
    dom.shell.classList.toggle('drp-shell--compact', size.w < 640);
    dom.shell.classList.toggle('drp-shell--tiny', size.w < 420);
    dom.shell.classList.toggle('drp-shell--short', size.h < 470);
    if (calendar) calendar.setMonths(monthsForWidth());
    fitDayRows();
  }

  /**
   * Size the six week rows to the height that is actually left over, so the
   * last week of the month is never cut off and the panel never scrolls.
   */
  function fitDayRows() {
    var main = dom.calendar.parentElement;
    if (!main) return;

    var chrome = 0;
    Array.prototype.forEach.call(main.children, function (child) {
      if (child !== dom.calendar) chrome += child.offsetHeight;
    });
    var gaps = Math.max(0, main.children.length - 1) * 10;

    var caption = dom.calendar.querySelector('.drp-cal__caption');
    var weekdays = dom.calendar.querySelector('.drp-cal__weekdays');
    var calChrome = (caption ? caption.offsetHeight : 26) +
                    (weekdays ? weekdays.offsetHeight : 18);

    var available = main.clientHeight - chrome - gaps - calChrome;
    var perRow = Math.floor((available - 5) / 6);   // 1px grid gap per row
    perRow = Math.max(18, Math.min(30, perRow));

    document.documentElement.style.setProperty('--drp-day-h', perRow + 'px');
  }

  /* ------------------------------------------------------------ configure */

  function openConfigure() {
    return Bridge.openConfigureDialog('open').then(function () {
      reloadConfig();
    }).catch(function (err) {
      // Tableau rejects with DialogClosedByUser when the user cancels.
      var code = err && err.errorCode;
      if (code && String(code).indexOf('dialog-closed-by-user') < 0 &&
          String(code).toLowerCase().indexOf('dialogclosed') < 0) {
        setStatus(Bridge.describeError(err), 'error');
      }
      reloadConfig();
    });
  }

  function reloadConfig() {
    config = normaliseConfig(Bridge.readSettings());
    applyAccent(config.accent);
    calendar.setWeekStart(config.weekStart);
    calendar.setBounds(config.minDate, config.maxDate);
    dom.presets.classList.toggle('drp-presets--hidden', !config.showPresets);
    dom.diagnostics.classList.toggle('drp-diagnostics--hidden', !config.showDiagnostics);
    dom.applyBtn.hidden = config.applyOnSelect;
    checkSetup();
    relayout();
    dirty = true;
    syncUi();
    refreshReadback();
  }
})(typeof window !== 'undefined' ? window : globalThis);
