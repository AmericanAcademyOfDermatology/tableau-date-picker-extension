/*!
 * calendar.js — a side-by-side, two-month range calendar with no dependencies.
 *
 * Behaviour matches the airline-booking pattern: the first click sets the
 * start and arms the range, hovering previews the span, the second click sets
 * the end and commits. Clicking a day earlier than the armed start restarts the
 * selection from that day rather than producing a backwards range.
 *
 * Rendering is split in two on purpose. build() creates the day buttons and
 * only runs when the visible months change; paint() toggles classes on those
 * same buttons and runs on every hover. Rebuilding the grid under the pointer
 * would destroy the element between mousedown and mouseup, and the browser
 * would never fire the click that commits the end date.
 *
 * Every value this widget stores, emits and compares is a calendar day
 * ({ y, m, d }) from DRP.date. It never constructs a Date.
 */
(function (global) {
  'use strict';

  var D = global.DRP.date;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * @param {HTMLElement} root  container, emptied and owned by the widget
   * @param {Object} options
   *   months        {number}  1 or 2 (default 2)
   *   weekStart     {number}  0 Sunday, 1 Monday
   *   min,max       {Object}  selectable bounds, calendar days or null
   *   start,end     {Object}  initial selection
   *   onChange(range, committed)  range is { start, end } or { start, end:null }
   */
  function Calendar(root, options) {
    this.root = root;
    this.opts = Object.assign({
      months: 2,
      weekStart: 0,
      min: null,
      max: null,
      start: null,
      end: null,
      onChange: function () {}
    }, options || {});

    this.start = this.opts.start || null;
    this.end = this.opts.end || null;
    this.hover = null;
    this.armed = false;          // true between the first and second click
    this.focusDay = this.start || D.today();
    this.view = D.startOfMonth(this.start || D.today());
    this.cells = [];             // { day, btn, outside } in visual order

    this._clampViewToBounds();
    this._wire();
    this.build();
  }

  Calendar.prototype._wire = function () {
    var self = this;
    this.root.innerHTML = '';
    this.root.classList.add('drp-cal');

    var nav = el('div', 'drp-cal__nav');
    this.prevBtn = el('button', 'drp-cal__navbtn');
    this.prevBtn.type = 'button';
    this.prevBtn.setAttribute('aria-label', 'Previous month');
    this.prevBtn.innerHTML = '&#8249;';
    this.nextBtn = el('button', 'drp-cal__navbtn drp-cal__navbtn--next');
    this.nextBtn.type = 'button';
    this.nextBtn.setAttribute('aria-label', 'Next month');
    this.nextBtn.innerHTML = '&#8250;';

    this.grids = el('div', 'drp-cal__months');

    nav.appendChild(this.prevBtn);
    nav.appendChild(this.grids);
    nav.appendChild(this.nextBtn);
    this.root.appendChild(nav);

    this.prevBtn.addEventListener('click', function () { self.shiftView(-1); });
    this.nextBtn.addEventListener('click', function () { self.shiftView(1); });

    this.grids.addEventListener('mouseover', function (e) {
      if (!self.armed) return;
      var node = e.target.closest ? e.target.closest('[data-day]') : null;
      if (!node || node.disabled) return;
      var day = D.fromISO(node.getAttribute('data-day'));
      if (!day || (self.hover && D.equals(self.hover, day))) return;
      self.hover = day;
      self.paint();
    });

    this.grids.addEventListener('mouseleave', function () {
      if (!self.hover) return;
      self.hover = null;
      self.paint();
    });

    this.grids.addEventListener('click', function (e) {
      var node = e.target.closest ? e.target.closest('[data-day]') : null;
      if (!node || node.disabled) return;
      var day = D.fromISO(node.getAttribute('data-day'));
      if (day) self.pick(day);
    });

    this.grids.addEventListener('keydown', function (e) { self._onKeyDown(e); });
  };

  Calendar.prototype._clampViewToBounds = function () {
    var span = this.opts.months - 1;
    if (this.opts.max) {
      var latestView = D.startOfMonth(D.addMonths(this.opts.max, -span));
      if (D.compare(this.view, latestView) > 0) this.view = latestView;
    }
    if (this.opts.min) {
      var earliest = D.startOfMonth(this.opts.min);
      if (D.compare(this.view, earliest) < 0) this.view = earliest;
    }
  };

  /* ------------------------------------------------------ public mutators */

  Calendar.prototype.setMonths = function (n) {
    if (this.opts.months === n) return;
    this.opts.months = n;
    this._clampViewToBounds();
    this.build();
  };

  Calendar.prototype.setBounds = function (min, max) {
    this.opts.min = min || null;
    this.opts.max = max || null;
    this._clampViewToBounds();
    this.build();
  };

  Calendar.prototype.setWeekStart = function (ws) {
    var next = ws === 1 ? 1 : 0;
    if (this.opts.weekStart === next) return;
    this.opts.weekStart = next;
    this.build();
  };

  /** Replace the selection without firing onChange. */
  Calendar.prototype.setRange = function (start, end, opts) {
    this.start = start || null;
    this.end = end || null;
    this.armed = false;
    this.hover = null;

    var keepView = opts && opts.keepView === true;
    if (this.start) this.focusDay = this.start;

    if (this.start && !keepView && !this._isVisible(this.start)) {
      this.view = D.startOfMonth(this.start);
      this._clampViewToBounds();
      this.build();
    } else {
      this.paint();
    }
  };

  Calendar.prototype._isVisible = function (day) {
    var last = D.endOfMonth(D.addMonths(this.view, this.opts.months - 1));
    return D.compare(day, this.view) >= 0 && D.compare(day, last) <= 0;
  };

  Calendar.prototype.shiftView = function (delta) {
    this.view = D.addMonths(this.view, delta);
    this._clampViewToBounds();
    this.build();
  };

  Calendar.prototype.isSelectable = function (day) {
    if (this.opts.min && D.compare(day, this.opts.min) < 0) return false;
    if (this.opts.max && D.compare(day, this.opts.max) > 0) return false;
    return true;
  };

  Calendar.prototype.pick = function (day) {
    if (!this.isSelectable(day)) return;

    if (!this.armed || !this.start || D.compare(day, this.start) < 0) {
      this.start = day;
      this.end = null;
      this.armed = true;
      this.hover = null;
    } else {
      this.end = day;
      this.armed = false;
      this.hover = null;
    }

    this.focusDay = day;
    this.paint();
    this.opts.onChange({ start: this.start, end: this.end }, !this.armed && !!this.end);
  };

  /* -------------------------------------------------------------- render */

  /** Structural pass. Recreates the month grids, then paints state onto them. */
  Calendar.prototype.build = function () {
    this.grids.innerHTML = '';
    this.cells = [];

    for (var i = 0; i < this.opts.months; i++) {
      this.grids.appendChild(this._buildMonth(D.addMonths(this.view, i)));
    }

    var span = this.opts.months - 1;
    this.prevBtn.disabled = !!this.opts.min &&
      D.compare(D.startOfMonth(this.view), D.startOfMonth(this.opts.min)) <= 0;
    this.nextBtn.disabled = !!this.opts.max &&
      D.compare(D.addMonths(this.view, span), D.startOfMonth(this.opts.max)) >= 0;

    this.paint();
  };

  Calendar.prototype._buildMonth = function (monthStart) {
    var wrap = el('div', 'drp-cal__month');

    wrap.appendChild(el('div', 'drp-cal__caption',
      D.MONTH_NAMES[monthStart.m - 1] + ' ' + monthStart.y));

    var head = el('div', 'drp-cal__weekdays');
    for (var w = 0; w < 7; w++) {
      var idx = (w + this.opts.weekStart) % 7;
      var cell = el('abbr', 'drp-cal__weekday', D.DAY_ABBR[idx]);
      cell.title = D.DAY_NAMES[idx];
      head.appendChild(cell);
    }
    wrap.appendChild(head);

    var grid = el('div', 'drp-cal__grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', D.MONTH_NAMES[monthStart.m - 1] + ' ' + monthStart.y);

    var cursor = D.startOfWeek(monthStart, this.opts.weekStart);

    // Always six rows, so the two months stay the same height and the grid
    // never jumps as the user pages through months.
    for (var n = 0; n < 42; n++) {
      var outside = cursor.m !== monthStart.m || cursor.y !== monthStart.y;
      var btn = el('button', 'drp-day', String(cursor.d));
      btn.type = 'button';
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('data-day', D.toISO(cursor));
      grid.appendChild(btn);
      this.cells.push({ day: cursor, btn: btn, outside: outside });
      cursor = D.addDays(cursor, 1);
    }

    wrap.appendChild(grid);
    return wrap;
  };

  /** The span to paint: the committed range, or the live preview while armed. */
  Calendar.prototype._paintRange = function () {
    if (this.start && this.end) return { a: this.start, b: this.end };
    if (this.armed && this.start && this.hover) return { a: this.start, b: this.hover };
    return null;
  };

  /**
   * State pass. Touches classes and attributes on the existing buttons only,
   * so the element under the pointer survives a hover.
   */
  Calendar.prototype.paint = function () {
    var span = this._paintRange();
    var lo = span ? (D.compare(span.a, span.b) <= 0 ? span.a : span.b) : null;
    var hi = span ? (D.compare(span.a, span.b) <= 0 ? span.b : span.a) : null;
    var today = D.today();

    for (var i = 0; i < this.cells.length; i++) {
      var cell = this.cells[i];
      var day = cell.day;
      var btn = cell.btn;
      var selectable = !cell.outside && this.isSelectable(day);

      var inRange = !cell.outside && span && D.between(day, lo, hi);
      var isStart = !cell.outside && this.start && D.equals(day, this.start);
      var isEnd = !cell.outside && this.end && D.equals(day, this.end);

      btn.className = 'drp-day' +
        (cell.outside ? ' drp-day--outside' : '') +
        (!selectable && !cell.outside ? ' drp-day--blocked' : '') +
        (!cell.outside && D.equals(day, today) ? ' drp-day--today' : '') +
        (inRange ? ' drp-day--in-range' : '') +
        (inRange && D.equals(day, lo) ? ' drp-day--range-start' : '') +
        (inRange && D.equals(day, hi) ? ' drp-day--range-end' : '') +
        (inRange && D.equals(lo, hi) ? ' drp-day--range-single' : '') +
        (isStart || isEnd ? ' drp-day--endpoint' : '');

      btn.disabled = !selectable;

      var focused = !cell.outside && D.equals(day, this.focusDay);
      btn.tabIndex = (selectable && focused) ? 0 : -1;

      var label = D.format(day, 'long');
      if (isStart) label += ', selected start date';
      else if (isEnd) label += ', selected end date';
      btn.setAttribute('aria-label', label);
      if (inRange) btn.setAttribute('aria-selected', 'true');
      else btn.removeAttribute('aria-selected');
    }

    // Nothing in the visible months can take focus when the focus day scrolled
    // off; give the first selectable cell the roving tabstop instead.
    if (!this.grids.querySelector('[tabindex="0"]')) {
      for (var j = 0; j < this.cells.length; j++) {
        if (!this.cells[j].btn.disabled) { this.cells[j].btn.tabIndex = 0; break; }
      }
    }
  };

  /* ------------------------------------------------------------- keyboard */

  Calendar.prototype._onKeyDown = function (e) {
    var node = e.target;
    if (!node || !node.getAttribute || !node.getAttribute('data-day')) return;
    var day = D.fromISO(node.getAttribute('data-day'));
    if (!day) return;

    var next = null;
    switch (e.key) {
      case 'ArrowLeft':  next = D.addDays(day, -1); break;
      case 'ArrowRight': next = D.addDays(day, 1); break;
      case 'ArrowUp':    next = D.addDays(day, -7); break;
      case 'ArrowDown':  next = D.addDays(day, 7); break;
      case 'Home':       next = D.startOfWeek(day, this.opts.weekStart); break;
      case 'End':        next = D.endOfWeek(day, this.opts.weekStart); break;
      case 'PageUp':     next = D.addMonths(day, e.shiftKey ? -12 : -1); break;
      case 'PageDown':   next = D.addMonths(day, e.shiftKey ? 12 : 1); break;
      case 'Escape':
        if (this.armed) {
          this.armed = false;
          this.hover = null;
          this.paint();
          e.preventDefault();
        }
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.pick(day);
        return;
      default:
        return;
    }

    e.preventDefault();
    next = D.clamp(next, this.opts.min, this.opts.max);
    this.focusDay = next;
    if (this.armed) this.hover = next;

    if (this._isVisible(next)) {
      this.paint();
    } else {
      // Page the view just far enough to bring the new focus day on screen,
      // keeping it in the left month going back and the right month going on.
      this.view = D.compare(next, this.view) < 0
        ? D.startOfMonth(next)
        : D.startOfMonth(D.addMonths(next, -(this.opts.months - 1)));
      this._clampViewToBounds();
      this.build();
    }

    var target = this.grids.querySelector('[data-day="' + D.toISO(next) + '"]:not([disabled])');
    if (target) target.focus();
  };

  global.DRP.Calendar = Calendar;
})(typeof window !== 'undefined' ? window : globalThis);
