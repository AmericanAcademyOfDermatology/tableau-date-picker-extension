/*!
 * barlayout.js — what the dashboard bar shows at a given size.
 *
 * Pure: no DOM, no Tableau, no dates. The bar's layout rules used to live as
 * two numbers inside relayout(), where nothing could reach them. Here they are
 * a function of width, height and configuration, so tests.html can pin the
 * thresholds that decide whether the title appears and whether the controls
 * stack.
 */
(function (global) {
  'use strict';

  /* The title is 11px text on a 14px line, plus the bar's 4px gap. */
  var TITLE_HEIGHT = 18;

  /* A single row of controls is 26px tall inside 8px of vertical padding, so
     34px. Below 52px there is no room for that and a title, and the range
     readout outranks the title, so the title goes. */
  var TITLE_MIN_HEIGHT = 52;

  /* The preset dropdown and the range readout need roughly this much to sit
     side by side without the readout truncating. */
  var STACK_MIN_WIDTH = 300;

  /* Stacking trades width for height: two rows of controls instead of one. */
  var STACK_MIN_HEIGHT = 62;

  /**
   * The text the title should display, or '' when it should show nothing.
   *
   * An empty titleText means "track the configured field", which is what keeps
   * the title current when the field changes. Returning '' rather than a
   * placeholder lets the CSS :empty rule collapse the element, so a workbook
   * with no field name (parameters-only mode) does not reserve a blank line.
   */
  function titleFor(config) {
    if (!config || !config.showTitle) return '';
    var text = String(config.titleText || '').trim();
    if (text) return text;
    return String(config.fieldName || '').trim();
  }

  /**
   * What fits in a zone of this size.
   *
   * The title is resolved first because it changes the height available to
   * everything below it: stacking already needs 62px, and a title above it
   * needs its own 18px on top of that.
   */
  function layoutFor(width, height, opts) {
    var o = opts || {};
    var title = !!o.showTitle && height >= TITLE_MIN_HEIGHT;
    var needed = title ? STACK_MIN_HEIGHT + TITLE_HEIGHT : STACK_MIN_HEIGHT;
    var stacked = !!o.showPresets && width < STACK_MIN_WIDTH && height >= needed;
    return { title: title, stacked: stacked };
  }

  global.DRP = global.DRP || {};
  global.DRP.barlayout = {
    TITLE_HEIGHT: TITLE_HEIGHT,
    TITLE_MIN_HEIGHT: TITLE_MIN_HEIGHT,
    STACK_MIN_WIDTH: STACK_MIN_WIDTH,
    STACK_MIN_HEIGHT: STACK_MIN_HEIGHT,
    titleFor: titleFor,
    layoutFor: layoutFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
