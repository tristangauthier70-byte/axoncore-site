/* ============================================================
   AXONCORE — Pricing Tier Switcher
   ============================================================ */
(function () {
  'use strict';

  // Canonical prices live in pricing-data.js (window.AXONCORE_PRICING),
  // loaded before this file. Don't redefine them here — that's the
  // duplication that let this file and roi.js drift apart.
  var TIER_DATA = window.AXONCORE_PRICING;

  function applyTier(card, pkg, idx) {
    var tiers = TIER_DATA[pkg];
    var t     = tiers[idx];

    card.querySelector('.ax-tier__name').textContent = t.name;

    var monthlyEl  = card.querySelector('[data-tier-monthly]');
    var setupEl    = card.querySelector('[data-tier-setup]');
    var minsEl     = card.querySelector('[data-tier-mins-feature]');
    var perdayEl   = card.querySelector('[data-tier-perday]');
    var messagesEl = card.querySelector('[data-tier-messages-feature]');

    if (t.enterprise) {
      card.querySelector('.ax-tier__mins').textContent = 'High-volume — agreed on call';

      if (monthlyEl) {
        monthlyEl.innerHTML = '<a href="#ax-contact" class="ax-tier__enterprise-cta">Book a call &#8594;</a>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl)    setupEl.innerHTML     = 'Setup &amp; pricing <span>tailored to your business</span>';
      if (minsEl)     minsEl.textContent     = 'Volume of minutes agreed on discovery call';
      if (perdayEl)   perdayEl.textContent   = '';
      if (messagesEl) messagesEl.textContent = 'Volume of chatbot messages agreed on discovery call';
    } else {
      card.querySelector('.ax-tier__mins').textContent = t.minutes.toLocaleString() + ' min/mo';

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
    }

    card.querySelector('.ax-tier__btn--prev').disabled = (idx === 0);
    card.querySelector('.ax-tier__btn--next').disabled = (idx === tiers.length - 1);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ['a', 'b', 'c'].forEach(function (pkg) {
      var card = document.getElementById('ax-pkg-' + pkg);
      if (!card) return;

      var idx = 0;
      applyTier(card, pkg, idx);

      card.querySelector('.ax-tier__btn--prev').addEventListener('click', function () {
        if (idx > 0) { idx--; applyTier(card, pkg, idx); }
      });
      card.querySelector('.ax-tier__btn--next').addEventListener('click', function () {
        if (idx < TIER_DATA[pkg].length - 1) { idx++; applyTier(card, pkg, idx); }
      });
    });
  });
})();
