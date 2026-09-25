/*!
 * configure.js — the settings dialog opened from the extension's
 * "Configure..." context menu item.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;
  var Presets = global.DRP.presets;
  var Bridge = global.DRP.tableau;
  var K = Bridge.KEYS;

  var dom = {};
  var dateFields = [];
  var saved = null;

  document.addEventListener('DOMContentLoaded', function () {
    cacheDom();

    if (!global.tableau || !global.tableau.extensions) {
      setStatus('The Extensions API library did not load.', 'error');
      return;
    }

    Bridge.initializeDialogAsync().then(function () {
      saved = Bridge.readSettings();
      buildStaticLists();
      wire();
      return Promise.all([loadDateFields(), loadWorksheets(), loadParameters()]);
    }).then(function () {
      restore();
      refreshVisibility();
      refreshPolicyCallout();
    }).catch(function (err) {
      setStatus(Bridge.describeError(err), 'error');
    });
  });

  function cacheDom() {
    ['targetMode', 'fieldName', 'fieldHint', 'worksheets', 'startParam', 'endParam',
     'endPolicy', 'nullOption', 'weekStart', 'dateFormat', 'defaultPreset',
     'minDate', 'maxDate', 'accent', 'applyOnSelect', 'showPresets',
     'showDiagnostics', 'saveBtn', 'cancelBtn', 'dialogStatus', 'policyCallout'
    ].forEach(function (id) { dom[id] = document.getElementById(id); });
  }

  function buildStaticLists() {
    Presets.list.forEach(function (p) {
      dom.defaultPreset.appendChild(option(p.id, p.label));
    });
  }

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  /* ----------------------------------------------------------- data load */

  function loadDateFields() {
    return Bridge.listDateFieldsAsync().then(function (fields) {
      dateFields = fields;
      dom.fieldName.innerHTML = '';
      dom.fieldName.appendChild(option('', fields.length ? 'Choose a field…' : 'No date fields found'));
      fields.forEach(function (f) {
        var label = f.name + '  —  ' + (f.dataType === 'date' ? 'date' : 'date & time');
        dom.fieldName.appendChild(option(f.name, label));
      });
      if (!fields.length) {
        dom.fieldHint.textContent =
          'No date fields were returned. The manifest must declare the "full data" ' +
          'permission and the viewer must allow it when prompted.';
      }
    }).catch(function (err) {
      dom.fieldHint.textContent = 'Could not read fields: ' + Bridge.describeError(err);
    });
  }

  function loadWorksheets() {
    dom.worksheets.innerHTML = '';
    Bridge.listWorksheets().forEach(function (name) {
      dom.worksheets.appendChild(option(name, name));
    });
    return Promise.resolve();
  }

  function loadParameters() {
    var dashboard = global.tableau.extensions.dashboardContent.dashboard;
    return dashboard.getParametersAsync().then(function (params) {
      var dateParams = params.filter(function (p) {
        var dt = String(p.dataType || '').toLowerCase();
        return dt === 'date' || dt === 'date-time' || dt === 'datetime';
      });
      [dom.startParam, dom.endParam].forEach(function (select) {
        select.innerHTML = '';
        select.appendChild(option('', dateParams.length ? 'Choose a parameter…' : 'No date parameters found'));
        dateParams.forEach(function (p) {
          select.appendChild(option(p.name, p.name));
        });
      });
    }).catch(function () {
      [dom.startParam, dom.endParam].forEach(function (select) {
        select.innerHTML = '';
        select.appendChild(option('', 'Could not read parameters'));
      });
    });
  }

  /* ------------------------------------------------------------- restore */

  function restore() {
    dom.targetMode.value = saved[K.targetMode] || 'filter';
    selectIfPresent(dom.fieldName, saved[K.fieldName]);
    selectIfPresent(dom.startParam, saved[K.startParam]);
    selectIfPresent(dom.endParam, saved[K.endParam]);
    dom.endPolicy.value = saved[K.endPolicy] || 'auto';
    dom.nullOption.value = saved[K.nullOption] || '';
    dom.weekStart.value = saved[K.weekStart] === '1' ? '1' : '0';
    dom.dateFormat.value = saved[K.dateFormat] || 'medium';
    dom.defaultPreset.value = saved[K.defaultPreset] || 'last30';
    dom.minDate.value = saved[K.minDate] || '';
    dom.maxDate.value = saved[K.maxDate] || '';
    dom.accent.value = saved[K.accent] || '#1f6feb';
    dom.applyOnSelect.checked = saved[K.applyOnSelect] !== 'false';
    dom.showPresets.checked = saved[K.showPresets] !== 'false';
    dom.showDiagnostics.checked = saved[K.showDiagnostics] === 'true';

    var chosen = {};
    try {
      (JSON.parse(saved[K.worksheets] || '[]') || []).forEach(function (n) { chosen[n] = true; });
    } catch (e) { /* stored value was not JSON; treat as "all worksheets" */ }
    Array.prototype.forEach.call(dom.worksheets.options, function (o) {
      o.selected = !!chosen[o.value];
    });
  }

  function selectIfPresent(select, value) {
    if (!value) { select.value = ''; return; }
    var found = Array.prototype.some.call(select.options, function (o) {
      return o.value === value;
    });
    if (!found) select.appendChild(option(value, value + '  —  not found in this dashboard'));
    select.value = value;
  }

  /* --------------------------------------------------------------- wiring */

  function wire() {
    dom.targetMode.addEventListener('change', refreshVisibility);
    dom.fieldName.addEventListener('change', refreshPolicyCallout);
    dom.endPolicy.addEventListener('change', refreshPolicyCallout);
    dom.saveBtn.addEventListener('click', save);
    dom.cancelBtn.addEventListener('click', function () {
      global.tableau.extensions.ui.closeDialog('cancel');
    });
  }

  function refreshVisibility() {
    var mode = dom.targetMode.value;
    Array.prototype.forEach.call(document.querySelectorAll('[data-when]'), function (row) {
      var when = row.getAttribute('data-when');
      var show = mode === 'both' ||
        (when === 'filter' && mode === 'filter') ||
        (when === 'parameters' && mode === 'parameters');
      row.style.display = show ? '' : 'none';
    });
    refreshPolicyCallout();
  }

  function detectedTypeFor(name) {
    for (var i = 0; i < dateFields.length; i++) {
      if (dateFields[i].name === name) return dateFields[i].dataType;
    }
    return '';
  }

  /**
   * Spell out, in wall-clock terms, exactly what the chosen combination sends
   * to Tableau. This is the panel that makes the off-by-one-day question
   * answerable without opening the workbook.
   */
  function refreshPolicyCallout() {
    var detected = detectedTypeFor(dom.fieldName.value);
    var resolved = Bridge.resolveEndPolicy(dom.endPolicy.value, detected);
    var sample = D.civil(2026, 9, 24);
    var bounds = D.boundsFor(D.civil(2026, 9, 1), sample, resolved);

    var typeText = detected === 'date'
      ? 'Tableau reports this field as a <strong>date</strong>.'
      : detected === 'date-time'
        ? 'Tableau reports this field as a <strong>date &amp; time</strong>.'
        : 'The field’s data type is not known yet.';

    dom.policyCallout.innerHTML =
      typeText +
      ' Picking <strong>1 &ndash; 24 September 2026</strong> sends ' +
      '<code>min = ' + bounds.min.toISOString() + '</code> and ' +
      '<code>max = ' + bounds.max.toISOString() + '</code>. ' +
      'Rows stamped 25 September 2026 fall outside that bound, so the day after ' +
      'the end date cannot appear.';
  }

  /* ----------------------------------------------------------------- save */

  function save() {
    var mode = dom.targetMode.value;

    if (mode !== 'parameters' && !dom.fieldName.value) {
      setStatus('Choose a date field before saving.', 'error');
      return;
    }
    if (mode !== 'filter' && (!dom.startParam.value || !dom.endParam.value)) {
      setStatus('Choose both a start and an end parameter before saving.', 'error');
      return;
    }
    if (mode !== 'filter' && dom.startParam.value === dom.endParam.value) {
      setStatus('The start and end parameters must be different.', 'error');
      return;
    }

    var minDay = D.fromISO(dom.minDate.value);
    var maxDay = D.fromISO(dom.maxDate.value);
    if (minDay && maxDay && D.compare(minDay, maxDay) > 0) {
      setStatus('The earliest selectable date must not be after the latest.', 'error');
      return;
    }

    var chosenSheets = Array.prototype.filter.call(dom.worksheets.options, function (o) {
      return o.selected;
    }).map(function (o) { return o.value; });

    var patch = {};
    patch[K.configured] = 'true';
    patch[K.targetMode] = mode;
    patch[K.fieldName] = dom.fieldName.value;
    patch[K.worksheets] = JSON.stringify(chosenSheets);
    patch[K.startParam] = dom.startParam.value;
    patch[K.endParam] = dom.endParam.value;
    patch[K.endPolicy] = dom.endPolicy.value;
    patch[K.detectedType] = detectedTypeFor(dom.fieldName.value);
    patch[K.nullOption] = dom.nullOption.value;
    patch[K.weekStart] = dom.weekStart.value;
    patch[K.dateFormat] = dom.dateFormat.value;
    patch[K.defaultPreset] = dom.defaultPreset.value;
    patch[K.minDate] = dom.minDate.value || '';
    patch[K.maxDate] = dom.maxDate.value || '';
    patch[K.accent] = dom.accent.value;
    patch[K.applyOnSelect] = dom.applyOnSelect.checked ? 'true' : 'false';
    patch[K.showPresets] = dom.showPresets.checked ? 'true' : 'false';
    patch[K.showDiagnostics] = dom.showDiagnostics.checked ? 'true' : 'false';

    setStatus('Saving…');
    Bridge.writeSettings(patch).then(function () {
      global.tableau.extensions.ui.closeDialog('saved');
    }).catch(function (err) {
      setStatus(Bridge.describeError(err), 'error');
    });
  }

  function setStatus(message, kind) {
    dom.dialogStatus.textContent = message || '';
    dom.dialogStatus.className = 'drp-status' + (kind ? ' drp-status--' + kind : '');
  }
})(typeof window !== 'undefined' ? window : globalThis);
