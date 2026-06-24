/* ============================================================
   AXONCORE — Pricing Tier Switcher
   ============================================================ */
(function () {
  'use strict';

  var TIER_DATA = {
    a: [
      { name: 'Lite',       minutes: 300,  price: 145,  setup: 599  },
      { name: 'Standard',   minutes: 600,  price: 250,  setup: 599  },
      { name: 'Pro',        minutes: 1200, price: 450,  setup: 599  },
      { name: 'Enterprise', enterprise: true }
    ],
    b: [
      { name: 'Lite',       minutes: 300,  price: 600,  setup: 999  },
      { name: 'Standard',   minutes: 600,  price: 705,  setup: 999  },
      { name: 'Pro',        minutes: 1200, price: 905,  setup: 999  },
      { name: 'Enterprise', enterprise: true }
    ],
    c: [
      { name: 'Lite',       minutes: 300,  price: 899,  setup: 1399 },
      { name: 'Standard',   minutes: 600,  price: 1199, setup: 1399 },
      { name: 'Pro',        minutes: 1200, price: 1399, setup: 1399 },
      { name: 'Enterprise', enterprise: true }
    ]
  };

  function applyTier(card, pkg, idx) {
    var tiers = TIER_DATA[pkg];
    var t     = tiers[idx];

    card.querySelector('.ax-tier__name').textContent = t.name;

    var monthlyEl = card.querySelector('[data-tier-monthly]');
    var setupEl   = card.querySelector('[data-tier-setup]');
    var minsEl    = card.querySelector('[data-tier-mins-feature]');
    var perdayEl  = card.querySelector('[data-tier-perday]');

    if (t.enterprise) {
      card.querySelector('.ax-tier__mins').textContent = 'High-volume — agreed on call';

      if (monthlyEl) {
        monthlyEl.innerHTML = '<a href="#ax-contact" class="ax-tier__enterprise-cta">Book a call &#8594;</a>';
        monthlyEl.classList.remove('ax-tier-flash');
        void monthlyEl.offsetWidth;
        monthlyEl.classList.add('ax-tier-flash');
      }
      if (setupEl)  setupEl.innerHTML  = 'Setup &amp; pricing <span>tailored to your business</span>';
      if (minsEl)   minsEl.textContent  = 'Volume of minutes agreed on discovery call';
      if (perdayEl) perdayEl.textContent = '';
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
