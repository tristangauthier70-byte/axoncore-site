/* ============================================================
   AXONCORE — Bundle Discount Calculator
   ============================================================
   Pure function, no DOM access. Loaded after pricing-data.js,
   before tier.js / router.js / roi.js — all three call this
   instead of writing their own discount math, so the pricing
   page, the pricing router, and the ROI calculator can never
   disagree about what a given module combination costs.

   Rule (Tristan's, confirmed): the single most expensive module
   in the bundle stays full price; every other selected module
   gets 20% off its monthly fee. Setup fees are never discounted.
   A tie for the top spot means nothing gets discounted that
   combination — a direct, intentional consequence of "never
   discount the priciest item," not a bug.
   ============================================================ */
function computeBundlePrice(selections, discountPct) {
  // selections: [{module:'voice', tierIdx}, {module:'chat', tierIdx}, ...]
  var items = selections.map(function (sel) {
    return { module: sel.module, tierIdx: sel.tierIdx, tier: window.AXONCORE_MODULES[sel.module].tiers[sel.tierIdx] };
  });

  if (items.some(function (i) { return i.tier.enterprise; })) return { enterprise: true };
  if (items.length === 0) return { lines: [], monthlyTotal: 0, setupTotal: 0 };

  var maxPrice = Math.max.apply(null, items.map(function (i) { return i.tier.price; }));
  var lines = items.map(function (i) {
    var discounted = i.tier.price < maxPrice;
    var finalPrice = discounted ? Math.round(i.tier.price * (1 - discountPct)) : i.tier.price;
    return { module: i.module, tierIdx: i.tierIdx, tier: i.tier, discounted: discounted, finalPrice: finalPrice };
  });

  return {
    lines: lines,
    monthlyTotal: lines.reduce(function (s, l) { return s + l.finalPrice; }, 0),
    setupTotal: items.reduce(function (s, i) { return s + i.tier.setup; }, 0) // never discounted
  };
}

if (typeof window !== 'undefined') window.computeBundlePrice = computeBundlePrice;
