/* ============================================================
   AXONCORE — Canonical Pricing Data
   ============================================================
   Single source of truth for setup fees, monthly fees, minute
   allowances and message allowances, across all three modules
   (Voice / Engage / Connect) and their tiers. Modules are sold
   standalone or bundled — see bundle-pricing.js for the
   20%-off-the-cheaper-module(s) discount rule.

   Loaded before bundle-pricing.js, tier.js (pricing.html) and
   roi.js (results.html). If a price changes, change it ONCE,
   here — never inside tier.js, router.js or roi.js directly.

   Two things this file does NOT reach, and which still have to be
   updated by hand when a price changes, because they're read by
   crawlers/servers that don't execute this script:
     1. The schema.org JSON-LD <script> blocks in pricing.html and
        index.html — AI/search crawlers read static HTML, not
        executed JS, so those numbers are necessarily duplicated.
     2. api/chat.js — Riley's own ground-truth pricing knowledge
        for the live chat/voice demo, evaluated server-side.
     3. llms.txt — the AI-crawler-facing summary, actively read by
        GPTBot/ClaudeBot/PerplexityBot per robots.txt.
   All three carry a comment pointing back to this file. Grep this
   repo for "AXONCORE_MODULES" before you ship a price change to
   confirm every reference moved together.
   ============================================================ */
window.AXONCORE_MODULES = {
  voice: {
    label: 'Voice — AI Phone Receptionist',
    unit: 'minutes',
    tiers: [
      { name: 'Starter',    minutes: 300,  price: 170,  setup: 599, band: 'under ~120 calls/mo' },
      { name: 'Lite',       minutes: 600,  price: 300,  setup: 599, band: '~120–240 calls/mo' },
      { name: 'Standard',   minutes: 1500, price: 700,  setup: 599, band: '~240–600 calls/mo' },
      { name: 'Pro',        minutes: 3500, price: 1600, setup: 599, band: '~600+ calls/mo' },
      { name: 'Enterprise', enterprise: true }
    ]
  },
  chat: {
    label: 'Engage — AI Website Concierge',
    unit: 'messages',
    tiers: [
      { name: 'Starter',    messages: 1500,  price: 300,  setup: 599 },
      { name: 'Lite',       messages: 3000,  price: 500,  setup: 599 },
      { name: 'Standard',   messages: 10000, price: 999,  setup: 599 },
      { name: 'Pro',        messages: 20000, price: 1500, setup: 599 },
      { name: 'Enterprise', enterprise: true }
    ]
  },
  social: {
    label: 'Connect — AI WhatsApp Agent',
    unit: 'messages',
    tiers: [
      { name: 'Starter',    messages: 1000,  price: 400,  setup: 1399 },
      { name: 'Lite',       messages: 3000,  price: 1000, setup: 1399 },
      { name: 'Standard',   messages: 5000,  price: 1500, setup: 1399 },
      { name: 'Pro',        messages: 10000, price: 2500, setup: 1399 },
      { name: 'Enterprise', enterprise: true }
    ]
  }
};
