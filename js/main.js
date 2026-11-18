/*!
 * main.js — controller for the dashboard bar.
 *
 * The bar is all the extension occupies on a dashboard. It shows the range
 * that is currently applied, offers the quick ranges in a dropdown, and opens
 * the full calendar in a Tableau dialog, which is sized by the extension and
 * is not confined to the dashboard zone.
 *
 * Because the bar always displays the active range, a dashboard no longer
 * needs a separate worksheet to tell people which dates are in force.
 *
 * Runs in two modes. Inside a Tableau dashboard it initialises the Extensions
 * API and applies real filters. Opened directly in a browser (demo.html sets
 * window.DRP_DEMO) it renders the same bar against in-memory settings and
 * defers to window.DRP_DEMO_OPEN for the picker, so the interaction can be
 * reviewed without Tableau.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;
  var Presets = global.DRP.presets;
  var Bridge = global.DRP.tableau;
  var K = Bridge.KEYS;

  var dom = {};
  var config = null;
  var selection = { start: null, end: null };
  var lastReadback = '';
  var resizeFrame = 0;
  var busy = false;

  /* ------------------------------------------------------------- startup */

  document.addEventListener('DOMContentLoaded', function () {
    cacheDom();

    if (global.DRP_DEMO) {
      config = normaliseConfig(Object.assign({}, Bridge.DEFAULTS, global.DRP_DEMO_SETTINGS || {}));
      buildBar();
      var initial = initialRange();
      setSelection(initial.start, initial.end);
      return;
    }

    Bridge.initializeAsync(openConfigure).then(function () {
      config = normaliseConfig(Bridge.readSettings());
      return config.fieldName && !config.detectedType
        ? Bridge.detectFieldTypeAsync(config.fieldName).then(cacheDetectedType)
        : null;
    }).then(function () {
      buildBar();
      checkSetup();
      Bridge.onDashboardResize(scheduleLayout);
      var initial = initialRange();
      setSelection(initial.start, initial.end);
      return applyOnLoad();
    }).catch(function (err) {
      showFatal(Bridge.describeError(err));
    });
  });

  function cacheDom() {
    ['bar', 'barPreset', 'barOpen', 'barRange', 'barStatus',
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

    // 'none' was a third opening mode in an earlier build. The picker now
    // always applies at startup, so a workbook still holding it is read as
    // the default behaviour rather than silently doing nothing.
    var onLoad = raw[K.onLoad] === 'last' ? 'last' : 'default';

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
      showPresets: raw[K.showPresets] !== 'false',
      showDiagnostics: raw[K.showDiagnostics] === 'true',
      minDate: D.fromISO(raw[K.minDate] || ''),
      maxDate: D.fromISO(raw[K.maxDate] || ''),
      defaultPreset: raw[K.defaultPreset] || 'last30',
      onLoad: onLoad,
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

  /**
   * The range the extension opens on.
   *
   * 'default' re-resolves the configured preset against today, which is the
   * point of a relative range such as "This month": a workbook opened in
   * October must show October, not whatever month it was published in.
   *
   * 'last' restores the range that was applied when the workbook was last
   * saved, falling back to the default preset the very first time.
   */
  function initialRange() {
    var preset = Presets.resolve(config.defaultPreset, presetOptions()) ||
      Presets.resolve('last30', presetOptions());

    if (config.onLoad === 'default') return preset;
    if (config.currentStart && config.currentEnd) {
      return { start: config.currentStart, end: config.currentEnd };
    }
    return preset;
  }

  /* ----------------------------------------------------------------- bar */

  function buildBar() {
    applyAccent(config.accent);

    dom.barPreset.innerHTML = '';
    dom.barPreset.appendChild(option('', 'Custom range'));
    Presets.list.forEach(function (p) {
      dom.barPreset.appendChild(option(p.id, p.label));
    });
    dom.barPreset.hidden = !config.showPresets;

    dom.barPreset.addEventListener('change', function () {
      if (!dom.barPreset.value) {
        openPicker();
        return;
      }
      var r = Presets.resolve(dom.barPreset.value, presetOptions());
      if (!r) return;
      setSelection(r.start, r.end);
      apply();
    });

    dom.barOpen.addEventListener('click', function () { openPicker(); });
    dom.setupConfigureBtn.addEventListener('click', function () { openConfigure(); });

    global.addEventListener('resize', scheduleLayout);
    if (global.ResizeObserver) {
      // Tableau resizes the extension iframe without always firing a window
      // resize event, so observe the surface directly.
      new global.ResizeObserver(scheduleLayout).observe(dom.bar);
    }
    scheduleLayout();
  }

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function setSelection(start, end) {
    selection.start = start || null;
    selection.end = end || null;
    syncBar();
  }

  function syncBar() {
    var s = selection.start, e = selection.end;

    if (s && e) {
      dom.barRange.textContent = formatRange(s, e);
      dom.barPreset.value = Presets.match(s, e, presetOptions()) || '';
    } else {
      dom.barRange.textContent = 'Select a date range';
      dom.barPreset.value = '';
    }

    dom.barOpen.title = describeTooltip();
  }

  /**
   * Space on the bar is the scarcest resource on the dashboard, so a range
   * inside one year prints the year once: "Oct 20 – Nov 18, 2026". ISO is left
   * alone, because a half-written ISO date is worse than a long one.
   */
  function formatRange(s, e) {
    var sep = '  –  ';
    var full = D.format(s, config.dateFormat) + sep + D.format(e, config.dateFormat);
    if (config.dateFormat === 'iso' || s.y !== e.y) return full;

    var startText = D.format(s, config.dateFormat);
    var trimmed = startText
      .replace(new RegExp(',?\\s*' + s.y + '\\s*$'), '')   // "Oct 20, 2026" -> "Oct 20"
      .replace(new RegExp('[\\/.-]' + s.y + '\\s*$'), ''); // "10/20/2026"   -> "10/20"

    return (trimmed && trimmed !== startText ? trimmed : startText) + sep +
      D.format(e, config.dateFormat);
  }

  /**
   * The bar is narrow, so the detail that used to sit in a diagnostics strip
   * lives in its tooltip instead.
   */
  function describeTooltip() {
    var s = selection.start, e = selection.end;
    if (!s || !e) return 'Open the date range picker';

    var policy = Bridge.resolveEndPolicy(config.endPolicy, config.detectedType);
    var bounds = D.boundsFor(s, e, policy);
    var lines = [
      D.toISO(s) + ' through ' + D.toISO(e),
      'min ' + bounds.min.toISOString(),
      'max ' + bounds.max.toISOString()
    ];
    if (config.showDiagnostics && lastReadback) lines.push('read back ' + lastReadback);
    lines.push('Click to change');
    return lines.join('\n');
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

  /* -------------------------------------------------------------- picker */

  function openPicker() {
    if (busy) return;
    busy = true;

    var payload = JSON.stringify({
      start: selection.start ? D.toISO(selection.start) : '',
      end: selection.end ? D.toISO(selection.end) : ''
    });

    var opener = global.DRP_DEMO && global.DRP_DEMO_OPEN
      ? global.DRP_DEMO_OPEN(payload)
      : Bridge.openPickerDialog(payload);

    opener.then(function (result) {
      busy = false;
      syncBar();                       // restore the preset dropdown if cancelled
      if (!result) return;             // cancelled

      var chosen;
      try {
        chosen = JSON.parse(result);
      } catch (err) {
        return;
      }
      var start = D.fromISO(chosen.start || '');
      var end = D.fromISO(chosen.end || '');
      if (!start || !end) return;

      setSelection(start, end);
      return apply();
    }).catch(function (err) {
      busy = false;
      syncBar();
      if (!Bridge.isDialogDismissal(err)) {
        setStatus(Bridge.describeError(err), 'error');
      }
    });
  }

  /* ---------------------------------------------------------------- apply */

  /**
   * @param {Object} [opts]
   *   persist {boolean}  false while applying the opening range. Saving
   *     settings calls settings.saveAsync(), which marks the workbook modified
   *     in Tableau Desktop; doing that on every open would prompt the viewer
   *     to save a workbook they never edited.
   */
  function apply(opts) {
    var persist = !opts || opts.persist !== false;
    if (!selection.start || !selection.end) return Promise.resolve();

    if (!Bridge.isAvailable()) {
      setStatus('Demo mode: would filter ' + D.toISO(selection.start) +
        ' through ' + D.toISO(selection.end) + '.', '');
      return Promise.resolve();
    }

    if (!isConfigured()) {
      checkSetup();
      return Promise.resolve();
    }

    setStatus('Applying…', '');

    return Bridge.applyRangeAsync(selection.start, selection.end, config).then(function (result) {
      if (persist) {
        var patch = {};
        patch[K.currentStart] = D.toISO(selection.start);
        patch[K.currentEnd] = D.toISO(selection.end);
        Bridge.writeSettings(patch);
      }

      if (result.applied.errors.length) {
        setStatus(result.applied.errors.join(' · '), 'error');
      } else {
        setStatus('', '');
      }
      return refreshReadback();
    }).catch(function (err) {
      setStatus(Bridge.describeError(err), 'error');
    });
  }

  /**
   * Push the opening range into the workbook.
   *
   * Without this the bar would only *display* a range while the worksheet kept
   * whatever filter was saved with the workbook, so a dashboard would always
   * open on the dates it was published with.
   */
  function applyOnLoad() {
    if (!Bridge.isAvailable()) return Promise.resolve();
    if (!isConfigured()) return Promise.resolve();
    if (!selection.start || !selection.end) return Promise.resolve();

    return apply({ persist: false }).catch(function (err) {
      setStatus('Could not apply the opening range: ' +
        Bridge.describeError(err), 'error');
    });
  }

  function refreshReadback() {
    if (!config.showDiagnostics || !Bridge.isAvailable()) return Promise.resolve();
    return Bridge.readBackAsync(config).then(function (actual) {
      lastReadback = (actual && actual.min && actual.max)
        ? actual.min.toISOString() + ' → ' + actual.max.toISOString() +
          ' (' + actual.worksheet + ')'
        : 'no range filter found';
      syncBar();
    });
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
      dom.bar.hidden = false;
      return;
    }
    dom.setupNotice.hidden = false;
    dom.bar.hidden = true;
    dom.setupNoticeText.textContent = config.targetMode === 'filter'
      ? 'Choose the date field this picker should filter.'
      : 'Choose the start and end date parameters this picker should set.';
  }

  function showFatal(message) {
    dom.bar.hidden = true;
    dom.setupNotice.hidden = false;
    dom.setupNoticeText.textContent = message;
    dom.setupConfigureBtn.hidden = true;
  }

  function setStatus(message, kind) {
    dom.barStatus.textContent = message || '';
    // The slot is narrow and ellipsises, so the full text stays reachable.
    dom.barStatus.title = message || '';
    dom.barStatus.className = 'drp-bar__status' + (kind ? ' drp-bar__status--' + kind : '');
  }

  /* --------------------------------------------------------------- layout */

  function scheduleLayout() {
    if (resizeFrame) return;
    resizeFrame = global.requestAnimationFrame(function () {
      resizeFrame = 0;
      relayout();
    });
  }

  function relayout() {
    var rect = dom.bar.getBoundingClientRect();
    var width = Math.round(rect.width) || document.documentElement.clientWidth;
    var height = Math.round(rect.height) || document.documentElement.clientHeight;

    // Two controls on one line need roughly 300px. Below that, stack them,
    // which a tall-but-narrow zone can still accommodate.
    var stack = config.showPresets && width < 300 && height >= 62;
    dom.bar.classList.toggle('drp-bar--stacked', stack);
  }

  /* ------------------------------------------------------------ configure */

  function openConfigure() {
    return Bridge.openConfigureDialog('open').then(function () {
      reloadConfig();
    }).catch(function (err) {
      if (!Bridge.isDialogDismissal(err)) {
        setStatus(Bridge.describeError(err), 'error');
      }
      reloadConfig();
    });
  }

  function reloadConfig() {
    var previous = config;
    config = normaliseConfig(Bridge.readSettings());

    applyAccent(config.accent);
    dom.barPreset.hidden = !config.showPresets;
    checkSetup();
    relayout();

    // Changing the opening behaviour should be visible straight away rather
    // than only on the next open, otherwise there is no way to tell whether
    // the setting took. Other settings leave the current selection alone.
    var openingChanged = !previous ||
      previous.defaultPreset !== config.defaultPreset ||
      previous.onLoad !== config.onLoad;

    if (openingChanged && config.onLoad === 'default') {
      var next = initialRange();
      if (next) {
        setSelection(next.start, next.end);
        apply();
        return;
      }
    }

    syncBar();
    refreshReadback();
  }
})(typeof window !== 'undefined' ? window : globalThis);
