/*!
 * tableau-bridge.js — every call into the Tableau Extensions API lives here.
 *
 * Keeping the API surface in one file means the UI can be opened in a plain
 * browser (demo.html) with no Tableau present, and it means there is exactly
 * one place to audit for date handling.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;

  var SETTING_KEYS = {
    configured: 'drp.configured',
    targetMode: 'drp.targetMode',           // 'filter' | 'parameters' | 'both'
    worksheets: 'drp.worksheets',           // JSON array of names, [] = all
    fieldName: 'drp.fieldName',
    endPolicy: 'drp.endPolicy',             // 'auto' | 'midnight' | 'endOfDay'
    detectedType: 'drp.detectedType',       // cached DataType of fieldName
    nullOption: 'drp.nullOption',           // '' | 'non-null' | 'all'
    startParam: 'drp.startParam',
    endParam: 'drp.endParam',
    weekStart: 'drp.weekStart',
    dateFormat: 'drp.dateFormat',
    accent: 'drp.accent',
    applyOnSelect: 'drp.applyOnSelect',
    showPresets: 'drp.showPresets',
    showDiagnostics: 'drp.showDiagnostics',
    minDate: 'drp.minDate',
    maxDate: 'drp.maxDate',
    defaultPreset: 'drp.defaultPreset',
    currentStart: 'drp.currentStart',
    currentEnd: 'drp.currentEnd'
  };

  var DEFAULTS = {};
  DEFAULTS[SETTING_KEYS.targetMode] = 'filter';
  DEFAULTS[SETTING_KEYS.worksheets] = '[]';
  DEFAULTS[SETTING_KEYS.fieldName] = '';
  DEFAULTS[SETTING_KEYS.endPolicy] = 'auto';
  DEFAULTS[SETTING_KEYS.detectedType] = '';
  DEFAULTS[SETTING_KEYS.nullOption] = '';
  DEFAULTS[SETTING_KEYS.startParam] = '';
  DEFAULTS[SETTING_KEYS.endParam] = '';
  DEFAULTS[SETTING_KEYS.weekStart] = '0';
  DEFAULTS[SETTING_KEYS.dateFormat] = 'medium';
  DEFAULTS[SETTING_KEYS.accent] = '#1f6feb';
  DEFAULTS[SETTING_KEYS.applyOnSelect] = 'true';
  DEFAULTS[SETTING_KEYS.showPresets] = 'true';
  DEFAULTS[SETTING_KEYS.showDiagnostics] = 'false';
  DEFAULTS[SETTING_KEYS.minDate] = '';
  DEFAULTS[SETTING_KEYS.maxDate] = '';
  DEFAULTS[SETTING_KEYS.defaultPreset] = 'last30';
  DEFAULTS[SETTING_KEYS.currentStart] = '';
  DEFAULTS[SETTING_KEYS.currentEnd] = '';

  var available = false;

  function isAvailable() {
    return available;
  }

  function api() {
    return global.tableau && global.tableau.extensions;
  }

  function dashboard() {
    return api().dashboardContent.dashboard;
  }

  /* ------------------------------------------------------------- lifecycle */

  function initializeAsync(onConfigure) {
    if (!api()) {
      available = false;
      return Promise.reject(new Error(
        'The Tableau Extensions API library was not found. Confirm that ' +
        'lib/tableau.extensions.1.latest.js is present and that this page is ' +
        'loaded inside a Tableau dashboard extension object.'
      ));
    }
    var opts = onConfigure ? { configure: onConfigure } : undefined;
    return api().initializeAsync(opts).then(function () {
      available = true;
    });
  }

  /**
   * The configure dialog runs in its own frame and must use the dialog
   * initializer, but it shares the same settings store and dashboard content.
   * Resolves with the payload the extension passed to displayDialogAsync.
   */
  function initializeDialogAsync() {
    if (!api()) {
      available = false;
      return Promise.reject(new Error(
        'The Tableau Extensions API library was not found in the dialog frame.'
      ));
    }
    return api().initializeDialogAsync().then(function (payload) {
      available = true;
      return payload;
    });
  }

  /* -------------------------------------------------------------- settings */

  function readSettings() {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      var raw = available ? api().settings.get(key) : undefined;
      // A stored empty string is a real answer ("no field chosen"), so only a
      // missing key falls back to the default.
      out[key] = (raw === undefined || raw === null) ? DEFAULTS[key] : raw;
    });
    return out;
  }

  function writeSettings(patch) {
    if (!available) return Promise.resolve();
    Object.keys(patch).forEach(function (key) {
      var v = patch[key];
      api().settings.set(key, v === null || v === undefined ? '' : String(v));
    });
    return api().settings.saveAsync();
  }

  /* ------------------------------------------------------------ dashboard */

  function listWorksheets() {
    if (!available) return [];
    return dashboard().worksheets.map(function (ws) { return ws.name; });
  }

  function worksheetsFor(names) {
    var all = dashboard().worksheets;
    if (!names || !names.length) return all.slice();
    var wanted = {};
    names.forEach(function (n) { wanted[n] = true; });
    return all.filter(function (ws) { return wanted[ws.name]; });
  }

  /**
   * Every date/datetime field visible to the dashboard's worksheets, keyed by
   * caption. Requires the "full data" permission declared in the .trex.
   */
  function listDateFieldsAsync() {
    if (!available) return Promise.resolve([]);
    var sheets = dashboard().worksheets;
    return Promise.all(sheets.map(function (ws) {
      return ws.getDataSourcesAsync().then(function (sources) {
        return { sheet: ws.name, sources: sources };
      }).catch(function () {
        return { sheet: ws.name, sources: [] };
      });
    })).then(function (results) {
      var byName = {};
      results.forEach(function (r) {
        r.sources.forEach(function (ds) {
          (ds.fields || []).forEach(function (f) {
            if (f.isHidden) return;
            var dt = normaliseDataType(f.dataType);
            if (dt !== 'date' && dt !== 'date-time') return;
            var entry = byName[f.name] || (byName[f.name] = {
              name: f.name,
              dataType: dt,
              worksheets: [],
              dataSources: []
            });
            // A datetime anywhere wins: it is the stricter end-bound policy.
            if (dt === 'date-time') entry.dataType = 'date-time';
            if (entry.worksheets.indexOf(r.sheet) < 0) entry.worksheets.push(r.sheet);
            if (entry.dataSources.indexOf(ds.name) < 0) entry.dataSources.push(ds.name);
          });
        });
      });
      return Object.keys(byName).sort().map(function (k) { return byName[k]; });
    });
  }

  function normaliseDataType(dt) {
    if (!dt) return '';
    var s = String(dt).toLowerCase();
    if (s === 'date') return 'date';
    if (s === 'date-time' || s === 'datetime') return 'date-time';
    return s;
  }

  /** Look up one field's data type, or '' when it cannot be determined. */
  function detectFieldTypeAsync(fieldName) {
    if (!available || !fieldName) return Promise.resolve('');
    return listDateFieldsAsync().then(function (fields) {
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].name === fieldName) return fields[i].dataType;
      }
      return '';
    }).catch(function () { return ''; });
  }

  /* ------------------------------------------------------------ filtering */

  /**
   * Turn the configured policy plus the detected field type into the concrete
   * upper-bound rule. 'auto' resolves to 'midnight' for a pure date field and
   * 'endOfDay' for a datetime field; an unknown type falls back to 'endOfDay',
   * which includes the whole end day without ever reaching the next one.
   */
  function resolveEndPolicy(configured, detectedType) {
    if (configured === 'midnight' || configured === 'endOfDay') return configured;
    return detectedType === 'date' ? 'midnight' : 'endOfDay';
  }

  function nullOptionValue(setting) {
    var enumRef = global.tableau && global.tableau.FilterNullOption;
    if (!enumRef) return undefined;
    if (setting === 'non-null') return enumRef.NonNullValues;
    if (setting === 'all') return enumRef.AllValues;
    return undefined;
  }

  /**
   * Apply the range. `startDay` and `endDay` are calendar days; the Date
   * objects are built here, once, with Date.UTC.
   */
  function applyRangeAsync(startDay, endDay, config) {
    if (!available) return Promise.reject(new Error('Extension is not initialized.'));

    var policy = resolveEndPolicy(config.endPolicy, config.detectedType);
    var bounds = D.boundsFor(startDay, endDay, policy);
    var filterOptions = { min: bounds.min, max: bounds.max };

    var nullOpt = nullOptionValue(config.nullOption);
    if (nullOpt !== undefined) filterOptions.nullOption = nullOpt;

    var jobs = [];
    var applied = { filter: [], parameters: [], errors: [] };

    if (config.targetMode !== 'parameters' && config.fieldName) {
      worksheetsFor(config.worksheets).forEach(function (ws) {
        jobs.push(
          ws.applyRangeFilterAsync(config.fieldName, filterOptions)
            .then(function () { applied.filter.push(ws.name); })
            .catch(function (err) {
              applied.errors.push(ws.name + ': ' + describeError(err));
            })
        );
      });
    }

    if (config.targetMode !== 'filter') {
      // Parameters receive the same instants as the filter, so a calculation
      // written against them and a filter applied by this extension agree.
      jobs.push(setParameterAsync(config.startParam, bounds.min, applied));
      jobs.push(setParameterAsync(config.endParam, bounds.max, applied));
    }

    return Promise.all(jobs).then(function () {
      return { bounds: bounds, policy: policy, applied: applied };
    });
  }

  function setParameterAsync(name, value, applied) {
    if (!name) return Promise.resolve();
    return dashboard().findParameterAsync(name).then(function (param) {
      if (!param) {
        applied.errors.push('Parameter "' + name + '" was not found.');
        return;
      }
      return param.changeValueAsync(value).then(function () {
        applied.parameters.push(name);
      });
    }).catch(function (err) {
      applied.errors.push('Parameter "' + name + '": ' + describeError(err));
    });
  }

  function clearRangeAsync(config) {
    if (!available) return Promise.reject(new Error('Extension is not initialized.'));
    if (config.targetMode === 'parameters' || !config.fieldName) return Promise.resolve();
    return Promise.all(worksheetsFor(config.worksheets).map(function (ws) {
      return ws.clearFilterAsync(config.fieldName).catch(function () { /* no filter to clear */ });
    }));
  }

  /**
   * Read the filter back out of Tableau so the UI can show what the workbook
   * actually holds rather than what the extension believes it sent.
   */
  function readBackAsync(config) {
    if (!available || !config.fieldName) return Promise.resolve(null);
    var sheets = worksheetsFor(config.worksheets);
    if (!sheets.length) return Promise.resolve(null);

    return sheets[0].getFiltersAsync().then(function (filters) {
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        if (f.fieldName !== config.fieldName) continue;
        if (!f.minValue || !f.maxValue) continue;
        return {
          worksheet: sheets[0].name,
          min: toDate(f.minValue),
          max: toDate(f.maxValue)
        };
      }
      return null;
    }).catch(function () { return null; });
  }

  function toDate(dataValue) {
    var v = dataValue && (dataValue.value !== undefined ? dataValue.value : dataValue.nativeValue);
    if (v instanceof Date) return v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function describeError(err) {
    if (!err) return 'unknown error';
    return err.message || err.errorCode || String(err);
  }

  /* --------------------------------------------------------------- dialog */

  function openConfigureDialog(payload) {
    if (!available) return Promise.reject(new Error('Extension is not initialized.'));
    var url = new URL('configure.html', global.location.href).href;
    return api().ui.displayDialogAsync(url, payload || '', { height: 620, width: 560 });
  }

  function onDashboardResize(handler) {
    if (!available) return function () {};
    try {
      var unregister = dashboard().addEventListener(
        global.tableau.TableauEventType.DashboardLayoutChanged, handler);
      return unregister;
    } catch (e) {
      return function () {};
    }
  }

  global.DRP.tableau = {
    KEYS: SETTING_KEYS,
    DEFAULTS: DEFAULTS,
    isAvailable: isAvailable,
    initializeAsync: initializeAsync,
    initializeDialogAsync: initializeDialogAsync,
    readSettings: readSettings,
    writeSettings: writeSettings,
    listWorksheets: listWorksheets,
    listDateFieldsAsync: listDateFieldsAsync,
    detectFieldTypeAsync: detectFieldTypeAsync,
    resolveEndPolicy: resolveEndPolicy,
    applyRangeAsync: applyRangeAsync,
    clearRangeAsync: clearRangeAsync,
    readBackAsync: readBackAsync,
    openConfigureDialog: openConfigureDialog,
    onDashboardResize: onDashboardResize,
    describeError: describeError
  };
})(typeof window !== 'undefined' ? window : globalThis);
