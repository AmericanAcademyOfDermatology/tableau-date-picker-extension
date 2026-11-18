/*!
 * picker-dialog.js — the thin host that runs DRP.Picker inside a Tableau
 * dialog opened with tableau.extensions.ui.displayDialogAsync.
 *
 * The dialog is sized by the extension and is not confined to the dashboard
 * zone, which is the whole point of this layout: the dashboard keeps a compact
 * bar while the calendar gets the room it needs.
 *
 * Configuration comes from the shared settings store. Only the range currently
 * in force travels in the dialog payload, because it lives in the parent
 * frame's memory rather than in settings.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;
  var Bridge = global.DRP.tableau;
  var K = Bridge.KEYS;

  document.addEventListener('DOMContentLoaded', function () {
    Bridge.initializeDialogAsync().then(function (payload) {
      mount(parsePayload(payload));
    }).catch(function (err) {
      fail(Bridge.describeError(err));
    });
  });

  function parsePayload(payload) {
    try {
      var parsed = JSON.parse(payload || '{}');
      return {
        start: D.fromISO(parsed.start || ''),
        end: D.fromISO(parsed.end || '')
      };
    } catch (e) {
      return { start: null, end: null };
    }
  }

  function mount(incoming) {
    var raw = Bridge.readSettings();
    var accent = raw[K.accent] || '#1f6feb';
    applyAccent(accent);

    new global.DRP.Picker(document.getElementById('picker'), {
      start: incoming.start,
      end: incoming.end,
      weekStart: raw[K.weekStart] === '1' ? 1 : 0,
      min: D.fromISO(raw[K.minDate] || ''),
      max: D.fromISO(raw[K.maxDate] || ''),
      dateFormat: raw[K.dateFormat] || 'medium',
      showPresets: raw[K.showPresets] !== 'false',
      diagnostics: raw[K.showDiagnostics] === 'true',
      endPolicy: raw[K.endPolicy] || 'auto',
      detectedType: raw[K.detectedType] || '',

      onCommit: function (range) {
        close(JSON.stringify({
          start: D.toISO(range.start),
          end: D.toISO(range.end)
        }));
      },
      onCancel: function () {
        close('');
      }
    });
  }

  function close(payload) {
    try {
      global.tableau.extensions.ui.closeDialog(payload);
    } catch (e) {
      fail('Could not close the dialog: ' + Bridge.describeError(e));
    }
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

  function fail(message) {
    var box = document.getElementById('pickerError');
    document.getElementById('picker').hidden = true;
    box.hidden = false;
    box.textContent = message;
  }
})(typeof window !== 'undefined' ? window : globalThis);
