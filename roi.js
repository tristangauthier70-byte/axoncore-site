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
  var AXONCORE_MONTHLY_COST = 1500;

  /* ── Package data ── */
  var PACKAGES = {
    A: { name: 'Package A — Frontline Reception',    setup: 4000,  monthly: 1500 },
    B: { name: 'Package B — Conversion System',      setup: 7000,  monthly: 2000 },
    C: { name: 'Package C — OmniChannel Front Desk', setup: 10000, monthly: 2500 }
  };

  /* ── State ── */
  var enquiries = 600;
  var avgValue  = 300;
  var respTime  = '4hr';

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', function () {
    var roiSection = document.getElementById('ax-roi');
    if (!roiSection) return;

    var sliderEnq = document.getElementById('ax-roi-enquiries');
    var sliderVal = document.getElementById('ax-roi-value');
    var respBtns  = document.querySelectorAll('.ax-roi__resp-btn');
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

    /* Response time buttons */
    respBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        respBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        respTime = this.dataset.time;
        recalculate();
      });
    });

    /* Industry selector buttons */
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

        recalculate();
      });
    });

    /* Initial calculation with medical defaults (slider already set to 600/300 in HTML) */
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
    var annualCost     = AXONCORE_MONTHLY_COST * 12;
    var roiMultiple    = annualUplift / annualCost;
    var paybackDays    = Math.ceil(annualCost / monthlyUplift * 30);

    var afterHoursLeads   = Math.round(enq * 0.35);
    var afterHoursMissed  = Math.round(afterHoursLeads * (1 - captureNow));
    var afterHoursRevenue = afterHoursMissed * CONV_RATE_CURRENT * val;

    return {
      missedLeads:       missedLeads,
      currentMonthly:    Math.round(actualNow),
      axonMonthly:       Math.round(actualAx),
      monthlyUplift:     Math.round(monthlyUplift),
      annualUplift:      Math.round(annualUplift),
      roiMultiple:       roiMultiple,
      paybackDays:       paybackDays,
      afterHoursRevenue: Math.round(afterHoursRevenue),
      captureNow:        Math.round(captureNow * 100),
      bookingsNow:       Math.round(bookingsNow),
      bookingsAx:        Math.round(bookingsAx),
      capturePercent:    Math.round(AXONCORE_CAPTURE * 100)
    };
  }

  /* ── Package recommendation ── */
  function recommendPackage(r) {
    if (respTime === 'nextday' || r.monthlyUplift > 12000) return 'C';
    if (r.monthlyUplift > 5000) return 'B';
    return 'A';
  }

  /* ── Update recommendation callout ── */
  function updateRecommendation(r) {
    var recEl    = document.getElementById('ax-roi-rec');
    var nameEl   = document.getElementById('ax-roi-rec-name');
    var detailEl = document.getElementById('ax-roi-rec-detail');
    if (!recEl || !nameEl || !detailEl) return;

    var key = recommendPackage(r);
    var pkg = PACKAGES[key];

    var payback = Math.ceil((pkg.setup + pkg.monthly) / r.monthlyUplift * 30);
    var paybackStr = (payback > 0 && payback < 730) ? payback + '-day payback' : 'strong ROI';

    nameEl.textContent   = pkg.name;
    detailEl.textContent = 'SGD $' + pkg.setup.toLocaleString() + ' setup · SGD $' + pkg.monthly.toLocaleString() + '/month · est. ' + paybackStr;

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
    animateValue('ax-roi-roi-multiple',    r.roiMultiple,       1,   '', 'x');
    animateValue('ax-roi-payback',         r.paybackDays,       0,   '', ' days');
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
    if (roiEl) {
      roiEl.style.color = r.roiMultiple >= 3 ? '#4ade80' : r.roiMultiple >= 1.5 ? '#A78BFA' : '#facc15';
    }

    var paybackEl = document.getElementById('ax-roi-payback');
    if (paybackEl) {
      paybackEl.style.color = r.paybackDays <= 60 ? '#4ade80' : r.paybackDays <= 120 ? '#A78BFA' : 'white';
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
