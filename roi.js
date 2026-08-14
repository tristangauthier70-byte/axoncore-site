/* ============================================================
   AXONCORE — ROI Calculator
   Data sources (not shown on site):
   - BIA/Kelsey: 62% of small business calls go unanswered every day
   - HBR / MIT / InsideSales: 21x conversion lift for <5min response
   - Velocify: 78% buy from first responder
   - Drift 2022: AI resolves 90-94% of queries
   - JMIR 2016: Automated reminders reduce no-shows by 29%
   - HubSpot 2023: avg service biz lead-to-booking = 28%
   - Acuity/Calendly: 35% of bookings attempted outside hours
   ============================================================ */

(function () {
  'use strict';

  /* ── Response-time → current lead capture rate ── */
  var CAPTURE_RATES = {
    '1hr':      0.60,
    '4hr':      0.40,
    'sameday':  0.24,
    'nextday':  0.11
  };

  /* ── Fixed model constants ── */
  var AXONCORE_CAPTURE   = 0.94;
  var CONV_RATE_CURRENT  = 0.28;
  var CONV_RATE_AXONCORE = 0.33;
  var NOSHOW_CURRENT     = 0.15;
  var NOSHOW_REDUCTION   = 0.29;
  var NOSHOW_AXONCORE    = NOSHOW_CURRENT * (1 - NOSHOW_REDUCTION);

  /* ── State ── */
  var enquiries = 600;
  var avgValue  = 300;
  var respTime  = '4hr';
  var channels  = { voice: true, chat: true, social: false }; // matches the checked defaults in results.html

  // Relative per-channel traffic weights, used to split the single
  // "monthly enquiries" number across whichever channels are checked.
  // These are NOT percentages and don't need to sum to 100 — only their
  // ratio to each other matters (see estimatedVolume below). Default
  // 50/50 until the visitor says otherwise, either by picking an
  // industry (data-channels implies an even split across that
  // industry's typical channels) or by dragging the split sliders.
  var channelWeights = { voice: 50, chat: 50, social: 50 };
  var CHANNEL_LABELS = { voice: 'Phone', chat: 'Website', social: 'WhatsApp' };
  var MODULE_SHORT   = { voice: 'Voice', chat: 'Engage', social: 'Connect' };

  /* ── Module data ──
     Sourced from pricing-data.js (window.AXONCORE_MODULES) and
     bundle-pricing.js (window.computeBundlePrice), both loaded before
     this file. Unlike the old single-package model, the calculator now
     recommends one tier PER selected channel, then prices the whole
     combination through the same discount function the pricing page
     and router use — so this box can never disagree with what
     pricing.html would actually charge for the same selection. */
  function selectedChannels() {
    return Object.keys(channels).filter(function (k) { return channels[k]; });
  }

  // Picks the cheapest tier whose allowance covers the estimated volume
  // for that module, falling back to the largest paid tier if volume
  // exceeds every cap (Enterprise is never auto-recommended here).
  function tierIndexForVolume(moduleKey, volume) {
    var tiers = window.AXONCORE_MODULES[moduleKey].tiers;
    for (var i = 0; i < tiers.length; i++) {
      if (tiers[i].enterprise) return Math.max(0, i - 1);
      var cap = tiers[i].minutes || tiers[i].messages;
      if (volume <= cap) return i;
    }
    return tiers.length - 2;
  }

  // The calculator only collects one aggregate "enquiries" number, not a
  // per-channel breakdown, so each selected channel's volume is a SHARE
  // of that number, weighted by channelWeights — not the full number
  // applied to every channel independently (that was a real bug: with
  // 600 combined enquiries across Voice + WhatsApp, the old version
  // estimated 600 calls AND 600 WhatsApp messages, effectively double-
  // counting the same enquiries and over-recommending tiers). Voice:
  // ~2.5 min/call, the same average used in Pricing & Packages and in
  // tier.js's band labels. Engage/Connect: a real chat or WhatsApp exchange
  // is several messages, not one — 5 messages/enquiry is a deliberately
  // simple, documented estimate, not a measured rate.
  function estimatedVolume(moduleKey) {
    var chans = selectedChannels();
    var totalWeight = chans.reduce(function (s, k) { return s + (channelWeights[k] || 50); }, 0) || 1;
    var share = (channelWeights[moduleKey] || 50) / totalWeight;
    var moduleEnquiries = enquiries * share;
    return moduleKey === 'voice' ? moduleEnquiries * 2.5 : moduleEnquiries * 5;
  }

  function recommendedSelections() {
    return selectedChannels().map(function (key) {
      return { module: key, tierIdx: tierIndexForVolume(key, estimatedVolume(key)) };
    });
  }

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', function () {
    var roiSection = document.getElementById('ax-roi');
    if (!roiSection) return;

    var sliderEnq = document.getElementById('ax-roi-enquiries');
    var sliderVal = document.getElementById('ax-roi-value');
    var valEnq    = document.getElementById('ax-roi-enq-val');
    var valAmt    = document.getElementById('ax-roi-amt-val');

    if (!sliderEnq || !sliderVal) return;

    /* Slider: enquiries */
    sliderEnq.addEventListener('input', function () {
      enquiries = parseInt(this.value);
      valEnq.textContent = enquiries;
      recalculate();
    });

    /* Slider: avg value */
    sliderVal.addEventListener('input', function () {
      avgValue = parseInt(this.value);
      valAmt.textContent = '$' + avgValue.toLocaleString();
      recalculate();
    });

    /* Response time buttons (real <button>s, not checkboxes — single-select) */
    var timeBtns = document.querySelectorAll('.ax-roi__resp-grid:not(#ax-roi-channels) .ax-roi__resp-btn');
    timeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        timeBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        respTime = this.dataset.time;
        recalculate();
      });
    });

    /* Channel-split sliders — only shown when 2+ channels are checked.
       Relative weights (not percentages), normalized inside
       estimatedVolume(). Rebuilt from scratch whenever the checked-
       channel set changes, so it always shows exactly the channels
       currently in play. */
    var splitField = document.getElementById('ax-roi-split-field');
    var splitRows  = document.getElementById('ax-roi-split-rows');
    function renderSplitRows() {
      if (!splitField || !splitRows) return;
      var chans = selectedChannels();
      if (chans.length < 2) { splitField.style.display = 'none'; return; }
      splitField.style.display = '';
      splitRows.innerHTML = '';
      chans.forEach(function (key) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
        var label = document.createElement('span');
        label.style.cssText = 'width:84px;font-size:0.85rem;color:var(--ax-muted);flex-shrink:0;';
        label.textContent = CHANNEL_LABELS[key] || key;
        var input = document.createElement('input');
        input.type = 'range';
        input.min = 10; input.max = 100; input.step = 5;
        input.value = channelWeights[key] || 50;
        input.className = 'ax-roi__slider';
        input.style.flex = '1';
        input.addEventListener('input', function () {
          channelWeights[key] = parseInt(this.value);
          recalculate();
        });
        row.appendChild(label);
        row.appendChild(input);
        splitRows.appendChild(row);
      });
    }

    /* Channel-mix checkboxes — which modules the calculator recommends */
    var channelInputs = document.querySelectorAll('#ax-roi-channels input[type="checkbox"]');
    channelInputs.forEach(function (cb) {
      cb.addEventListener('change', function () {
        channels[cb.dataset.channel] = cb.checked;
        cb.closest('.ax-roi__resp-btn').classList.toggle('active', cb.checked);
        renderSplitRows();
        recalculate();
      });
    });

    /* Industry selector buttons — also applies that industry's typical
       channel mix (data-channels), so picking a sector shows visitors
       the stack businesses like theirs actually run, not just their
       own current voice/chat defaults. Channel checkboxes stay fully
       editable afterward — this is a starting recommendation, not a
       lock. */
    var industryTypicalEl = document.getElementById('ax-roi-industry-typical');
    function applyTypicalChannels(btn) {
      if (!btn.dataset.channels) return;
      var typical = btn.dataset.channels.split(',');
      channelInputs.forEach(function (cb) {
        var isTypical = typical.indexOf(cb.dataset.channel) !== -1;
        cb.checked = isTypical;
        channels[cb.dataset.channel] = isTypical;
        cb.closest('.ax-roi__resp-btn').classList.toggle('active', isTypical);
      });
      // Reset to an even split whenever the industry (and so the typical
      // channel set) changes — any custom split from a previous industry
      // no longer applies to a different channel combination.
      typical.forEach(function (k) { channelWeights[k] = 50; });
    }

    function updateIndustryTypical(btn) {
      if (!industryTypicalEl || !btn || !btn.dataset.channels) return;
      var labelSpan = btn.querySelector('span');
      var industryName = labelSpan ? labelSpan.textContent : 'this industry';
      var stack = btn.dataset.channels.split(',').map(function (k) {
        return MODULE_SHORT[k] || k;
      }).join(' + ');
      industryTypicalEl.textContent = 'Typical stack for ' + industryName + ': ' + stack + ' — pre-filled below, adjust anytime.';
    }

    var industryBtns = document.querySelectorAll('.ax-roi__industry-btn');
    industryBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        industryBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');

        var enq = parseInt(this.dataset.enq);
        var val = parseInt(this.dataset.val);

        enquiries = enq;
        avgValue  = val;

        if (sliderEnq) sliderEnq.value = enq;
        if (sliderVal) sliderVal.value = val;
        if (valEnq) valEnq.textContent = enq;
        if (valAmt) valAmt.textContent = '$' + val.toLocaleString();

        applyTypicalChannels(this);
        updateIndustryTypical(this);
        renderSplitRows();
        recalculate();
      });
    });

    /* Initial calculation — align channel checkboxes with whichever
       industry button ships marked active in the HTML (currently
       Medical/Dental) before the first render, so the recommendation
       box is correct from the very first paint, not just after a click. */
    var initialIndustryBtn = document.querySelector('.ax-roi__industry-btn.active');
    if (initialIndustryBtn) {
      applyTypicalChannels(initialIndustryBtn);
      updateIndustryTypical(initialIndustryBtn);
    }
    renderSplitRows();
    recalculate();

    /* Animate in when visible */
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          recalculate();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    observer.observe(roiSection);
  });

  /* ── Core calculation ── */
  function calculate(enq, val, time) {
    var captureNow = CAPTURE_RATES[time] || 0.40;

    var capturedNow    = enq * captureNow;
    var bookingsNow    = capturedNow * CONV_RATE_CURRENT;
    var noshowsNow     = bookingsNow * NOSHOW_CURRENT;
    var actualNow      = (bookingsNow - noshowsNow) * val;
    var missedLeads    = Math.round(enq - capturedNow);

    var capturedAx     = enq * AXONCORE_CAPTURE;
    var bookingsAx     = capturedAx * CONV_RATE_AXONCORE;
    var noshowsAx      = bookingsAx * NOSHOW_AXONCORE;
    var actualAx       = (bookingsAx - noshowsAx) * val;

    var monthlyUplift  = actualAx - actualNow;
    var annualUplift   = monthlyUplift * 12;

    // Recommend a module combination first, then cost everything below
    // against THAT combination's real bundled price — not a flat,
    // made-up monthly figure. This is also what updateRecommendation()
    // below displays, so the headline numbers and the recommendation
    // box can no longer disagree with each other, and can never disagree
    // with what pricing.html would charge for the same selection, since
    // both go through the same computeBundlePrice().
    var selections = recommendedSelections();
    var bundle = selections.length ? window.computeBundlePrice(selections, 0.20) : null;

    var annualCost, roiMultiple, paybackDays;
    if (!bundle || bundle.enterprise) {
      annualCost = null;
      roiMultiple = null;
      paybackDays = null;
    } else {
      annualCost  = bundle.monthlyTotal * 12 + bundle.setupTotal;
      roiMultiple = annualCost > 0 ? annualUplift / annualCost : 0;
      paybackDays = monthlyUplift > 0
        ? Math.ceil((bundle.setupTotal + bundle.monthlyTotal) / monthlyUplift * 30)
        : Infinity;
    }

    var afterHoursLeads   = Math.round(enq * 0.35);
    var afterHoursMissed  = Math.round(afterHoursLeads * (1 - captureNow));
    var afterHoursRevenue = afterHoursMissed * CONV_RATE_CURRENT * val;

    return {
      missedLeads:        missedLeads,
      currentMonthly:     Math.round(actualNow),
      axonMonthly:        Math.round(actualAx),
      monthlyUplift:      Math.round(monthlyUplift),
      annualUplift:       Math.round(annualUplift),
      roiMultiple:        roiMultiple,
      paybackDays:        paybackDays,
      afterHoursRevenue:  Math.round(afterHoursRevenue),
      captureNow:         Math.round(captureNow * 100),
      bookingsNow:        Math.round(bookingsNow),
      bookingsAx:         Math.round(bookingsAx),
      capturePercent:     Math.round(AXONCORE_CAPTURE * 100),
      bundle:             bundle
    };
  }

  /* ── Update recommendation callout ── */
  function updateRecommendation(r) {
    var recEl    = document.getElementById('ax-roi-rec');
    var nameEl   = document.getElementById('ax-roi-rec-name');
    var detailEl = document.getElementById('ax-roi-rec-detail');
    if (!recEl || !nameEl || !detailEl) return;

    if (!r.bundle || !r.bundle.lines || !r.bundle.lines.length) {
      nameEl.textContent   = 'Select a channel above';
      detailEl.textContent = 'Check at least one of Phone / Website / WhatsApp to see a recommendation.';
      recEl.classList.add('ax-roi__rec--visible');
      return;
    }

    if (r.bundle.enterprise) {
      nameEl.textContent   = 'Custom / Enterprise';
      detailEl.textContent = 'Priced on a discovery call for your volume.';
      recEl.classList.add('ax-roi__rec--visible');
      return;
    }

    // r.paybackDays comes from calculate() — same number as the stats
    // grid above. Don't recompute it here; that's how this and the
    // headline figure drifted apart from each other in the past.
    var paybackStr = (r.paybackDays > 0 && r.paybackDays < 730) ? r.paybackDays + '-day payback' : 'strong ROI';

    var nameParts = r.bundle.lines.map(function (l) {
      var shortName = window.AXONCORE_MODULES[l.module].label.split(' — ')[0];
      return shortName + ' (' + l.tier.name + ')';
    });

    nameEl.textContent   = nameParts.join(' + ');
    detailEl.textContent = 'SGD $' + r.bundle.setupTotal.toLocaleString() + ' setup · SGD $' + r.bundle.monthlyTotal.toLocaleString() + '/month · est. ' + paybackStr;

    recEl.classList.add('ax-roi__rec--visible');
  }

  /* ── Update DOM ── */
  function recalculate() {
    var r = calculate(enquiries, avgValue, respTime);

    animateValue('ax-roi-missed-leads',    r.missedLeads,       0,   '', '');
    animateValue('ax-roi-current-rev',     r.currentMonthly,    0,   '$', '');
    animateValue('ax-roi-axon-rev',        r.axonMonthly,       0,   '$', '');
    animateValue('ax-roi-monthly-uplift',  r.monthlyUplift,     0,   '+$', '');
    animateValue('ax-roi-annual-uplift',   r.annualUplift,      0,   '+$', '');
    animateValue('ax-roi-roi-multiple',    r.roiMultiple || 0,  1,   '', 'x');
    animateValue('ax-roi-payback',         isFinite(r.paybackDays) ? r.paybackDays : 0, 0, '', ' days');
    animateValue('ax-roi-afterhours',      r.afterHoursRevenue, 0,   '$', '');
    animateValue('ax-roi-capture-now',     r.captureNow,        0,   '', '%');
    animateValue('ax-roi-bookings-now',    r.bookingsNow,       0,   '', '');
    animateValue('ax-roi-bookings-now-b',  r.bookingsNow,       0,   '', '');
    animateValue('ax-roi-bookings-ax',     r.bookingsAx,        0,   '', '');

    /* Progress bars */
    var barEl   = document.getElementById('ax-roi-bar-now-vis');
    var barAxEl = document.getElementById('ax-roi-bar-ax');
    if (barEl && barAxEl) {
      var maxRev = r.axonMonthly || 1;
      barEl.style.width   = Math.min(100, (r.currentMonthly / maxRev) * 100) + '%';
      barAxEl.style.width = '100%';
    }

    var capEl = document.getElementById('ax-roi-bar-now');
    if (capEl) capEl.style.width = r.captureNow + '%';

    var roiEl = document.getElementById('ax-roi-roi-multiple');
    if (roiEl && r.roiMultiple != null) {
      roiEl.style.color = r.roiMultiple >= 3 ? '#4ade80' : r.roiMultiple >= 1.5 ? '#6D4FD1' : '#facc15';
    }

    var paybackEl = document.getElementById('ax-roi-payback');
    if (paybackEl && isFinite(r.paybackDays)) {
      paybackEl.style.color = r.paybackDays <= 60 ? '#4ade80' : r.paybackDays <= 120 ? '#6D4FD1' : '#facc15';
    }

    updateRecommendation(r);
  }

  /* ── Animated counter ── */
  var animations = {};

  function animateValue(id, target, decimals, prefix, suffix) {
    var el = document.getElementById(id);
    if (!el) return;

    if (animations[id]) cancelAnimationFrame(animations[id]);

    var start     = parseFloat(el.dataset.current || '0') || 0;
    var duration  = 600;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased    = 1 - Math.pow(1 - progress, 3);
      var current  = start + (target - start) * eased;

      var display = decimals > 0 ? current.toFixed(decimals) : Math.round(current).toLocaleString();
      el.textContent  = prefix + display + suffix;
      el.dataset.current = current;

      if (progress < 1) {
        animations[id] = requestAnimationFrame(step);
      } else {
        el.dataset.current = target;
      }
    }

    animations[id] = requestAnimationFrame(step);
  }

})();
