/* ============================================================
   AXONCORE — Canonical Pricing Data
   ============================================================
   Single source of truth for setup fees, monthly fees, minute
   allowances and chatbot-message allowances, across all three
   packages and their tiers.

   Loaded before tier.js (pricing.html) and roi.js (results.html).
   If a price changes, change it ONCE, here — never inside tier.js
   or roi.js directly.

   Two things this file does NOT reach, and which still have to be
   updated by hand when a price changes, because they're read by
   crawlers/servers that don't execute this script:
     1. The schema.org JSON-LD <script> blocks in pricing.html and
        index.html — AI/search crawlers read static HTML, not
        executed JS, so those numbers are necessarily duplicated.
     2. api/chat.js — Riley's own ground-truth pricing knowledge
        for the live chat/voice demo, evaluated server-side.
   Both carry a comment pointing back to this file. Grep this repo
   for "AXONCORE_PRICING" before you ship a price change to confirm
   every reference moved together.
   ============================================================ */
window.AXONCORE_PRICING = {
  a: [
    { name: 'Lite',       minutes: 300,  price: 145,  setup: 599  },
    { name: 'Standard',   minutes: 600,  price: 250,  setup: 599  },
    { name: 'Pro',        minutes: 1200, price: 450,  setup: 599  },
    { name: 'Enterprise', enterprise: true }
  ],
  b: [
    { name: 'Lite',       minutes: 300,  messages: 10000, price: 600,  setup: 999  },
    { name: 'Standard',   minutes: 600,  messages: 30000, price: 705,  setup: 999  },
    { name: 'Pro',        minutes: 1200, messages: 50000, price: 905,  setup: 999  },
    { name: 'Enterprise', enterprise: true }
  ],
  c: [
    { name: 'Lite',       minutes: 300,  messages: 20000,  price: 899,  setup: 1399 },
    { name: 'Standard',   minutes: 600,  messages: 60000,  price: 1199, setup: 1399 },
    { name: 'Pro',        minutes: 1200, messages: 100000, price: 1399, setup: 1399 },
    { name: 'Enterprise', enterprise: true }
  ]
};

window.AXONCORE_PACKAGE_NAMES = {
  a: 'Package A — Frontline Reception',
  b: 'Package B — Conversion System',
  c: 'Package C — OmniChannel Front Desk'
};
