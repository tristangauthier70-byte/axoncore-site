/* ============================================================
   AXONCORE — Pricing Tier Switcher
   ============================================================ */
(function () {
  'use strict';

  // Canonical prices live in pricing-data.js (window.AXONCORE_PRICING),
  // loaded before this file. Don't redefine them here — that's the
  // duplication that let this file and roi.js drift apart.
  var TIER_DATA = window.AXONCORE_PRICING;

  // No business owner knows their monthly call *minutes* — they know
  // roughly how many *calls* they get. This is the same under-120 /
  // 120-250 / 250+ boundary already used in the pricing FAQ, in
  // router.js, and in api/chat.js's tier logic — keyed by minutes so
  // it drops straight into the existing tier lookup.
  var CALL_BANDS = { 300: 'under 120 calls/mo', 600: '120–250 calls/mo', 1200: '250+ calls/mo' };

  function applyTier(card, pkg, idx) {
    var tiers = TIER_DATA[pkg];
    var t     = tiers[idx];

    card.querySelector('.ax-tier__name').textContent = t.name;

    var monthlyEl  = card.querySelector('[data-tier-monthly]');
    var setupEl    = card.querySelector('[data-tier-setup]');
    var minsEl     = card.querySelector('[data-tier-mins-feature]');
    var perdayEl   = card.querySelector('[data-tier-perday]');
    var messagesEl = card.querySelector('[data-tier-messages-feature]');
    var tcoEl      = card.querySelector('[data-tier-tco]');

    if (t.enterprise) {
      card.querySelector('.ax-tier__mins').textContent = 'High-volume — agreed on call';

      if (monthlyEl) {
        monthlyEl.innerHTML = '<a href="/book-a-call.html" class="ax-tier__enterprise-cta">Book a call &#8594;</a>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl)    setupEl.innerHTML     = 'Setup &amp; pricing <span>tailored to your business</span>';
      if (minsEl)     minsEl.textContent     = 'Volume of minutes agreed on discovery call';
      if (perdayEl)   perdayEl.textContent   = '';
      if (messagesEl) messagesEl.textContent = 'Volume of chatbot messages agreed on discovery call';
      if (tcoEl)      tcoEl.textContent      = '36-month total: priced on your discovery call';
    } else {
      card.querySelector('.ax-tier__mins').textContent =
        (CALL_BANDS[t.minutes] || '') + ' · ' + t.minutes.toLocaleString() + ' min';

      if (monthlyEl) {
        monthlyEl.innerHTML = 'SGD $' + t.price.toLocaleString() + '<span class="ax-pricing__per">/month</span>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl) setupEl.innerHTML = 'SGD $' + t.setup.toLocaleString() + ' <span>one-time setup</span>';
      if (minsEl)  minsEl.textContent = t.minutes.toLocaleString() + ' call minutes / month included';

      if (perdayEl) {
        var perday = t.price / 30;
        var perdayStr = perday < 10 ? perday.toFixed(2) : Math.round(perday).toLocaleString();
        perdayEl.textContent = 'Less than SGD $' + perdayStr + ' / day';
      }

      if (messagesEl && t.messages) {
        messagesEl.textContent = t.messages.toLocaleString() + ' chatbot messages / month included';
      }

      if (tcoEl) {
        var tco = t.setup + (t.price * 36);
        tcoEl.textContent = '36-month total: SGD $' + tco.toLocaleString() + ' (setup + 36 × monthly)';
      }
    }

    card.querySelector('.ax-tier__btn--prev').disabled = (idx === 0);
    card.querySelector('.ax-tier__btn--next').disabled = (idx === tiers.length - 1);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ['a', 'b', 'c'].forEach(function (pkg) {
      var card = document.getElementById('ax-pkg-' + pkg);
      if (!card) return;

      // Index lives on the element itself, not a closure var, so an
      // outside caller (the pricing router) can move a card to a specific
      // tier via axSetTier() below without these buttons losing track of
      // where the card actually is.
      card.dataset.tierIdx = '0';
      applyTier(card, pkg, 0);

      card.querySelector('.ax-tier__btn--prev').addEventListener('click', function () {
        var idx = parseInt(card.dataset.tierIdx, 10);
        if (idx > 0) { idx--; card.dataset.tierIdx = idx; applyTier(card, pkg, idx); }
      });
      card.querySelector('.ax-tier__btn--next').addEventListener('click', function () {
        var idx = parseInt(card.dataset.tierIdx, 10);
        if (idx < TIER_DATA[pkg].length - 1) { idx++; card.dataset.tierIdx = idx; applyTier(card, pkg, idx); }
      });
    });

    // Called by router.js once a visitor answers both questions, so the
    // card they scroll down to already shows the tier that was just
    // recommended instead of always defaulting to Lite.
    window.axSetTier = function (pkg, idx) {
      var card = document.getElementById('ax-pkg-' + pkg);
      if (!card || !TIER_DATA[pkg]) return;
      idx = Math.max(0, Math.min(idx, TIER_DATA[pkg].length - 1));
      card.dataset.tierIdx = idx;
      applyTier(card, pkg, idx);
    };
  });
})();
