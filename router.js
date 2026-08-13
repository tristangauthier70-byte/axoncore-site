/* ============================================================
   AXONCORE — Module Picker + Live Bundle Total
   ============================================================
   Voice, Chat and Social are three independent modules, each
   with its own tier a visitor can step through — unlike the old
   package model, a single "which package" question can't
   determine a whole bundle's price anymore, since e.g. Voice
   Pro + Chat Lite needs two independently-chosen tiers.

   Checkboxes (not radios) show/hide each module's pricing card;
   the tier steppers on those cards already exist (tier.js) and
   are reused as-is here rather than re-implemented. Every change
   — a checkbox toggling, or a tier stepper click on a visible
   card (tier.js dispatches 'ax-tier-change' for both) — recomputes
   the bundle total via computeBundlePrice(), so this bar can never
   show a number the pricing cards below it don't agree with.

   Reads from pricing-data.js (window.AXONCORE_MODULES) and
   bundle-pricing.js (window.computeBundlePrice), both loaded
   before this file.
   ============================================================ */
(function () {
  'use strict';

  var DISCOUNT = 0.20;

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('ax-router');
    if (!root || !window.AXONCORE_MODULES || !window.computeBundlePrice) return;

    var checks = root.querySelectorAll('.ax-router__check input[type="checkbox"]');
    var bar    = document.getElementById('ax-router-bundle-bar');
    if (!checks.length || !bar) return;

    function selectedModules() {
      var selected = [];
      checks.forEach(function (cb) {
        if (cb.checked) selected.push(cb.dataset.module);
      });
      return selected;
    }

    function cardFor(key) {
      return document.getElementById('ax-pkg-' + key);
    }

    function updateCardVisibility() {
      var selected = selectedModules();
      Object.keys(window.AXONCORE_MODULES).forEach(function (key) {
        var card = cardFor(key);
        if (card) card.hidden = (selected.indexOf(key) === -1);
      });
    }

    function updateBundleBar() {
      var selected = selectedModules();

      if (selected.length === 0) {
        bar.innerHTML = '<p class="ax-router__bundle-total">Select at least one channel above to see pricing.</p>';
        return;
      }

      var selections = selected.map(function (key) {
        var card = cardFor(key);
        var idx  = card ? parseInt(card.dataset.tierIdx || '0', 10) : 0;
        return { module: key, tierIdx: idx };
      });

      var result = window.computeBundlePrice(selections, DISCOUNT);

      if (result.enterprise) {
        bar.innerHTML = '<p class="ax-router__bundle-total">Custom pricing for this combination — <a href="/book-a-call.html" class="ax-router__result-book">book a call &rarr;</a></p>';
        return;
      }

      var lineHtml = result.lines.map(function (l) {
        var shortName = window.AXONCORE_MODULES[l.module].label.split(' — ')[0];
        var priceStr  = 'SGD $' + l.finalPrice.toLocaleString() + '/mo';
        if (l.discounted) priceStr += ' <span class="ax-router__bundle-discount">20% off</span>';
        return '<span class="ax-router__bundle-line"><strong>' + shortName + '</strong> ' + priceStr + '</span>';
      }).join('');

      bar.innerHTML =
        '<div class="ax-router__bundle-lines">' + lineHtml + '</div>' +
        '<p class="ax-router__bundle-total">SGD $' + result.monthlyTotal.toLocaleString() +
          '<span class="ax-pricing__per">/month</span> &nbsp;+&nbsp; SGD $' + result.setupTotal.toLocaleString() + ' setup</p>' +
        '<a href="/book-a-call.html" class="ax-router__result-book">Book a call &rarr;</a>';
    }

    function flashVisibleCards() {
      selectedModules().forEach(function (key) {
        var card = cardFor(key);
        if (!card) return;
        card.classList.remove('ax-pricing__card--flash');
        void card.offsetWidth; /* restart the animation on repeat toggles */
        card.classList.add('ax-pricing__card--flash');
      });
    }

    checks.forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.closest('.ax-router__check').classList.toggle('is-active', cb.checked);

        updateCardVisibility();
        updateBundleBar();
        flashVisibleCards();

        if (cb.checked) {
          var card = cardFor(cb.dataset.module);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });

    // tier.js fires this on every stepper click, and once per card on
    // page load — recalculating here means the bar always matches
    // whatever tier a visible card is actually showing, without this
    // file needing to know anything about tier.js's button markup.
    document.addEventListener('ax-tier-change', function () {
      updateBundleBar();
    });

    // All three modules start checked to match the site's existing
    // "show everything" default — unchecking narrows the bundle rather
    // than starting from an empty page.
    updateCardVisibility();
    updateBundleBar();
  });
})();
