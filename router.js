/* ============================================================
   AXONCORE — Two-Question Pricing Router
   ============================================================
   Riley qualifies a caller in two questions (channel, then call
   volume) before recommending a package — see riley-dialogue-spec.md.
   The website asked visitors nothing and made them self-diagnose
   from three feature-list cards. This is the same two questions,
   on the page that actually needs them.

   Uses the same volume bands as api/chat.js's tier logic (under 120
   -> Lite, 120-249 -> Standard, 250+ -> Pro) — as discrete buttons,
   not a live boundary calculation, which is the class of bug that
   comment in api/chat.js specifically warns about. Reads prices from
   pricing-data.js (window.AXONCORE_PRICING), loaded before this file.
   ============================================================ */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('ax-router');
    if (!root || !window.AXONCORE_PRICING) return;

    var step1    = root.querySelector('[data-step="1"]');
    var step2    = root.querySelector('[data-step="2"]');
    var resultEl = document.getElementById('ax-router-result');
    var chosenPkg = null;

    function selectOpt(group, btn) {
      group.querySelectorAll('.ax-router__opt').forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
    }

    step1.querySelectorAll('.ax-router__opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectOpt(step1, btn);
        chosenPkg = btn.dataset.pkg;
        step2.hidden = false;
        // Re-answering question 1 should re-open question 2 fresh rather
        // than leave a stale result from a previous package showing.
        resultEl.hidden = true;
        step2.querySelectorAll('.ax-router__opt').forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });
        step2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    step2.querySelectorAll('.ax-router__opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectOpt(step2, btn);
        showResult(chosenPkg, parseInt(btn.dataset.tier, 10));
      });
    });

    function showResult(pkg, tierIdx) {
      var tier = window.AXONCORE_PRICING[pkg][tierIdx];
      var name = window.AXONCORE_PACKAGE_NAMES[pkg];
      var msgPart = tier.messages
        ? (' and ' + tier.messages.toLocaleString() + ' chatbot messages')
        : '';

      resultEl.innerHTML =
        '<p class="ax-router__result-pkg">' + name + ' &middot; ' + tier.name + ' tier</p>' +
        '<p class="ax-router__result-detail">SGD $' + tier.setup.toLocaleString() + ' setup + SGD $' +
          tier.price.toLocaleString() + '/month &middot; ' + tier.minutes.toLocaleString() +
          ' call minutes' + msgPart + ' included &middot; 36-month agreement</p>' +
        '<div class="ax-router__result-actions">' +
          '<button type="button" class="ax-router__result-view" id="ax-router-view">See the full card &darr;</button>' +
          '<a href="/book-a-call.html?pkg=' + pkg + '&amp;tier=' + tier.name.toLowerCase() +
            '" class="ax-router__result-book">Book a call &rarr;</a>' +
        '</div>';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      document.getElementById('ax-router-view').addEventListener('click', function () {
        if (window.axSetTier) window.axSetTier(pkg, tierIdx);
        var card = document.getElementById('ax-pkg-' + pkg);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('ax-pricing__card--flash');
        void card.offsetWidth; /* restart the animation on repeat clicks */
        card.classList.add('ax-pricing__card--flash');
      });
    }
  });
})();
