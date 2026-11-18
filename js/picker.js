/*!
 * picker.js — the range-picking UI, mountable into any container.
 *
 * It knows nothing about Tableau. It is given a container, some options and a
 * pair of callbacks, and it reports a chosen range back. Three hosts use it:
 *
 *   picker.html  inside a Tableau dialog, which is sized by the extension and
 *                is not confined to the dashboard zone
 *   demo.html    inside a plain overlay, so the interaction can be reviewed
 *                without Tableau
 *   (future)     any other surface, unchanged
 *
 * Selection commits as soon as a range is complete: a second calendar click, a
 * preset choice, or Enter in a date field. There is no Apply button, and no
 * Clear, because the picker always holds a range.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;
  var Presets = global.DRP.presets;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * @param {HTMLElement} root  container, emptied and owned by the picker
   * @param {Object} options
   *   start, end     {Object}   calendar days to open on
   *   weekStart      {number}   0 Sunday, 1 Monday
   *   min, max       {Object}   selectable bounds or null
   *   dateFormat     {string}   key from DRP.date.FORMAT_KEYS
   *   showPresets    {boolean}
   *   diagnostics    {boolean}  show the computed UTC bounds
   *   endPolicy      {string}   'auto' | 'midnight' | 'endOfDay'
   *   detectedType   {string}   'date' | 'date-time' | ''
   *   onCommit(range)           range is { start, end }
   *   onCancel()
   */
  function Picker(root, options) {
    this.root = root;
    this.opts = Object.assign({
      start: null,
      end: null,
      weekStart: 0,
      min: null,
      max: null,
      dateFormat: 'medium',
      showPresets: true,
      diagnostics: false,
      endPolicy: 'auto',
      detectedType: '',
      onCommit: function () {},
      onCancel: function () {}
    }, options || {});

    this.start = this.opts.start || null;
    this.end = this.opts.end || null;
    this.resizeFrame = 0;

    this._build();
    this._wire();
    this.sync();
    this._scheduleFit();
  }

  Picker.prototype.presetOptions = function () {
    return {
      weekStart: this.opts.weekStart,
      min: this.opts.min,
      max: this.opts.max
    };
  };

  /* --------------------------------------------------------------- build */

  Picker.prototype._build = function () {
    var self = this;
    this.root.innerHTML = '';
    this.root.classList.add('drp-picker');

    /* header doubles as the summary and the text entry */
    var head = el('div', 'drp-picker__head');

    this.presetSelect = el('select', 'drp-picker__preset');
    this.presetSelect.setAttribute('aria-label', 'Quick ranges');
    this.presetSelect.appendChild(this._option('', 'Custom range'));
    Presets.list.forEach(function (p) {
      self.presetSelect.appendChild(self._option(p.id, p.label));
    });
    this.presetSelect.hidden = !this.opts.showPresets;
    head.appendChild(this.presetSelect);

    var dates = el('div', 'drp-picker__dates');
    this.startInput = this._dateInput('start', 'Start date');
    this.endInput = this._dateInput('end', 'End date');
    dates.appendChild(this.startInput);
    dates.appendChild(el('span', 'drp-picker__arrow', '→'));
    dates.appendChild(this.endInput);
    head.appendChild(dates);

    this.count = el('span', 'drp-picker__count');
    head.appendChild(this.count);

    this.root.appendChild(head);

    /* calendar */
    this.calHost = el('div', 'drp-picker__cal');
    this.root.appendChild(this.calHost);

    this.calendar = new global.DRP.Calendar(this.calHost, {
      months: 2,
      weekStart: this.opts.weekStart,
      min: this.opts.min,
      max: this.opts.max,
      start: this.start,
      end: this.end,
      onChange: function (range, committed) {
        self.start = range.start;
        self.end = range.end;
        self.sync();
        if (committed) self._commit();
      }
    });

    /* diagnostics */
    this.diag = el('div', 'drp-diagnostics');
    this.diag.hidden = !this.opts.diagnostics;
    this.diag.innerHTML =
      '<dl>' +
      '<dt>Selected days</dt><dd data-diag="days">&mdash;</dd>' +
      '<dt>Sent as min</dt><dd data-diag="min">&mdash;</dd>' +
      '<dt>Sent as max</dt><dd data-diag="max">&mdash;</dd>' +
      '<dt>End-bound rule</dt><dd data-diag="policy">&mdash;</dd>' +
      '<dt>Browser timezone</dt><dd data-diag="tz">&mdash;</dd>' +
      '</dl>';
    this.root.appendChild(this.diag);

    /* footer */
    var foot = el('div', 'drp-picker__foot');
    this.hint = el('span', 'drp-picker__hint');
    this.cancelBtn = el('button', 'drp-btn', 'Cancel');
    this.cancelBtn.type = 'button';
    foot.appendChild(this.hint);
    foot.appendChild(this.cancelBtn);
    this.root.appendChild(foot);
  };

  Picker.prototype._option = function (value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };

  Picker.prototype._dateInput = function (which, label) {
    var input = el('input', 'drp-picker__date');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('data-which', which);
    input.setAttribute('aria-label', label);
    return input;
  };

  /* ---------------------------------------------------------------- wire */

  Picker.prototype._wire = function () {
    var self = this;

    this.presetSelect.addEventListener('change', function () {
      if (!self.presetSelect.value) return;
      var r = Presets.resolve(self.presetSelect.value, self.presetOptions());
      if (!r) return;
      self.start = r.start;
      self.end = r.end;
      self.calendar.setRange(r.start, r.end);
      self.sync();
      self._commit();
    });

    [this.startInput, this.endInput].forEach(function (input) {
      input.addEventListener('focus', function () { self.sync(); });
      input.addEventListener('change', function () { self._commitInput(input); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); self._commitInput(input, true); }
        if (e.key === 'Escape') { self.sync(); }
      });
    });

    this.cancelBtn.addEventListener('click', function () { self.opts.onCancel(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.activeElement !== self.startInput &&
          document.activeElement !== self.endInput) {
        self.opts.onCancel();
      }
    });

    global.addEventListener('resize', function () { self._scheduleFit(); });
    if (global.ResizeObserver) {
      new global.ResizeObserver(function () { self._scheduleFit(); }).observe(this.root);
    }
  };

  /**
   * Typing an end before the start collapses the range onto that day rather
   * than silently swapping the two values behind the user's back.
   */
  Picker.prototype._commitInput = function (input, commitWhenComplete) {
    var which = input.getAttribute('data-which');
    var parsed = D.parseFlexible(input.value, this.opts.dateFormat);

    if (!parsed) {
      input.classList.add('drp-picker__date--invalid');
      this.hint.textContent = 'Could not read "' + input.value + '" as a date.';
      return;
    }
    input.classList.remove('drp-picker__date--invalid');
    parsed = D.clamp(parsed, this.opts.min, this.opts.max);

    var start = which === 'start' ? parsed : this.start;
    var end = which === 'end' ? parsed : this.end;
    if (start && end && D.compare(start, end) > 0) {
      if (which === 'end') start = end; else end = start;
    }

    this.start = start;
    this.end = end;
    this.calendar.setRange(start, end);
    this.sync();
    if (commitWhenComplete && start && end) this._commit();
  };

  Picker.prototype._commit = function () {
    if (!this.start || !this.end) return;
    this.opts.onCommit({ start: this.start, end: this.end });
  };

  /* ---------------------------------------------------------------- sync */

  Picker.prototype.sync = function () {
    var s = this.start, e = this.end;

    this.startInput.value = s ? D.format(s, this.opts.dateFormat) : '';
    this.endInput.value = e ? D.format(e, this.opts.dateFormat) : '';
    this.startInput.classList.remove('drp-picker__date--invalid');
    this.endInput.classList.remove('drp-picker__date--invalid');

    // Mark which end the next calendar click will set.
    var arming = !!(s && !e);
    this.startInput.classList.toggle('drp-picker__date--active', !arming && !s);
    this.endInput.classList.toggle('drp-picker__date--active', arming);

    if (s && e) {
      var n = D.diffDays(s, e) + 1;
      this.count.textContent = n + (n === 1 ? ' day' : ' days');
      this.hint.textContent = 'Choosing an end date applies the range and closes this window.';
    } else if (s) {
      this.count.textContent = '';
      this.hint.textContent = 'Now pick an end date.';
    } else {
      this.count.textContent = '';
      this.hint.textContent = 'Pick a start date.';
    }

    if (this.opts.showPresets) {
      var match = (s && e) ? Presets.match(s, e, this.presetOptions()) : null;
      this.presetSelect.value = match || '';
    }

    this._syncDiagnostics();
  };

  Picker.prototype._syncDiagnostics = function () {
    if (!this.opts.diagnostics) return;
    var self = this;
    function set(key, value) {
      var node = self.diag.querySelector('[data-diag="' + key + '"]');
      if (node) node.textContent = value;
    }

    var policy = this.opts.endPolicy === 'midnight' || this.opts.endPolicy === 'endOfDay'
      ? this.opts.endPolicy
      : (this.opts.detectedType === 'date' ? 'midnight' : 'endOfDay');

    if (this.start && this.end) {
      var b = D.boundsFor(this.start, this.end, policy);
      set('days', D.toISO(this.start) + ' → ' + D.toISO(this.end));
      set('min', b.min.toISOString());
      set('max', b.max.toISOString());
    } else {
      set('days', '—');
      set('min', '—');
      set('max', '—');
    }

    set('policy', policy === 'midnight'
      ? 'midnight (field reported as ' + (this.opts.detectedType || 'date') + ')'
      : 'end of day (field reported as ' + (this.opts.detectedType || 'unknown') + ')');
    set('tz', timezoneLabel());
  };

  /* -------------------------------------------------------------- layout */

  Picker.prototype._scheduleFit = function () {
    var self = this;
    if (this.resizeFrame) return;
    this.resizeFrame = global.requestAnimationFrame(function () {
      self.resizeFrame = 0;
      self._fit();
    });
  };

  /** The most week rows any month can occupy. */
  var MAX_ROWS = 6;

  /**
   * Size the week rows and drop to a single month when two will not fit.
   *
   * The row height is derived from MAX_ROWS, never from the row count of the
   * months currently on screen. Dividing by the actual count would make cells
   * on a five-row month taller than on a six-row month, so the grid would
   * change height as the user pages and the navigation arrows would walk up
   * and down under the pointer — unusable when stepping back through many
   * months. Sizing for the worst case keeps the cells and the arrows fixed;
   * a five-row month simply leaves one row of space below the grid.
   */
  Picker.prototype._fit = function () {
    var width = this.calHost.clientWidth;
    if (width) this.calendar.setMonths(width >= 420 ? 2 : 1);

    var available = this.calHost.clientHeight;
    if (!available) return;

    var caption = this.calHost.querySelector('.drp-cal__caption');
    var weekdays = this.calHost.querySelector('.drp-cal__weekdays');
    var chrome = (caption ? caption.offsetHeight : 22) +
                 (weekdays ? weekdays.offsetHeight : 16);

    var perRow = Math.floor((available - chrome - (MAX_ROWS - 1)) / MAX_ROWS);
    perRow = Math.max(18, Math.min(30, perRow));

    document.documentElement.style.setProperty('--drp-day-h', perRow + 'px');
  };

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

  global.DRP.Picker = Picker;
  global.DRP.timezoneLabel = timezoneLabel;
})(typeof window !== 'undefined' ? window : globalThis);
