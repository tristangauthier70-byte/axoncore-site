/* ============================================================
   AXONCORE — Pricing Tier Switcher
   Lite (300 min) <-> Standard (1,000) <-> Growth (2,000) <-> Heavy (3,000)
   ============================================================ */
(function () {
  'use strict';

  var TIER_DATA = {
    a: [
      { name: 'Lite',     minutes: 300,  price: 135,  setup: 390,  overage: '0.40' },
      { name: 'Standard', minutes: 1000, price: 410,  setup: 390,  overage: '0.40' },
      { name: 'Growth',   minutes: 2000, price: 805,  setup: 390,  overage: '0.40' },
      { name: 'Heavy',    minutes: 3000, price: 1200, setup: 390,  overage: '0.40' }
    ],
    b: [
      { name: 'Lite',     minutes: 300,  price: 335,  setup: 700,  overage: '0.40' },
      { name: 'Standard', minutes: 1000, price: 775,  setup: 700,  overage: '0.40' },
      { name: 'Growth',   minutes: 2000, price: 1405, setup: 700,  overage: '0.40' },
      { name: 'Heavy',    minutes: 3000, price: 2040, setup: 700,  overage: '0.40' }
    ],
    c: [
      { name: 'Lite',     minutes: 300,  price: 840,  setup: 990,  overage: '0.40' },
      { name: 'Standard', minutes: 1000, price: 1280, setup: 990,  overage: '0.40' },
      { name: 'Growth',   minutes: 2000, price: 1915, setup: 990,  overage: '0.40' },
      { name: 'Heavy',    minutes: 3000, price: 2545, setup: 990,  overage: '0.40' }
    ]
  };

  function applyTier(card, pkg, idx) {
    var tiers = TIER_DATA[pkg];
    var t     = tiers[idx];

    card.querySelector('.ax-tier__name').textContent = t.name;
    card.querySelector('.ax-tier__mins').textContent = t.minutes.toLocaleString() + ' min/mo';

    var monthlyEl = card.querySelector('[data-tier-monthly]');
    var setupEl   = card.querySelector('[data-tier-setup]');
    var overageEl = card.querySelector('[data-tier-overage]');
    var minsEl    = card.querySelector('[data-tier-mins-feature]');

    if (monthlyEl) {
      monthlyEl.innerHTML = 'SGD $' + t.price.toLocaleString() + '<span class="ax-pricing__per">/month</span>';
      monthlyEl.classList.remove('ax-tier-flash');
      void monthlyEl.offsetWidth;
      monthlyEl.classList.add('ax-tier-flash');
    }
    if (setupEl)   setupEl.innerHTML = 'SGD $' + t.setup.toLocaleString() + ' <span>one-time setup</span>';
    if (overageEl) overageEl.textContent = 'Overage: SGD $' + t.overage + '/min';
    if (minsEl)    minsEl.textContent = t.minutes.toLocaleString() + ' call minutes / month included';

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
