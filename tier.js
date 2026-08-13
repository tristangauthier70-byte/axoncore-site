/* ============================================================
   AXONCORE — Pricing Tier Switcher
   ============================================================ */
(function () {
  'use strict';

  // Canonical prices live in pricing-data.js (window.AXONCORE_MODULES),
  // loaded before this file. Don't redefine them here — that's the
  // duplication that let this file and roi.js drift apart in the past.
  var MODULE_DATA = window.AXONCORE_MODULES;

  function applyTier(card, key, idx) {
    var module = MODULE_DATA[key];
    var tiers  = module.tiers;
    var t      = tiers[idx];

    card.querySelector('.ax-tier__name').textContent = t.name;

    var monthlyEl  = card.querySelector('[data-tier-monthly]');
    var setupEl    = card.querySelector('[data-tier-setup]');
    var minsEl     = card.querySelector('[data-tier-mins-feature]');
    var perdayEl   = card.querySelector('[data-tier-perday]');
    var messagesEl = card.querySelector('[data-tier-messages-feature]');
    var tcoEl      = card.querySelector('[data-tier-tco]');
    var unitWord   = module.unit === 'minutes' ? 'call minutes' : 'messages';

    if (t.enterprise) {
      card.querySelector('.ax-tier__mins').textContent = 'High-volume — agreed on call';

      if (monthlyEl) {
        monthlyEl.innerHTML = '<a href="/book-a-call.html" class="ax-tier__enterprise-cta">Book a call &#8594;</a>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl)    setupEl.innerHTML     = 'Setup &amp; pricing <span>tailored to your business</span>';
      if (minsEl)     minsEl.textContent     = 'Volume of ' + unitWord + ' agreed on discovery call';
      if (perdayEl)   perdayEl.textContent   = '';
      if (messagesEl) messagesEl.textContent = 'Volume of messages agreed on discovery call';
      if (tcoEl)      tcoEl.textContent      = '36-month total: priced on your discovery call';
    } else {
      // Two-state field convention: a tier has EITHER t.minutes (Voice)
      // OR t.messages (Chat/Social), never both, never null. Guard each
      // read individually rather than assuming which one a given module
      // uses — this line previously called t.minutes.toLocaleString()
      // unconditionally, which threw the moment a messages-only tier
      // (Chat/Social) reached it.
      if (module.unit === 'minutes' && t.minutes) {
        card.querySelector('.ax-tier__mins').textContent =
          (t.band ? t.band + ' · ' : '') + t.minutes.toLocaleString() + ' min';
      } else if (t.messages) {
        card.querySelector('.ax-tier__mins').textContent = t.messages.toLocaleString() + ' msgs/mo';
      }

      if (monthlyEl) {
        monthlyEl.innerHTML = 'SGD $' + t.price.toLocaleString() + '<span class="ax-pricing__per">/month</span>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl) setupEl.innerHTML = 'SGD $' + t.setup.toLocaleString() + ' <span>one-time setup</span>';

      // Guarded the same way as messagesEl below — a Voice tier has no
      // t.messages, a Chat/Social tier has no t.minutes, so each feature
      // span only renders when its own module actually has that field.
      if (minsEl && t.minutes)     minsEl.textContent     = t.minutes.toLocaleString() + ' call minutes / month included';
      if (messagesEl && t.messages) messagesEl.textContent = t.messages.toLocaleString() + ' messages / month included';

      if (perdayEl) {
        var perday = t.price / 30;
        var perdayStr = perday < 10 ? perday.toFixed(2) : Math.round(perday).toLocaleString();
        perdayEl.textContent = 'Less than SGD $' + perdayStr + ' / day';
      }

      if (tcoEl) {
        var tco = t.setup + (t.price * 36);
        tcoEl.textContent = '36-month total: SGD $' + tco.toLocaleString() + ' (setup + 36 × monthly)';
      }
    }

    card.querySelector('.ax-tier__btn--prev').disabled = (idx === 0);
    card.querySelector('.ax-tier__btn--next').disabled = (idx === tiers.length - 1);

    // Fired on every tier change, including the initial boot call — the
    // bundle-total bar (router.js) and the ROI calculator (roi.js) both
    // listen for this instead of attaching their own click handlers to
    // these buttons, so they never fall out of sync with what a card is
    // actually showing.
    card.dispatchEvent(new CustomEvent('ax-tier-change', { bubbles: true, detail: { module: key, tierIdx: idx } }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    Object.keys(MODULE_DATA).forEach(function (key) {
      var card = document.getElementById('ax-pkg-' + key);
      if (!card) return;

      // Index lives on the element itself, not a closure var, so an
      // outside caller (the pricing router, the ROI calculator) can move
      // a card to a specific tier via axSetTier() below without these
      // buttons losing track of where the card actually is.
      card.dataset.tierIdx = '0';
      applyTier(card, key, 0);

      card.querySelector('.ax-tier__btn--prev').addEventListener('click', function () {
        var idx = parseInt(card.dataset.tierIdx, 10);
        if (idx > 0) { idx--; card.dataset.tierIdx = idx; applyTier(card, key, idx); }
      });
      card.querySelector('.ax-tier__btn--next').addEventListener('click', function () {
        var idx = parseInt(card.dataset.tierIdx, 10);
        if (idx < MODULE_DATA[key].tiers.length - 1) { idx++; card.dataset.tierIdx = idx; applyTier(card, key, idx); }
      });
    });

    // Called by router.js/roi.js once a visitor answers the qualification
    // questions, so the card(s) they scroll down to already show the
    // tier that was just recommended instead of always defaulting to
    // the cheapest tier.
    window.axSetTier = function (key, idx) {
      var card = document.getElementById('ax-pkg-' + key);
      if (!card || !MODULE_DATA[key]) return;
      idx = Math.max(0, Math.min(idx, MODULE_DATA[key].tiers.length - 1));
      card.dataset.tierIdx = idx;
      applyTier(card, key, idx);
    };
  });
})();
