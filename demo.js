(function(){
  'use strict';

  /* ── State ── */
  var STATE = 'idle';
  var faqResponseCount = 0;
  var selectedService = '', selectedServiceName = '', selectedDate = '', selectedTime = '';
  var selectedConsultant = '';   /* key into STAFF_SCHEDULES, or '' */
  var selectedAddOn = '';        /* '' or 'Product Name ($XX)' if upsell accepted */
  var partialName = '', partialPhone = ''; /* collected separately if needed */

  /* ── Clinic knowledge — pricing based on Singapore mid-range Orchard clinics ── */
  var SERVICES = [
    { key:'hydrafacial', name:'Hydrafacial',           price:'$268', duration:'60 mins', keys:['hydra'] },
    { key:'antiaging',   name:'Anti-Aging Facial',     price:'$188', duration:'75 mins', keys:['anti','aging','ageing','age','wrinkle','firm','lift'] },
    { key:'deepcleanse', name:'Organic Deep Cleanse',   price:'$118', duration:'60 mins', keys:['deep','organic','cleanse','clean','sensitive','first time'] },
    { key:'led',         name:'LED Light Therapy',     price:'$148', duration:'45 mins', keys:['led','light therapy','blue light','red light'] },
    { key:'microderm',   name:'Microdermabrasion',     price:'$168', duration:'45 mins', keys:['microderm','microderma','exfoliat','texture'] },
    { key:'peel',        name:'Chemical Peel',         price:'$198', duration:'60 mins', keys:['peel','chemical peel','glycolic','lactic','acid'] },
    { key:'microneedl',  name:'Microneedling',         price:'$488', duration:'90 mins', keys:['microneedl','micro needle','collagen induction'] },
    { key:'booster',     name:'Skin Booster (PDRN)',   price:'$688', duration:'45 mins', keys:['skin booster','pdrn','rejuran','hyaluronic','injectable'] },
    { key:'botox',       name:'Botox',                 price:'from $380/area', duration:'30 mins', keys:['botox','botulinum','wrinkle relax'] },
    { key:'consult',     name:'Dermal Consultation',   price:'$88',  duration:'30 mins', keys:['consult','dermal','skin plan','skin analysis','skin check','assessment'] }
  ];

  /* ── Upsell add-ons — paired with each service at the checkout step ── */
  var UPSELLS = {
    'hydrafacial': { name:'Brightening Booster Serum',   price:'$48', blurb:'Infused into your skin during the Hydrafacial for a supercharged glow — our most popular add-on 💎' },
    'antiaging':   { name:'Collagen Eye Patches',         price:'$28', blurb:'Applied around the eyes during your facial to target crow\'s feet and fine lines ✨' },
    'deepcleanse': { name:'Pore-Refining Mask Upgrade',   price:'$38', blurb:'Replaces the standard finishing mask — draws out impurities for visibly tighter pores 🌿' },
    'led':         { name:'Post-LED Barrier Repair Serum', price:'$55', blurb:'Take-home serum that locks in your LED results for 2× longer — apply nightly for best results 💡' },
    'microderm':   { name:'Hyaluronic Soothing Sheet Mask', price:'$25', blurb:'Applied post-treatment to calm redness and deeply hydrate freshly exfoliated skin 💧' },
    'peel':        { name:'SPF50+ Recovery Cream',         price:'$45', blurb:'Essential post-peel sun protection — shields new skin during the peeling phase ⚗️' },
    'microneedl':  { name:'PDRN Recovery Ampoule',         price:'$88', blurb:'Medical-grade concentrate applied immediately post-needling to accelerate collagen repair 🔬' },
    'booster':     { name:'Hyaluronic Aftercare Kit',      price:'$65', blurb:'A 30-day at-home hydration kit that extends your skin booster results significantly 💉' },
    'botox':       { name:'Arnica Recovery Cream',          price:'$35', blurb:'Clinic favourite — reduces bruising and swelling after injectables, applied immediately 💉' },
    'consult':     { name:'Visia® Skin Scan Print Report',  price:'$30', blurb:'A full printed analysis of your skin from our Visia® scanner — yours to keep and reference 🩺' }
  };

  /* SLOTS removed — flexible parser below accepts any date+time the customer proposes */

  /* ── Staff schedules (fictitious but realistic for a Singapore aesthetic clinic) ── */
  var STAFF_SCHEDULES = {
    'dr.sarah': {
      displayName:  'Dr. Sarah Chen',
      firstName:    'Sarah',
      role:         'Founder & Aesthetic Doctor',
      emoji:        '👩‍⚕️',
      pronoun:      'her',
      pattern:      /dr\.?\s*sarah|dr\.?\s*chen/i,
      treatments:   'Botox, Skin Booster (PDRN), Microneedling & Dermal Consultations',
      note:         'Dr. Sarah performs medical and injectable treatments only.',
      workingDays:  [2, 4, 6], /* Tue, Thu, Sat */
      slotsByDay:   {
        2: ['2:00pm','3:30pm','5:00pm','6:30pm'],
        4: ['10:00am','11:30am','2:00pm','3:30pm','5:00pm'],
        6: ['9:00am','10:30am','12:00pm']
      }
    },
    'dr.marcus': {
      displayName:  'Dr. Marcus Lee',
      firstName:    'Marcus',
      role:         'Aesthetic Doctor (7 yrs)',
      emoji:        '👨‍⚕️',
      pronoun:      'his',
      pattern:      /dr\.?\s*marcus|dr\.?\s*lee\b/i,
      treatments:   'Botox, Dermal Fillers, Chemical Peels & Dermal Consultations',
      note:         'Dr. Marcus specialises in natural-looking injectables and skin rejuvenation.',
      workingDays:  [1, 3, 5, 0], /* Mon, Wed, Fri, Sun */
      slotsByDay:   {
        1: ['10:00am','12:00pm','3:00pm','5:00pm'],
        3: ['11:00am','1:00pm','3:00pm','6:00pm'],
        5: ['10:00am','2:00pm','4:00pm','6:00pm'],
        0: ['10:00am','12:00pm','3:00pm']
      }
    },
    'clara': {
      displayName:  'Clara Lim',
      firstName:    'Clara',
      role:         'Senior Aesthetician (9 yrs)',
      emoji:        '💆',
      pronoun:      'her',
      pattern:      /\bclara(\s+lim)?\b/i,
      treatments:   'Hydrafacial, Anti-Aging Facial, Microdermabrasion & LED Therapy',
      note:         'Clara specialises in Hydrafacial and advanced anti-aging facials.',
      workingDays:  [1, 3, 5, 6], /* Mon, Wed, Fri, Sat */
      slotsByDay:   {
        1: ['10:00am','12:00pm','2:00pm','4:00pm','6:00pm'],
        3: ['10:00am','12:00pm','3:00pm','5:00pm','6:00pm'],
        5: ['10:00am','12:00pm','2:00pm','4:00pm'],
        6: ['9:00am','11:00am','1:00pm','3:00pm']
      }
    },
    'priya': {
      displayName:  'Priya Nair',
      firstName:    'Priya',
      role:         'Aesthetician (5 yrs)',
      emoji:        '💆',
      pronoun:      'her',
      pattern:      /\bpriya(\s+nair)?\b/i,
      treatments:   'Organic Deep Cleanse, LED Therapy & Chemical Peels',
      note:         'Priya specialises in sensitive and acne-prone skin.',
      workingDays:  [2, 4, 5, 6], /* Tue, Thu, Fri, Sat */
      slotsByDay:   {
        2: ['10:00am','12:00pm','3:00pm','5:00pm'],
        4: ['10:00am','2:00pm','4:00pm','5:30pm'],
        5: ['10:00am','12:00pm','3:00pm'],
        6: ['9:00am','11:00am','1:00pm']
      }
    }
  };

  /* ── FAQ knowledge base (50+ questions) ── */
  var FAQ = [
    /* Location */
    {
      p:[/where.*(you|located|find|clinic|address)/i, /location|address|directions|how to get there/i],
      r:'📍 We\'re at *12 Orchard Boulevard, #05-01, Singapore 248653* — corner of Orchard & Grange Rd.\n\n🚇 Nearest MRT: *Orchard* or *Somerset* (5-min walk)\n🚗 Wilson Carpark next door (enter via Grange Rd)\n\nWould you like to book an appointment?',
      s:['Book an appointment 📅','See our hours 🕐','Parking info 🚗']
    },
    /* Parking */
    {
      p:[/park(ing)?/i],
      r:'🚗 *Wilson Carpark* is right next door (enter from Grange Road) — $2.20/hr.\n\n💡 *Spend $50+ on treatments or products* and we\'ll validate 2 hours of free parking!\n\nNeed directions?',
      s:['Get directions 📍','Book now 📅']
    },
    /* Hours */
    {
      p:[/hours|opening|open|close|when are you|what time|operating/i],
      r:'🕐 *Lumina Aesthetics Opening Hours:*\n\n📅 *Mon–Fri:* 10:00am – 8:00pm\n📅 *Saturday:* 9:00am – 7:00pm\n📅 *Sunday:* 10:00am – 5:00pm\n\nClosed on Singapore public holidays. Last appointment 45 mins before closing.\n\nWant to book a slot?',
      s:['Book an appointment 📅','See our treatments 💆']
    },
    /* Weekends / evenings */
    {
      p:[/weekend|saturday|sunday|evening|after work|late night/i],
      r:'Great news — we\'re open *Saturdays 9am–7pm* and *Sundays 10am–5pm* 🌟\n\nWe also have *weekday evening slots until 8pm* — perfect for after-work visits!\n\nWant to check availability?',
      s:['Book a weekend slot 📅','Book an evening slot 🌙','Book now 📅']
    },
    /* Jamie Wong — skincare consultant, in-clinic only */
    {
      p:[/\bjamie(\s+wong)?\b/i],
      r:'🔬 *Jamie Wong* is our Skincare Consultant — a product specialist and skin analysis expert who works in-clinic.\n\nJamie doesn\'t take appointments through this chat, but you\'ll meet them during any of our facial treatments or consultations!\n\n💡 *Tip:* Book a *Dermal Consultation* ($88 | 30 mins) with Dr. Sarah or Dr. Marcus for a full in-depth skin plan — Jamie will often join to walk you through the product recommendations.\n\nWant to book?',
      s:['Book Consultation 🩺 $88','See our treatments 💆','Book now 📅']
    },
    /* Staff / team — includes "practitioner", "who else", "list of" */
    {
      p:[/who will|therapist|aesthetician|staff|team|consultant|practitioner|who.*(treat|do|perform)|list of (doctor|staff|practitioner|therapist)|who (do|are) you|who else/i],
      r:'Meet the *Lumina Aesthetics* team 🌟\n\n👩‍⚕️ *Dr. Sarah Chen* — Founder & Aesthetic Doctor (12 yrs, AAAM certified)\n👨‍⚕️ *Dr. Marcus Lee* — Aesthetic Doctor, 7 yrs (injectables & fillers)\n💆 *Clara Lim* — Senior Aesthetician (9 yrs), Hydrafacial & anti-aging specialist\n💆 *Priya Nair* — Aesthetician (5 yrs), sensitive skin & LED expert\n🔬 *Jamie Wong* — Skincare Consultant & product specialist\n\n💡 Both doctors are fully certified for injectables and medical treatments. Clara and Priya handle all facial and skin treatments.\n\nWant to book with a specific team member?',
      s:['Book with Dr. Sarah 👩‍⚕️','Book with Dr. Marcus 👨‍⚕️','Book with Clara 💆']
    },
    /* "Any other doctors / staff / more" — must appear BEFORE the doctor entry */
    {
      p:[/any other|more (doctor|staff|practitioner|therapist|aesthetician)|other doctor|other practitioner|other therapist|other staff|anyone else|else on/i],
      r:'Here\'s the full *Lumina Aesthetics* team 🌟\n\n👩‍⚕️ *Dr. Sarah Chen* — Founder & Aesthetic Doctor (Botox, PDRN, Microneedling)\n👨‍⚕️ *Dr. Marcus Lee* — Aesthetic Doctor (Botox, Fillers, Peels)\n💆 *Clara Lim* — Senior Aesthetician (Hydrafacial, anti-aging, LED)\n💆 *Priya Nair* — Aesthetician (sensitive skin, deep cleanse, peels)\n🔬 *Jamie Wong* — Skincare Consultant (products & consultations)\n\nWe have two doctors available for medical treatments. Clara and Priya are fully CIBTAC / ITEC certified for all facial treatments.\n\nWould you like to book with a specific team member?',
      s:['Book with Dr. Sarah 👩‍⚕️','Book with Dr. Marcus 👨‍⚕️','Book with Clara 💆']
    },
    /* Doctor */
    {
      p:[/doctor|dr\.|dr sarah|dr chen|dr marcus|dr lee|medical|see a doctor/i],
      r:'We have two Aesthetic Doctors at *Lumina Aesthetics*:\n\n👩‍⚕️ *Dr. Sarah Chen* — Founder, 12 yrs\nBotox, Skin Booster (PDRN), Microneedling & Dermal Consultations\n\n👨‍⚕️ *Dr. Marcus Lee* — 7 yrs\nBotox, Dermal Fillers, Chemical Peels & Dermal Consultations\n\n💡 New patients book a *Dermal Consultation* ($88 | 30 mins) — fully redeemable against any same-day treatment.\n\nWho would you like to see?',
      s:['Book with Dr. Sarah 👩‍⚕️','Book with Dr. Marcus 👨‍⚕️','Book Consultation 🩺 $88']
    },
    /* Qualifications / safety */
    {
      p:[/qualif|certif|experience|trained|safe|licensed/i],
      r:'✅ All our therapists are professionally certified and trained:\n\n• *Dr. Sarah Chen* — AAAM certified aesthetic doctor, 12 years experience\n• All aestheticians hold CIBTAC / ITEC certifications\n• Medical-grade equipment sterilised after every client\n• Strict clinical hygiene protocols\n\nYour safety is our top priority 💜\n\nWant to know about a specific treatment?',
      s:['See our treatments 💆','Book Consultation 🩺','Book now 📅']
    },
    /* Hydrafacial */
    {
      p:[/hydrafacial|hydra facial/i],
      r:'💎 *Hydrafacial* — $268 | 60 minutes\n\nOur #1 most popular treatment! A 3-step deep cleanse, exfoliation + skin nourishment with medical-grade Vortex serums.\n\n✨ *Treats:* dehydration, dull skin, enlarged pores, oiliness, uneven tone\n✅ *Suitable for:* ALL skin types including sensitive\n⏱ *Downtime:* zero — you walk out glowing!\n🗓 *Recommended:* every 4–6 weeks\n\n"Skin looks plumper and cleaner after the very first session" — our most-reviewed treatment!\n\nShall I book you in?',
      s:['Book Hydrafacial 💎 $268','See all treatments 💆','Book now 📅']
    },
    /* Anti-aging */
    {
      p:[/anti.?aging|anti.?ageing|ageing|wrinkle|fine line|firm(ing)?|lift(ing)?|mature skin/i],
      r:'✨ *Anti-Aging Facial* — $188 | 75 minutes\n\nA results-driven facial using professional-grade actives to target fine lines, skin laxity and dullness.\n\n✨ *Treats:* fine lines, wrinkles, loss of firmness, dullness, age spots\n✅ *Best for:* clients 30+ or those wanting preventative care\n⏱ *Downtime:* mild redness settles within a few hours\n🗓 *Recommended:* monthly for best results\n\nFor deeper anti-aging, also consider *Microneedling* ($488) or *Botox* (from $380/area).\n\nWant to book?',
      s:['Book Anti-Aging Facial ✨ $188','About Microneedling','About Botox 💉']
    },
    /* Deep cleanse */
    {
      p:[/deep clean|organic.facial|organic clean|cleansing facial/i],
      r:'🌿 *Organic Deep Cleanse Facial* — $118 | 60 minutes\n\nA thorough yet gentle cleansing treatment using certified organic products — our #1 choice for first-time clients!\n\n✨ *Treats:* blocked pores, acne, excess oil, dull skin, impurities\n✅ *Suitable for:* sensitive, acne-prone, and first-time clients\n⏱ *Downtime:* zero\n🌱 *Products:* 100% certified organic, no harsh chemicals\n\nWant to book?',
      s:['Book Deep Cleanse 🌿 $118','See all treatments 💆','Book now 📅']
    },
    /* LED */
    {
      p:[/\bled\b|light therapy|red light|blue light/i],
      r:'💡 *LED Light Therapy* — $148 | 45 minutes\n\nA proven, non-invasive treatment using specific light wavelengths to heal and rejuvenate at a cellular level.\n\n🔴 *Red LED:* boosts collagen, reduces fine lines + inflammation\n🔵 *Blue LED:* kills acne-causing bacteria\n🟡 *Yellow LED:* fades pigmentation, reduces redness\n\n✅ *Suitable for:* all skin types\n⏱ *Downtime:* zero\n🗓 *Best results:* course of 6 sessions — package pricing available!\n\nWant to book?',
      s:['Book LED Therapy 💡 $148','See package deals 🎁','Book now 📅']
    },
    /* Microdermabrasion */
    {
      p:[/microderm|exfoliat|rough skin|skin texture/i],
      r:'✨ *Microdermabrasion* — $168 | 45 minutes\n\nMedical-grade mechanical exfoliation that polishes away dead skin, revealing smoother, brighter skin.\n\n✨ *Treats:* rough texture, dullness, mild acne scars, enlarged pores, sun damage\n✅ *Suitable for:* most skin types (not for active acne or rosacea)\n⏱ *Downtime:* mild redness for 24 hrs — no social downtime\n🗓 *Recommended:* every 4 weeks\n\nWant to book?',
      s:['Book Microdermabrasion $168','See all treatments 💆','Book now 📅']
    },
    /* Chemical peel */
    {
      p:[/chemical peel|peel|glycolic|lactic acid|tca|skin resurface/i],
      r:'⚗️ *Chemical Peel* — from $198 | 60 minutes\n\nProfessionally applied acid peels tailored to your skin type and concern.\n\n*Strengths available:*\n• *Superficial (lactic):* glow boost, zero downtime\n• *Medium (glycolic/mandelic):* pigmentation + texture, 3–5 days of gentle peeling\n• *Deep TCA:* acne scars, 5–7 days downtime\n\n💡 A *Dermal Consultation* is recommended before your first peel.\n\nWant to book a consultation?',
      s:['Book Consultation 🩺 $88','Book Chemical Peel $198','Book now 📅']
    },
    /* Microneedling */
    {
      p:[/microneedl|micro.needle|collagen induction|needle therapy/i],
      r:'🔬 *Microneedling (Collagen Induction Therapy)* — $488 | 90 minutes\n\nTiny needles create micro-channels in the skin, triggering collagen production and deep skin renewal.\n\n✨ *Treats:* acne scars, enlarged pores, deep wrinkles, skin laxity\n✅ *Suitable for:* most skin types (not during active breakouts)\n⏱ *Downtime:* 24–48 hrs redness and mild swelling — plan ahead!\n🗓 *Best results:* 3–6 sessions, 4 weeks apart\n\n💡 A consultation with one of our doctors is recommended first.\n\nWant to book?',
      s:['Book Consultation 🩺 $88','Book Microneedling $488','Book now 📅']
    },
    /* Skin booster */
    {
      p:[/skin booster|pdrn|rejuran|polynucleotide|booster inject|filler/i],
      r:'💉 *Skin Booster (PDRN/Rejuran)* — $688 | 45 minutes\n\nMicro-injections of PDRN (Polynucleotide) or Hyaluronic Acid delivered into the skin for deep hydration and glow.\n\n✨ *Results:* significantly improved hydration, elasticity and "glass skin" radiance\n⏱ *Downtime:* tiny pin-point marks for 24 hrs\n🗓 *Best results:* 3 sessions, 4 weeks apart\n\n👩‍⚕️ *Medical doctors only* (Dr. Sarah or Dr. Marcus) — a consultation is required for all injectables.\n\nBook your consultation?',
      s:['Book Consultation 🩺 $88','About Botox 💉','Book now 📅']
    },
    /* Botox */
    {
      p:[/botox|botulinum|wrinkle relax|toxin|frown line|crow.s feet/i],
      r:'💉 *Botox / Wrinkle Relaxers* — from $380/area | 30 minutes\n\nBotulinum Toxin relaxes muscles that cause expression lines — smoothing forehead, crow\'s feet and frown lines.\n\n*Pricing by area (SGD):*\n• Forehead: from $380\n• Crow\'s feet: from $320\n• Frown lines (11s): from $340\n• Full upper face: from $880\n\n👩‍⚕️ *Medical doctors only* (Dr. Sarah or Dr. Marcus)\n⏱ *Results:* visible in 3–5 days, last 3–6 months\n✅ Consultation required before first treatment\n\nBook a consultation?',
      s:['Book Consultation 🩺 $88','About Skin Boosters 💉','Book now 📅']
    },
    /* Consultation */
    {
      p:[/consult|skin plan|skin analysis|skin assess|skin check|not sure which/i],
      r:'🩺 *Dermal Consultation* — $88 | 30 minutes\n\nNot sure where to start? Our consultation with *Dr. Sarah Chen* or *Dr. Marcus Lee* includes:\n\n✅ In-depth skin analysis using *Visia® Skin Scanner*\n✅ Personalised treatment plan\n✅ Discussion of goals and budget\n✅ Product recommendations\n✅ *$88 fully redeemable* against any treatment booked the same day\n\nThe perfect first step before any injectable or advanced treatment!\n\nShall I book you in?',
      s:['Book Consultation 🩺 $88','See all treatments 💆','Book now 📅']
    },
    /* New client */
    {
      p:[/first time|new client|first visit|first appointment|never been|never had a facial/i],
      r:'Welcome — we love first-time clients! 🌟\n\n*What to expect on your first visit:*\n1️⃣ Arrive 5–10 mins early for a short skin health form\n2️⃣ Your therapist reviews your skin concerns (10 mins)\n3️⃣ Your personalised treatment begins\n4️⃣ Post-care advice + next appointment recommendation\n\n🎁 *New client perk:* complimentary skincare goodie bag (valued at $45)!\n\nNot sure which treatment? *Organic Deep Cleanse* ($118) is perfect for first timers.\n\nShall I book you in?',
      s:['Book Deep Cleanse 🌿 $118','Book Consultation 🩺 $88','Book now 📅']
    },
    /* Combine treatments — must be checked BEFORE same-day so "same day + two treatments" doesn't match slot-availability FAQ */
    {
      p:[/combin|two treatment|multiple.*treat|same day.*two|two.*same day|together|package deal/i],
      r:'✨ *Combining treatments = maximum results + savings!*\n\n🌟 *Glow Boost Combo:*\nHydrafacial + LED Yellow — *$368* (save $48)\n\n💆 *Acne Clear Combo:*\nOrganic Cleanse + LED Blue — *$228* (save $38)\n\n✨ *Age Reset Combo:*\nAnti-Aging Facial + LED Red — *$298* (save $38)\n\nCombination treatments are done in a *single session* and save 10–15%!\n\nBook a consultation for a fully personalised combo plan.\n\nWant to book?',
      s:['Book Glow Boost Combo ✨','Book Acne Clear Combo 💆','Book Consultation 🩺 $88']
    },
    /* Walk-in */
    {
      p:[/walk.in|drop.in|without booking|just come in|without appointment/i],
      r:'We do *welcome walk-ins* when slots are available 😊\n\n⏰ Best times for walk-ins:\n• Weekday mornings 10am–12pm\n• Sunday afternoons\n\nHowever, *booking guarantees your spot* and preferred therapist — and you can book right here in this chat!\n\nWant to check availability?',
      s:['Book now 📅','Check our hours 🕐','See our treatments 💆']
    },
    /* Same day */
    {
      p:[/today|same.day|asap|urgent|last minute|available now|right now/i],
      r:'We sometimes have *same-day slots* available! 📅\n\nFor immediate availability:\n1. Tap *Book now* below to check today\'s open slots\n2. Call us directly: *+65 6789 1234*\n3. WhatsApp: *+65 9123 4567*\n\nOur team can confirm same-day availability instantly!\n\nWant to book now?',
      s:['Book now 📅','Call us 📞 +65 6789 1234','WhatsApp us 💬']
    },
    /* Cancellation */
    {
      p:[/cancel(l?)|can i cancel/i],
      r:'📋 *Cancellation Policy:*\n\n✅ *24+ hours notice:* full cancellation, no charge\n⚠️ *Less than 24 hours:* 50% cancellation fee\n❌ *No-show:* full treatment fee charged\n\n*To cancel:*\n📱 Reply to your booking confirmation\n📞 Call: *+65 6789 1234*\n💬 WhatsApp: *+65 9123 4567*\n\nNeed to reschedule instead?',
      s:['Reschedule 📅','Book a new time 📅','Contact us 📞']
    },
    /* Reschedule */
    {
      p:[/rescheduled?|change.*appointment|move.*booking|different time|change.*date/i],
      r:'No problem at all 😊\n\n*To reschedule your appointment:*\n• Give us *at least 24 hours notice* — free to change!\n• 📞 Call: *+65 6789 1234*\n• 💬 WhatsApp: *+65 9123 4567*\n• 📧 Email: hello@luminaaesthetics.sg\n\nOr book a new slot right here in this chat 💜\n\nWant to pick a new time?',
      s:['Pick a new time 📅','Contact us 📞','Book now 📅']
    },
    /* Payment */
    {
      p:[/payment|pay|cash|card|paynow|paylah|grab|atome|installment|split.*payment|visa|mastercard/i],
      r:'💳 *We accept all major payment methods:*\n\n• Cash (SGD)\n• Visa & Mastercard\n• NETS\n• *PayNow / PayLah!*\n• *GrabPay*\n• *Atome* — split into 3 interest-free monthly instalments ✨\n\nNo deposit required to book. Payment is collected after your treatment.\n\nAll packages and products are also eligible for Atome instalments!\n\nAny other questions?',
      s:['Book now 📅','See our pricing 💰','See our treatments 💆']
    },
    /* Insurance */
    {
      p:[/insurance|medisave|cpf|claimable|claim|corporate/i],
      r:'Aesthetic treatments are generally *not claimable* under standard health insurance or MediSave in SG (they\'re considered elective/cosmetic).\n\n✅ *Some corporate flexi-benefit plans* do cover aesthetics — worth checking with your HR!\n✅ Our *Atome* option lets you split any bill into *3 interest-free payments*.\n\nFor any medically related skin conditions, Dr. Sarah may have alternative recommendations.\n\nAny other questions?',
      s:['See payment options 💳','Book now 📅','Speak with Dr. Sarah 👩‍⚕️']
    },
    /* Pre-treatment care */
    {
      p:[/before.*treatment|before.*appointment|prepar|before.*facial|what.*bring|avoid before/i],
      r:'✅ *Before Your Appointment:*\n\n• Arrive with *clean, makeup-free skin* if possible (we can cleanse on arrival)\n• *Avoid retinol, AHA/BHA* for 48 hrs prior\n• For peels or needling: *avoid sun exposure* for 1 week before\n• *No waxing or threading* in the treatment area 48 hrs before\n• Stay well *hydrated*\n• Tell us of any *allergies or medications*\n\nWant more specific prep advice for a particular treatment?',
      s:['Hydrafacial prep tips','Peel prep tips','Book now 📅']
    },
    /* Post-treatment care */
    {
      p:[/after.*treatment|aftercare|after.*facial|post.treatment|avoid after|recovery tips/i],
      r:'🌿 *General Post-Treatment Aftercare:*\n\n☀️ *SPF 50 every morning* — non-negotiable!\n🌡️ *Avoid heat:* no sauna, steam or intense exercise for 24–48 hrs\n💄 *Makeup:* wait 4 hrs after facials, 24 hrs after peels/needling\n🧴 *Skincare:* avoid retinol or exfoliants for 3–5 days\n💧 *Hydration:* drink plenty of water and moisturise well\n\nYour therapist will give personalised aftercare instructions after every session 💜',
      s:['Book now 📅','Ask about a specific treatment','See our treatments 💆']
    },
    /* Downtime */
    {
      p:[/downtime|recovery|redness|swelling|social downtime|how long.*heal|how long.*recover/i],
      r:'⏱ *Treatment Downtime Guide:*\n\n✅ *Zero downtime:*\n   💎 Hydrafacial · 🌿 Deep Cleanse · 💡 LED · Consultation\n\n🟡 *Mild (24–48 hrs):*\n   ✨ Microdermabrasion (mild redness)\n   💉 Skin Booster (tiny pin-marks)\n   💉 Botox (avoid lying flat 4 hrs)\n\n🟠 *Moderate (3–7 days):*\n   ⚗️ Chemical Peel (gentle flaking 3–5 days)\n   🔬 Microneedling (redness + mild swelling 24–48 hrs)\n\n💡 For treatments with downtime, book on a *Thursday or Friday* to recover over the weekend!\n\nWant to book?',
      s:['Zero-downtime treatments ✅','Book now 📅','Book Consultation 🩺']
    },
    /* Acne */
    {
      p:[/acne|breakout|pimple|blemish|oily skin|congested pores/i],
      r:'💆 *Best treatments for acne-prone skin:*\n\n🌿 *#1 Organic Deep Cleanse* — $118\nGentle deep cleansing + extractions + calming mask\n\n💡 *#2 LED Blue Light Therapy* — $148\nScientifically kills acne-causing P.acnes bacteria\n\n⚗️ *#3 Chemical Peel (light)* — from $198\nUnclogs pores, reduces active acne + post-acne marks\n\n🔬 *#4 Microneedling* — $488\nReduces acne scars and textural damage\n\n💡 *Best approach:* combine LED + Deep Cleanse as a starting series. Book a *Dermal Consultation* for a custom plan!\n\nWant to book?',
      s:['Book Deep Cleanse 🌿 $118','Book LED Therapy 💡 $148','Book Consultation 🩺 $88']
    },
    /* Pigmentation */
    {
      p:[/pigment|dark spot|melasma|sun spot|hyperpigment|uneven.tone|bright(en|ening)/i],
      r:'✨ *Best treatments for pigmentation:*\n\n💡 *#1 LED Yellow Light* — $148\nReduces melanin production, brightens existing spots\n\n⚗️ *#2 Chemical Peel* — from $198\nAcid-based treatment that fades hyperpigmentation over time\n\n🔬 *#3 Microneedling* — $488\nBreaks up pigmentation clusters and renews skin\n\n📌 *Key reminder:* SPF 50 every morning is essential — sun exposure worsens pigmentation.\n\nFor personalised advice, book a consultation with Dr. Sarah!\n\nWant to book?',
      s:['Book LED Therapy 💡 $148','Book Chemical Peel $198','Book Consultation 🩺 $88']
    },
    /* Anti-aging recommendations */
    {
      p:[/look younger|look young|turn back|best for aging|best.*wrinkle|reverse.*age|mature skin/i],
      r:'✨ *Best anti-aging approach at Lumina:*\n\n*In your 30s (prevention):*\n✨ Anti-Aging Facial ($188) + LED Red ($148)\n\n*In your 40s+ (correction):*\n🔬 Microneedling ($488) + Botox (from $380/area)\n\n*For deep hydration & "glass skin":*\n💉 Skin Booster PDRN ($688) — incredible for mature, dehydrated skin\n\n*Best instant glow with zero downtime:*\n💎 Hydrafacial ($268) — clients love the immediate results!\n\nMost clients get the best results with a *combination plan*. Dr. Sarah can create yours in a 30-min consultation ($88 — redeemable same day).\n\nShall I book?',
      s:['Book Consultation 🩺 $88','Book Anti-Aging 💆 $188','About Botox 💉']
    },
    /* Sensitive skin */
    {
      p:[/sensitive.*skin|rosacea|eczema|react|allergic.*skin|prone.*skin/i],
      r:'🌿 We specialise in *sensitive skin* and take every precaution!\n\n*Safest options for sensitive skin:*\n• 🌿 *Organic Deep Cleanse* ($118) — certified organic, zero irritants\n• 💡 *LED Red Light Therapy* ($148) — anti-inflammatory, zero irritation\n• 🩺 *Dermal Consultation* ($88) — Dr. Sarah will patch test and design a safe plan\n\n*Before your visit:*\n• Let us know your specific sensitivities when booking\n• We perform a patch test before any new treatment\n• Bring a list of known allergens or topical medications\n\nWant to book?',
      s:['Book Consultation 🩺 $88','Book Organic Cleanse 🌿 $118','Book now 📅']
    },
    /* Pregnancy */
    {
      p:[/pregnant|pregnancy|expecting|breastfeed|nursing/i],
      r:'Congratulations! 🌸 Your safety is our absolute priority.\n\n*Safe during pregnancy:*\n✅ Organic Deep Cleanse Facial ($118)\n✅ LED Red Light Therapy ($148)\n✅ Basic relaxing facials\n\n*Not recommended during pregnancy:*\n❌ Chemical Peels (any strength)\n❌ Microneedling\n❌ Botox or injectables\n❌ Microdermabrasion\n\n*Breastfeeding:* same guidelines apply.\n\nWe always recommend consulting your OB/GYN before any aesthetic treatment. We\'re happy to discuss further in a free consultation!\n\nWant to book a safe treatment?',
      s:['Book Organic Cleanse 🌿 $118','Book LED Therapy 💡 $148','Book Consultation 🩺 $88']
    },
    /* Men */
    {
      p:[/\bmen\b|\bman\b|\bmale\b|\bguy\b|for men|husband|boyfriend|father/i],
      r:'Absolutely — around *30% of our clients are men* and we love it! 💪\n\n*Most popular treatments for male clients:*\n• 💎 *Hydrafacial* ($268) — great for shaving irritation, congested pores, dull skin\n• 🌿 *Organic Deep Cleanse* ($118) — tackles oiliness and blackheads\n• 💡 *LED Therapy* ($148) — acne and skin health\n• 💉 *Botox & Skin Boosters* — increasingly popular with men 35+\n\nOur team is completely professional and discreet. No prior experience with aesthetics needed!\n\nWant to book?',
      s:['Book Hydrafacial 💎 $268','Book Deep Cleanse 🌿 $118','Book now 📅']
    },
    /* Age limit */
    {
      p:[/age limit|how old|teenager|teen|under 18|minor|child|for young/i],
      r:'📋 *Age Policy at Lumina Aesthetics:*\n\n• *18+:* All treatments available\n• *16–17:* Basic facials available with written parental consent (parent must accompany first visit)\n• *Under 16:* Not eligible for treatments\n\nFor clients under 18, a parent or guardian must be present to sign consent forms.\n\nAny other questions?',
      s:['Book now 📅','See our treatments 💆','Contact us 📞']
    },
    /* Skincare products */
    {
      p:[/product|skincare.*buy|buy.*skincare|moisturis|serum|sunscreen|spf|cream|retail/i],
      r:'🧴 *Yes — we retail professional skincare in-clinic!*\n\n*Brands we carry:*\n• *Medik8* — vitamin C, retinol, SPF (medical-grade)\n• *IMAGE Skincare* — results-driven corrective care\n• *Dermalogica* — professional cleansers + moisturisers\n• *La Roche-Posay* — sensitive skin + SPF\n\nYour therapist will personally recommend products suited to your skin. Samples are available after treatments 😊\n\n💡 Spend $100+ on products and we\'ll validate 2 hours of parking!\n\nWant personalised product recommendations?',
      s:['Get personalised advice','Book Consultation 🩺 $88','Book now 📅']
    },
    /* Packages / series */
    {
      p:[/package|series|bundle|course|multiple session|discount|loyalty|membership/i],
      r:'🎁 *Packages & Savings — up to 20% off:*\n\n💎 *Hydrafacial × 6:* $268×6 → *$1,388* (save $220)\n💡 *LED × 6:* $148×6 → *$788* (save $100)\n🔬 *Microneedling × 3:* $488×3 → *$1,288* (save $176)\n🌟 *New Client Bundle:* any 2 facials → *$268* (save up to $50!)\n\n🎯 *Lumina Loyalty Programme:*\nEarn 1 point per $1 spent · 100 points = $10 off · No expiry!\n\nAll packages payable by card, PayNow, or Atome instalments.\n\nInterested in a package?',
      s:['Hydrafacial Package 💎','LED Package 💡','New Client Bundle 🌟']
    },
    /* Gift vouchers */
    {
      p:[/gift|voucher|gift card|present|birthday.*treat|treat.*someone|for someone/i],
      r:'🎁 *Gift Vouchers — the perfect gift!*\n\nAvailable in any denomination:\n• $50 · $100 · $150 · $200\n• Or custom amount for a specific treatment\n\n*Choose your format:*\n✉️ *Digital voucher* — emailed instantly\n🎀 *Physical gift box* — beautifully packaged, collect in-clinic\n\n💡 Popular choices: *Hydrafacial* ($268) or the *New Client Bundle* ($268)\n\nValid for *12 months* from purchase. To buy, call *+65 6789 1234* or visit us in-clinic!\n\nWant to know more?',
      s:['Call to purchase 📞','Book a treatment 📅','See our treatments 💆']
    },
    /* Refund */
    {
      p:[/refund|money.?back|return policy|guarantee/i],
      r:'📋 *Refund Policy:*\n\n✅ *Packages:* Unused sessions fully refundable within 30 days of purchase\n✅ *Products:* Unopened items refundable within 14 days with receipt\n⚠️ *Single treatments:* Non-refundable once service is rendered\n⚠️ *Gift vouchers:* Non-refundable but transferable to another person\n\nIf you\'re ever unhappy with a result, please let us know — we always want to make it right 💜\n\nAny other questions?',
      s:['Book now 📅','Contact us 📞','See our treatments 💆']
    },
    /* Contact / human */
    {
      p:[/contact|phone number|call you|email|reach you|real person|speak to someone|human/i],
      r:'📞 *Get in Touch with Lumina Aesthetics:*\n\n📱 *WhatsApp / SMS:* +65 9123 4567\n📞 *Phone:* +65 6789 1234\n📧 *Email:* hello@luminaaesthetics.sg\n📍 *In Person:* 12 Orchard Boulevard, #05-01, Singapore\n\n🕐 *Phone hours:* Mon–Fri 10am–7pm · Sat 9am–6pm · Sun 10am–4pm\n\nOr book right here in this chat — a team member confirms within 15 minutes! 😊',
      s:['Book through this chat 📅','Call us 📞','WhatsApp us 💬']
    },
    /* Duration */
    {
      p:[/how long.*(treatment|take|is|does|last)|duration|time.*does/i],
      r:'⏱ *Treatment Duration Guide:*\n\n🩺 Consultation — 30 mins\n💡 LED Light Therapy — 45 mins\n💉 Botox — 30 mins\n💉 Skin Booster — 45 mins\n✨ Microdermabrasion — 45 mins\n🌿 Organic Deep Cleanse — 60 mins\n💎 Hydrafacial — 60 mins\n⚗️ Chemical Peel — 60 mins\n✨ Anti-Aging Facial — 75 mins\n🔬 Microneedling — 90 mins\n\nArrive *5–10 mins early* on your first visit for paperwork!\n\nWant to book?',
      s:['Book now 📅','See pricing 💰','See all treatments 💆']
    },
    /* Frequency */
    {
      p:[/how often|frequency|how frequent|every how|when.*come back|repeat.*treatment/i],
      r:'🗓 *Recommended Frequency:*\n\n• 💎 Hydrafacial — every 4–6 weeks\n• ✨ Anti-Aging Facial — monthly\n• 🌿 Deep Cleanse — every 4 weeks\n• 💡 LED Therapy — weekly × 6, then monthly maintenance\n• ✨ Microdermabrasion — every 4 weeks\n• ⚗️ Chemical Peel — every 4–6 weeks\n• 🔬 Microneedling — every 4–6 weeks × 3–6 sessions\n• 💉 Botox — every 3–6 months\n• 💉 Skin Booster — 3 sessions × 4 weeks, then annually\n\nYour therapist will give a personalised maintenance plan after your first visit 😊\n\nWant to book?',
      s:['Book now 📅','New Client Bundle 🎁','Book Consultation 🩺']
    },
    /* Waiting time */
    {
      p:[/wait(ing)?|how busy|queue|how long.*wait/i],
      r:'We run *by appointment only*, so waiting time is minimal ⏱\n\nMost clients are seen *within 5 minutes* of their appointment time. If we ever run over 10 minutes late, we\'ll offer a complimentary neck massage while you wait 😊\n\n💡 *Quietest times:* weekday mornings 10am–12pm\n\nWant to book?',
      s:['Book a morning slot 📅','See our hours 🕐','Book now 📅']
    },
    /* Wi-Fi */
    {
      p:[/wifi|wi.fi|internet|password|connect/i],
      r:'📶 *Free Wi-Fi is available* throughout the clinic for all clients!\n\nOur front desk team will give you the password on arrival. We also offer:\n• Complimentary water, tea and coffee ☕\n• Magazines and reading material\n• A relaxing waiting lounge\n\nMake yourself at home 💜\n\nAnything else I can help with?',
      s:['Book now 📅','Our location 📍','See treatments 💆']
    },
    /* Thank you / farewell */
    {
      p:[/thank|thanks|bye|goodbye|see you|that.?s all|thats all|great chat/i],
      r:'You\'re so welcome! 💜 It was a pleasure chatting with you.\n\nWe can\'t wait to welcome you at *Lumina Aesthetics*. Feel free to reach out anytime!\n\n📞 *+65 6789 1234*\n💬 WhatsApp: *+65 9123 4567*\n📍 *12 Orchard Blvd, #05-01, Singapore*\n\nSee you soon! ✨\n— Aria',
      s:['Book now 📅','Our location 📍']
    }
  ];

  /* ── DOM refs ── */
  var chat    = document.getElementById('ax-demo-chat');
  var inputEl = document.getElementById('ax-demo-input');
  var sendBtn = document.getElementById('ax-demo-send');
  var suggsEl = document.getElementById('ax-demo-suggestions');
  var overlay = document.getElementById('ax-demo-overlay');

  /* ── Init ── */
  setTimeout(function(){ ariaGreet(); }, 900);
  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', function(e){ if (e.key === 'Enter') handleSend(); });

  /* ── Core helpers ── */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || STATE === 'typing') return;
    inputEl.value = '';
    clearSuggestions();
    addMessage(text, 'user');
    setTimeout(function(){ ariaRespond(text); }, 400);
  }

  function addMessage(text, from, opts) {
    opts = opts || {};
    var wrap   = document.createElement('div');
    wrap.className = 'ax-msg ax-msg--' + from;
    var bubble = document.createElement('div');
    bubble.className = 'ax-msg__bubble';
    if (opts.html) {
      bubble.innerHTML = text;
    } else {
      bubble.innerHTML = escHtml(text).replace(/\n/g,'<br>').replace(/\*(.*?)\*/g,'<strong>$1</strong>');
    }
    var meta = document.createElement('div');
    meta.className = 'ax-msg__meta';
    var now = new Date(), h = now.getHours(), m = now.getMinutes();
    meta.innerHTML = (h<10?'0'+h:h)+':'+(m<10?'0'+m:m)+(from==='aria'?' <span class="ax-msg__tick">&#10003;&#10003;</span>':'');
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    scrollChat();
    return wrap;
  }

  function showTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'ax-msg ax-msg--aria';
    wrap.id = 'ax-typing-indicator';
    wrap.innerHTML = '<div class="ax-msg__bubble ax-msg__typing"><span></span><span></span><span></span></div>';
    chat.appendChild(wrap);
    scrollChat();
  }

  function hideTyping() {
    var el = document.getElementById('ax-typing-indicator');
    if (el) el.remove();
  }

  function ariaType(text, callback, opts) {
    STATE = 'typing';
    var delay = Math.min(800 + text.length * 6, 2000);
    showTyping();
    setTimeout(function(){
      hideTyping();
      addMessage(text, 'aria', opts);
      STATE = 'ready';
      if (callback) callback();
    }, delay);
  }

  function showSuggestions(items) {
    clearSuggestions();
    items.forEach(function(item){
      var btn = document.createElement('button');
      btn.className = 'ax-demo__sugg';
      btn.textContent = item;
      btn.addEventListener('click', function(){
        inputEl.value = item;
        handleSend();
      });
      suggsEl.appendChild(btn);
    });
  }

  function clearSuggestions() { suggsEl.innerHTML = ''; }
  function scrollChat() { setTimeout(function(){ chat.scrollTop = chat.scrollHeight; }, 60); }
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── FAQ matcher ── */
  function faqMatch(lower) {
    for (var i = 0; i < FAQ.length; i++) {
      var entry = FAQ[i];
      for (var j = 0; j < entry.p.length; j++) {
        if (entry.p[j].test(lower)) return entry;
      }
    }
    return null;
  }

  /* ── Service / slot matchers ── */
  function matchService(lower) {
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      for (var j = 0; j < s.keys.length; j++) {
        if (lower.indexOf(s.keys[j]) !== -1) return s;
      }
    }
    return null;
  }

  /*
   * matchSlot — flexible parser that accepts any date+time the customer writes.
   * Returns { day, time } or null if no time was detected.
   */
  function matchSlot(lower) {
    /* ── Extract time (12-hour with am/pm) ── */
    var timeRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
    var tm = lower.match(timeRe);
    if (!tm) return null; /* no time in message */

    var tH  = parseInt(tm[1]);
    var tM  = tm[2] || '00';
    if (tM.length === 1) tM = '0' + tM;
    var tP  = tm[3].toLowerCase();
    var formattedTime = tH + ':' + tM + tP;

    /* Remove the matched time so date numbers don't collide with it */
    var rest = lower.replace(tm[0], ' ');

    /* ── Day names (longest match first to catch "next saturday" before "saturday") ── */
    var DAY = {
      'next monday':'Monday','next tuesday':'Tuesday','next wednesday':'Wednesday',
      'next thursday':'Thursday','next friday':'Friday','next saturday':'Saturday','next sunday':'Sunday',
      'this monday':'Monday','this tuesday':'Tuesday','this wednesday':'Wednesday',
      'this thursday':'Thursday','this friday':'Friday','this saturday':'Saturday','this sunday':'Sunday',
      'monday':'Monday','tuesday':'Tuesday','wednesday':'Wednesday','thursday':'Thursday',
      'friday':'Friday','saturday':'Saturday','sunday':'Sunday',
      'mon':'Monday','tue':'Tuesday','wed':'Wednesday','thu':'Thursday',
      'fri':'Friday','sat':'Saturday','sun':'Sunday',
      'tomorrow':'Tomorrow','today':'Today'
    };
    var dayKeys = Object.keys(DAY).sort(function(a,b){ return b.length - a.length; });
    var foundDay = null;
    for (var i = 0; i < dayKeys.length; i++) {
      if (lower.indexOf(dayKeys[i]) !== -1) { foundDay = DAY[dayKeys[i]]; break; }
    }

    /* ── Date number (1–31) from the time-stripped string ── */
    var dNum   = null;
    var dMatch = rest.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
    if (dMatch) dNum = parseInt(dMatch[1]);

    /* ── Month names ── */
    var MONTH = {
      'january':'January','february':'February','march':'March','april':'April',
      'may':'May','june':'June','july':'July','august':'August',
      'september':'September','october':'October','november':'November','december':'December',
      'jan':'January','feb':'February','mar':'March','apr':'April',
      'jun':'June','jul':'July','aug':'August',
      'sep':'September','oct':'October','nov':'November','dec':'December'
    };
    var monthKeys = Object.keys(MONTH).sort(function(a,b){ return b.length - a.length; });
    var foundMonth = null;
    for (var mi = 0; mi < monthKeys.length; mi++) {
      if (rest.indexOf(monthKeys[mi]) !== -1) { foundMonth = MONTH[monthKeys[mi]]; break; }
    }

    if (!foundDay && !dNum) return null; /* no day/date info at all */

    var ord      = dNum ? (dNum===1?'st':dNum===2?'nd':dNum===3?'rd':'th') : '';
    var dayLabel = '';

    /* ── Resolve bare day names ("Saturday", "next Friday") to real calendar dates ── */
    if (foundDay && !dNum && !foundMonth) {
      if (foundDay === 'Today') {
        var tdDate = calToday();
        dayLabel = calFormatDate(tdDate);
      } else if (foundDay === 'Tomorrow') {
        var tmDate = new Date(calToday()); tmDate.setDate(tmDate.getDate() + 1);
        dayLabel = calFormatDate(tmDate);
      } else {
        var dowTarget = CAL_DOW[foundDay.toLowerCase()];
        if (dowTarget !== undefined) {
          /* "next saturday" → skip the immediately-next occurrence */
          var isNextKw = /\bnext\b/.test(lower);
          var resolved = calNextWeekday(dowTarget, calToday(), false);
          if (isNextKw) resolved = calNextWeekday(dowTarget, resolved, false);
          dayLabel = calFormatDate(resolved);
        } else {
          dayLabel = foundDay;
        }
      }
    } else {
      if (foundDay)   dayLabel  = foundDay;
      if (dNum)       dayLabel += (dayLabel ? ' ' : '') + dNum + ord;
      if (foundMonth) dayLabel += ' ' + foundMonth;
    }

    /* ── Calendar validation: check stated day-name against actual date ── */
    if (foundDay && dNum && foundMonth) {
      var CAL_MONTH = {
        'january':0,'february':1,'march':2,'april':3,'may':4,'june':5,
        'july':6,'august':7,'september':8,'october':9,'november':10,'december':11
      };
      var mIdx = CAL_MONTH[foundMonth.toLowerCase()];
      if (mIdx !== undefined) {
        var yr   = new Date().getFullYear();
        var cal  = new Date(yr, mIdx, dNum);
        var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        var actualDay = DAYS[cal.getDay()];
        if (actualDay.toLowerCase() !== foundDay.toLowerCase()) {
          /* Find the date of the day-name the user stated (nearest to their date) */
          var tgtIdx = DAYS.map(function(d){ return d.toLowerCase(); }).indexOf(foundDay.toLowerCase());
          var actIdx = cal.getDay();
          var diff   = tgtIdx - actIdx;
          if (diff > 3)  diff -= 7;
          if (diff < -3) diff += 7;
          var corrCal  = new Date(yr, mIdx, dNum + diff);
          var corrDate = corrCal.getDate();
          var corrOrd  = corrDate===1?'st':corrDate===2?'nd':corrDate===3?'rd':'th';
          return {
            mismatch:      true,
            statedDay:     foundDay,
            statedDate:    dNum + ord + ' ' + foundMonth,
            actualDay:     actualDay,
            correctedLabel:foundDay + ' ' + corrDate + corrOrd + ' ' + foundMonth,
            time:          formattedTime
          };
        }
      }
    }

    return { day: dayLabel, time: formattedTime };
  }

  /*
   * matchDayDate — like matchSlot but for messages with a day+date but NO time.
   * e.g. "saturday 30 june" → detects June 30 is Monday, not Saturday → mismatch.
   * Returns null when there is no day+date combo present.
   */
  function matchDayDate(lower) {
    var DAY_MAP = {
      monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday',
      friday:'Friday', saturday:'Saturday', sunday:'Sunday',
      mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday',
      fri:'Friday', sat:'Saturday', sun:'Sunday'
    };
    var MONTH_MAP = {
      january:'January', february:'February', march:'March', april:'April',
      may:'May', june:'June', july:'July', august:'August',
      september:'September', october:'October', november:'November', december:'December',
      jan:'January', feb:'February', mar:'March', apr:'April',
      jun:'June', jul:'July', aug:'August', sep:'September',
      oct:'October', nov:'November', dec:'December'
    };
    var CAL_IDX = {
      january:0,february:1,march:2,april:3,may:4,june:5,
      july:6,august:7,september:8,october:9,november:10,december:11
    };
    /* Must have a recognised time word? No — this function is for no-time messages. */
    /* Bail out if there IS a time (matchSlot handles those) */
    if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(lower)) return null;

    var foundDay = null;
    for (var dk in DAY_MAP) {
      if (lower.indexOf(dk) !== -1) { foundDay = DAY_MAP[dk]; break; }
    }
    if (!foundDay) return null;

    var numM = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    var dNum = numM ? parseInt(numM[1]) : 0;
    if (!dNum || dNum < 1 || dNum > 31) return null;

    var foundMonth = null;
    for (var mk in MONTH_MAP) {
      if (lower.indexOf(mk) !== -1) { foundMonth = MONTH_MAP[mk]; break; }
    }
    if (!foundMonth) return null;

    var ord    = dNum===1?'st':dNum===2?'nd':dNum===3?'rd':'th';
    var mIdx   = CAL_IDX[foundMonth.toLowerCase()];
    var yr     = new Date().getFullYear();
    var cal    = new Date(yr, mIdx, dNum);
    var DNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var actualDay = DNAMES[cal.getDay()];

    if (actualDay.toLowerCase() !== foundDay.toLowerCase()) {
      var tgtIdx = DNAMES.map(function(n){ return n.toLowerCase(); }).indexOf(foundDay.toLowerCase());
      var diff   = tgtIdx - cal.getDay();
      if (diff > 3)  diff -= 7;
      if (diff < -3) diff += 7;
      var corrCal  = new Date(yr, mIdx, dNum + diff);
      var corrNum  = corrCal.getDate();
      var corrOrd  = corrNum===1?'st':corrNum===2?'nd':corrNum===3?'rd':'th';
      return {
        mismatch:       true,
        statedDay:      foundDay,
        statedDate:     dNum + ord + ' ' + foundMonth,
        actualDay:      actualDay,
        correctedLabel: foundDay + ' ' + corrNum + corrOrd + ' ' + foundMonth
      };
    }
    return { mismatch: false, dayLabel: foundDay + ' ' + dNum + ord + ' ' + foundMonth };
  }

  /* Day-name detector — catches "saturday" without a time so we can ask for the time */
  function extractDayMention(lower) {
    var days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday','tomorrow','today'];
    for (var i = 0; i < days.length; i++) {
      if (lower.indexOf(days[i]) !== -1) {
        var d = days[i];
        if (d === 'today') {
          return calFormatDate(calToday());
        }
        if (d === 'tomorrow') {
          var tmrw = new Date(calToday()); tmrw.setDate(tmrw.getDate() + 1);
          return calFormatDate(tmrw);
        }
        /* Resolve bare day name to actual next calendar date */
        var isNext  = /\bnext\b/.test(lower);
        var dowTgt  = CAL_DOW[d];
        var resolved = calNextWeekday(dowTgt, calToday(), false);
        if (isNext) resolved = calNextWeekday(dowTgt, resolved, false);
        return calFormatDate(resolved);
      }
    }
    /* Also catch "7 june", "3rd july" etc. */
    var dm = lower.match(/\b(\d{1,2})(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dm) return dm[1] + (dm[2] || 'th') + ' ' + dm[3].charAt(0).toUpperCase() + dm[3].slice(1).toLowerCase();
    return null;
  }

  /* ── Opening hours validation ──
   * Based on average Singapore aesthetic clinic hours:
   * Mon–Fri 10:00am–8:00pm  (last appt 7:15pm)
   * Saturday 9:00am–6:00pm  (last appt 5:15pm)
   * Sunday  10:00am–5:00pm  (last appt 4:15pm)
   */
  function getHoursForDay(dayLabel) {
    var d = dayLabel.toLowerCase();
    if (/\bsun(day)?\b/.test(d)) {
      return { open:600, close:1020, openStr:'10:00am', closeStr:'5:00pm', lastStr:'4:15pm' };
    }
    if (/\bsat(urday)?\b/.test(d)) {
      return { open:540, close:1080, openStr:'9:00am',  closeStr:'6:00pm', lastStr:'5:15pm' };
    }
    /* Mon–Fri and unresolvable days (today/tomorrow) treated as weekday */
    return { open:600, close:1200, openStr:'10:00am', closeStr:'8:00pm', lastStr:'7:15pm' };
  }

  function timeToMins(timeStr) {
    var m = timeStr.match(/(\d{1,2}):(\d{2})(am|pm)/i);
    if (!m) return -1;
    var h = parseInt(m[1]), mins = parseInt(m[2]), p = m[3].toLowerCase();
    if (p === 'pm' && h !== 12) h += 12;
    if (p === 'am' && h === 12) h = 0;
    return h * 60 + mins;
  }

  function isWithinHours(dayLabel, timeStr) {
    var h = getHoursForDay(dayLabel);
    var t = timeToMins(timeStr);
    return t >= h.open && t <= (h.close - 45); /* 45 min buffer before closing */
  }

  function hoursRejectMsg(dayLabel) {
    var h = getHoursForDay(dayLabel);
    var d = dayLabel.toLowerCase();
    var dayName = /\bsun(day)?\b/.test(d) ? 'Sundays' : /\bsat(urday)?\b/.test(d) ? 'Saturdays' : 'weekdays';
    return 'Sorry, we\'re closed at that time 😔\n\n🕐 *Our hours on ' + dayName + ':*\n' +
           h.openStr + ' – ' + h.closeStr + ' (last appointment ' + h.lastStr + ')\n\n' +
           'Could you choose a time within those hours?';
  }

  /* Return 2–3 alternative slots on the same day, starting just after timeStr */
  function getNextSlots(dayLabel, timeStr) {
    var t    = timeToMins(timeStr);
    var hrs  = getHoursForDay(dayLabel);
    var last = hrs.close - 45; /* last bookable minute */
    var results = [];
    var steps   = [60, 90, 120, 150, 180];
    for (var i = 0; i < steps.length && results.length < 3; i++) {
      var candidate = t + steps[i];
      if (candidate <= last) {
        var ch = Math.floor(candidate / 60);
        var cm = candidate % 60;
        var ap = ch >= 12 ? 'pm' : 'am';
        var dh = ch > 12 ? ch - 12 : (ch === 0 ? 12 : ch);
        results.push(dayLabel + ' — ' + dh + ':' + (cm === 0 ? '00' : (cm < 10 ? '0'+cm : cm)) + ap);
      }
    }
    /* If fewer than 2 forward slots, try one slot before */
    if (results.length < 2) {
      var bt = t - 60;
      if (bt >= hrs.open) {
        var bh = Math.floor(bt / 60), bm = bt % 60;
        var ba = bh >= 12 ? 'pm' : 'am';
        var bd = bh > 12 ? bh - 12 : (bh === 0 ? 12 : bh);
        results.unshift(dayLabel + ' — ' + bd + ':' + (bm === 0 ? '00' : (bm < 10 ? '0'+bm : bm)) + ba);
      }
    }
    return results.slice(0, 3);
  }

  /* ════════════════════════════════════════════════════════════
   *  LIVE CALENDAR — all dates computed from the real system clock
   * ════════════════════════════════════════════════════════════ */
  var CAL_DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var CAL_MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
  var CAL_DOW = { sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6 };

  function calToday() {
    var d = new Date(); d.setHours(0,0,0,0); return d;
  }

  function calOrdinal(n) {
    return n===1?'st':n===2?'nd':n===3?'rd':'th';
  }

  /* Returns "Saturday 28th June" style label from a Date object */
  function calFormatDate(d) {
    var n = d.getDate();
    return CAL_DAY_NAMES[d.getDay()] + ' ' + n + calOrdinal(n) + ' ' + CAL_MONTH_NAMES[d.getMonth()];
  }

  /* Next Date object whose day-of-week === dowTarget (0–6).
   * Starts searching from the day AFTER today unless allowSameDay is true. */
  function calNextWeekday(dowTarget, startDate, allowSameDay) {
    var d    = new Date(startDate || calToday());
    var diff = (dowTarget - d.getDay() + 7) % 7;
    if (diff === 0 && !allowSameDay) diff = 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  /* Returns the next `count` Date objects that fall on any weekday in dowList */
  function calUpcomingDates(dowList, count) {
    var results = [], d = new Date(calToday()), limit = 120;
    d.setDate(d.getDate() + 1); /* start from tomorrow */
    while (results.length < count && limit-- > 0) {
      if (dowList.indexOf(d.getDay()) !== -1) results.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return results;
  }

  /* Build the week display for a staff member using real upcoming dates */
  function buildStaffWeek(staffKey) {
    var staff = STAFF_SCHEDULES[staffKey];
    var dates = calUpcomingDates(staff.workingDays, 3);
    return dates.map(function(d) {
      return { label: calFormatDate(d), slots: staff.slotsByDay[d.getDay()] || [] };
    });
  }

  /* Returns `count` upcoming Mon–Sat dates as chip strings ("Saturday 28th June — 10:00am") */
  function getGenericSlotChips(count) {
    var dates = calUpcomingDates([1,2,3,4,5,6], count);
    var firstSlot = { 1:'10:00am', 2:'10:00am', 3:'10:00am', 4:'10:00am', 5:'10:00am', 6:'9:00am' };
    return dates.map(function(d) {
      return calFormatDate(d) + ' — ' + (firstSlot[d.getDay()] || '10:00am');
    });
  }

  /* Returns multi-line slot text for ariaShowSlots message body */
  function getGenericSlotText(count) {
    var dates = calUpcomingDates([1,2,3,4,5,6], count);
    var altSlot = { 1:'2:00pm', 2:'2:00pm', 3:'2:00pm', 4:'2:00pm', 5:'2:00pm', 6:'11:00am' };
    var firstSlot = { 1:'10:00am', 2:'10:00am', 3:'10:00am', 4:'10:00am', 5:'10:00am', 6:'9:00am' };
    return dates.map(function(d) {
      return '📅 *' + calFormatDate(d) + '* — ' +
             (firstSlot[d.getDay()] || '10:00am') + ' · ' +
             (altSlot[d.getDay()] || '2:00pm');
    }).join('\n');
  }

  /*
   * isQuestion — returns true if the message is a question or command rather than
   * a name/phone submission. Checked BEFORE name extraction so pronouns and modal
   * verbs (could, would, can, have, do, is, what, how...) are never mistaken for names.
   */
  function isQuestion(lower) {
    if (lower.indexOf('?') !== -1) return true;
    /* Starts with a question/modal word or conversational opener */
    if (/^(could|would|can|have|has|what|where|when|how|who|which|is|are|do|does|will|shall|may|might|before|also|by the way|one more|another|sorry|excuse me|quick question|i wanted|i want to|tell me|just|about)\b/i.test(lower)) return true;
    /* Contains clear mid-sentence question patterns */
    if (/\b(could (you|i|we)|would (you|i|we)|can (you|i|we)|do you|are you|have you|is there|what (is|are|do)|how (do|much|many|long|often)|tell me (about|your|the)|your (doctor|staff|treat|service|hour|pric|locat|team|open|clos|park)|list of|get your|see your|check your|know your)\b/i.test(lower)) return true;
    return false;
  }

  /* Detect a staff name in user input — returns STAFF_SCHEDULES key or null */
  function matchStaffName(lower) {
    var keys = Object.keys(STAFF_SCHEDULES);
    for (var i = 0; i < keys.length; i++) {
      if (STAFF_SCHEDULES[keys[i]].pattern.test(lower)) return keys[i];
    }
    return null;
  }

  /* Extract a Singapore/international phone number from message text */
  function extractPhone(text) {
    /* +65 XXXX XXXX  or  8XXX XXXX  or  9XXX XXXX */
    var sg = text.match(/(\+65[\s-]?)?[689]\d{3}[\s-]?\d{4}/);
    if (sg) return sg[0].replace(/[\s-]/g,'');
    /* Generic: 8+ consecutive digit groups */
    var gen = text.match(/\d[\d\s\-]{6,}\d/);
    if (gen) {
      var digits = gen[0].replace(/[\s\-]/g,'');
      if (digits.length >= 8) return digits;
    }
    return null;
  }

  /* Extract a name from message, stripping out any phone number first */
  var NAME_BLACKLIST = /^(my|name|is|it|the|a|an|and|or|but|for|on|at|to|in|of|with|by|from|this|that|these|those|i|me|you|we|he|she|they|them|us|our|your|his|her|their|its|be|am|are|was|were|have|has|had|will|would|can|could|shall|should|may|might|must|do|does|did|get|got|go|so|if|up|out|about|just|also|hi|hello|hey|ok|okay|yes|no|please|thank|thanks|come|coming|bring|bringing|bring|book|need|want|like|love|see|book|dear|sir|madam|ah|oh|um|yeah|yep|sure|there|here|now|then|next|after|before|during|new|old|all|any|some|each|every|much|more|most|less|few|many|good|great|nice|fine|well|very|really|quite|already|still|again|never|always|often)$/i;

  function extractNameOnly(text) {
    var cleaned = text
      .replace(/(\+65[\s-]?)?[689]\d{3}[\s-]?\d{4}/g,'')
      .replace(/\d[\d\s\-]{6,}\d/g,'')
      .trim();
    /* "Name: X" or "I'm X" or "It's X" pattern */
    var nm = cleaned.match(/(?:name|i(?:'?m| am)|it(?:'?s| is))[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
    if (nm) return nm[1];
    /* Two properly-capitalized words (real name like "Sarah Tan") */
    var two = cleaned.match(/([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})+)/);
    if (two) {
      /* Verify first word is not a blacklisted common word */
      var firstWord = two[1].split(' ')[0];
      if (!NAME_BLACKLIST.test(firstWord)) return two[1];
    }
    /* Single word fallback — only if short and not blacklisted */
    var words = cleaned.split(/\s+/).filter(function(w){ return /^[A-Za-z]{2,}$/.test(w) && !NAME_BLACKLIST.test(w); });
    if (words.length >= 2) {
      /* Both words must not be common words and message must be short (likely just a name) */
      if (cleaned.split(/\s+/).length <= 4) return words.slice(0,2).join(' ');
    }
    if (words.length === 1 && cleaned.split(/\s+/).length <= 3) return words[0];
    return null;
  }

  /*
   * CHIP_MAP — maps the exact lowercase text of a suggestion chip to an action.
   * This guarantees chip clicks always hit the right handler, bypassing regex matching.
   */
  var CHIP_MAP = {
    'book an appointment 📅':   'BOOK',
    'book now 📅':              'BOOK',
    'see our treatments 💆':    'SERVICES',
    'see all treatments 💆':    'SERVICES',
    'our treatments 💆':        'SERVICES',
    'see treatments 💆':        'SERVICES',
    'choose a treatment 💆':    'SERVICES',
    'pricing 💰':               'PRICING',
    'see our pricing 💰':       'PRICING',
    'see pricing 💰':           'PRICING',
    'view pricing 💰':          'PRICING',
    'check pricing 💰':         'PRICING',
    'see package deals 🎁':     'PACKAGES',
    'hydrafacial package 💎':   'PACKAGES',
    'led package 💡':           'PACKAGES',
    'new client bundle 🌟':     'PACKAGES',
    'where are you located? 📍':'LOCATION',
    'where are you? 📍':        'LOCATION',
    'location & hours 📍':      'LOCATION',
    'location 📍':              'LOCATION',
    'see our hours 🕐':         'HOURS',
    'check our hours 🕐':       'HOURS',
    'about dr. sarah 👩‍⚕️':             'DOCTOR',
    'speak with dr. sarah 👩‍⚕️':        'DOCTOR',
    'about dr. marcus 👨‍⚕️':            'DOCTOR',
    'about botox 💉':                   'BOTOX',
    'about microneedling':              'MICRONEEDLING',
    'about skin boosters 💉':           'BOOSTER',
    'parking info 🚗':                  'PARKING',
    'get directions 📍':                'LOCATION',
    'contact us 📞':                    'CONTACT',
    'call us 📞 +65 6789 1234':         'CONTACT',
    'whatsapp us 💬':                   'CONTACT',
    'see full team 👥':                 'TEAM',
    /* Staff booking chips */
    'book with dr. sarah 👩‍⚕️':         'STAFF:dr.sarah',
    'book with sarah 📅':               'STAFF:dr.sarah',
    'book with dr. marcus 👨‍⚕️':        'STAFF:dr.marcus',
    'book with marcus 📅':              'STAFF:dr.marcus',
    'book with clara 💆':               'STAFF:clara',
    'book with clara 📅':               'STAFF:clara',
    'book with priya 💆':               'STAFF:priya',
    'book with priya 📅':               'STAFF:priya',
    /* Team selection chips (shown after unknown-name redirect) */
    'dr. sarah chen 👩‍⚕️':              'STAFF:dr.sarah',
    'dr. marcus lee 👨‍⚕️':             'STAFF:dr.marcus',
    'clara lim 💆':                     'STAFF:clara',
    'priya nair 💆':                    'STAFF:priya',
    /* Service direct-booking chips */
    'book hydrafacial 💎 $268':         'SERVICE:hydrafacial',
    'book anti-aging facial ✨ $188':   'SERVICE:antiaging',
    'book deep cleanse 🌿 $118':        'SERVICE:deepcleanse',
    'book led therapy 💡 $148':         'SERVICE:led',
    'book microdermabrasion $168':      'SERVICE:microderm',
    'book chemical peel $198':          'SERVICE:peel',
    'book microneedling $488':          'SERVICE:microneedl',
    'book consultation 🩺 $88':         'SERVICE:consult',
    'book consultation 🩺':             'SERVICE:consult',
    /* Upsell decision chips — route to awaiting_upsell handler via passthrough */
    'no thanks, just confirm':          'UPSELL:no',
    'no thanks, proceed to confirm':    'UPSELL:no'
  };

  /* ── Main router ── */
  function ariaRespond(msg) {
    var lower = msg.toLowerCase().trim();

    /* ── 1. Direct chip intent map — always fires first ── */
    var chipAction = CHIP_MAP[lower];
    /* Handle upsell-skip chips immediately, even inside awaiting_upsell */
    if (chipAction && chipAction.indexOf('UPSELL:') === 0) {
      if (STATE === 'awaiting_upsell') {
        selectedAddOn = '';
        ariaType('No worries at all! 😊', function(){ ariaConfirmBooking(partialName, partialPhone); });
      }
      return;
    }
    /* Handle STAFF chips in ALL states — including awaiting_details — so team
       selection chips always work regardless of where in the flow the user is */
    if (chipAction && chipAction.indexOf('STAFF:') === 0) {
      var chipStaffKey = chipAction.slice(6);
      var chipStaffInfo = STAFF_SCHEDULES[chipStaffKey];
      if (chipStaffInfo) {
        if (STATE === 'awaiting_details') {
          /* Already have a date — check if this consultant works that day */
          var csDateDay = selectedDate ? selectedDate.split(' ')[0].toLowerCase() : '';
          var csDatDow  = CAL_DOW[csDateDay];
          var csWorks   = (csDatDow !== undefined) && (chipStaffInfo.workingDays.indexOf(csDatDow) !== -1);
          if (selectedDate && !csWorks) {
            ariaType(
              'Hmm — *' + chipStaffInfo.displayName + '* isn\'t in on *' + selectedDate + '* 😔\n\n' +
              'Would you like to:\n' +
              '• Keep *' + selectedDate + '* with the next available consultant, or\n' +
              '• See ' + chipStaffInfo.firstName + '\'s availability on a different day?',
              function(){
                STATE = 'awaiting_details';
                showSuggestions(['Keep ' + selectedDate + ' ✅', 'See ' + chipStaffInfo.firstName + '\'s dates 📅']);
              }
            );
          } else {
            selectedConsultant = chipStaffKey;
            ariaType(
              '✅ *' + chipStaffInfo.firstName + '* is available on *' + (selectedDate || 'your chosen date') + '* ' + chipStaffInfo.emoji + '\n\n📝 Just need your *full name* and *phone number* to confirm!',
              function(){ STATE = 'awaiting_details'; }
            );
          }
        } else {
          selectedConsultant = chipStaffKey;
          ariaShowServices();
        }
      }
      return;
    }
    if (chipAction && STATE !== 'awaiting_date' && STATE !== 'awaiting_details' && STATE !== 'confirming' && STATE !== 'awaiting_upsell') {
      if (chipAction === 'BOOK' || chipAction === 'SERVICES') { ariaShowServices(); return; }
      if (chipAction === 'PRICING') { ariaShowPricing(); return; }
      if (chipAction === 'PACKAGES') {
        var pkgFaq = faqMatch('package series bundle');
        if (pkgFaq) {
          ariaType(pkgFaq.r, function(){ showSuggestions(pkgFaq.s || []); });
        }
        return;
      }
      if (chipAction === 'LOCATION') {
        var locFaq = FAQ[0]; /* first entry is location */
        ariaType(locFaq.r, function(){ showSuggestions(locFaq.s || []); });
        return;
      }
      if (chipAction === 'HOURS') {
        var hoursFaq = FAQ[2]; /* hours entry */
        ariaType(hoursFaq.r, function(){ showSuggestions(hoursFaq.s || []); });
        return;
      }
      if (chipAction === 'DOCTOR') {
        var drFaq = faqMatch('doctor dr. medical aesthetic');
        if (drFaq) ariaType(drFaq.r, function(){ showSuggestions(drFaq.s || []); });
        return;
      }
      if (chipAction === 'TEAM') {
        var teamFaq = faqMatch('staff team who will');
        if (teamFaq) ariaType(teamFaq.r, function(){ showSuggestions(teamFaq.s || []); });
        return;
      }
      /* SERVICE:key — jump straight to that service's slot picker */
      if (chipAction && chipAction.indexOf('SERVICE:') === 0) {
        var chipSvcKey = chipAction.slice(8);
        var chipSvc = null;
        for (var ci = 0; ci < SERVICES.length; ci++) {
          if (SERVICES[ci].key === chipSvcKey) { chipSvc = SERVICES[ci]; break; }
        }
        if (chipSvc) {
          selectedService     = chipSvc.key;
          selectedServiceName = chipSvc.name;
          ariaShowSlots(chipSvc);
        }
        return;
      }
      if (chipAction === 'PARKING') {
        var parkFaq = FAQ[1]; /* parking entry */
        ariaType(parkFaq.r, function(){ showSuggestions(parkFaq.s || []); });
        return;
      }
      if (chipAction === 'CONTACT') {
        var ctFaq = faqMatch('contact phone number');
        if (ctFaq) ariaType(ctFaq.r, function(){ showSuggestions(ctFaq.s || []); });
        return;
      }
      if (chipAction === 'BOTOX') {
        var bxFaq = faqMatch('botox wrinkle');
        if (bxFaq) ariaType(bxFaq.r, function(){ showSuggestions(bxFaq.s || []); });
        return;
      }
      if (chipAction === 'MICRONEEDLING') {
        var mnFaq = faqMatch('microneedling collagen');
        if (mnFaq) ariaType(mnFaq.r, function(){ showSuggestions(mnFaq.s || []); });
        return;
      }
      if (chipAction === 'BOOSTER') {
        var bsFaq = faqMatch('skin booster pdrn');
        if (bsFaq) ariaType(bsFaq.r, function(){ showSuggestions(bsFaq.s || []); });
        return;
      }
    }

    /* ── 2. Service selection — checked BEFORE FAQ so service names are never hijacked ── */
    if (STATE === 'awaiting_service') {
      /* Allow staff switch mid-selection ("actually book with Priya") */
      var svcStaffKey = matchStaffName(lower);
      if (svcStaffKey) {
        selectedConsultant = svcStaffKey;
        var svcStaff = STAFF_SCHEDULES[svcStaffKey];
        ariaType(
          'Of course! Let me pull up *' + svcStaff.displayName + '\'s* availability.\n\nWhich treatment would you like with ' + svcStaff.firstName + '?',
          function(){
            STATE = 'awaiting_service';
            showSuggestions(['Hydrafacial 💎 $268','Anti-Aging Facial ✨ $188','Deep Cleanse 🌿 $118','See all treatments 💆']);
          }
        );
        return;
      }
      var svc = matchService(lower);
      if (svc) {
        selectedService     = svc.key;
        selectedServiceName = svc.name;
        ariaShowSlots(svc);
        return;
      }
      /* "book" / "yes" when user already named a service earlier in this session */
      if (/\bbook\b|^yes|^sure|^ok|go ahead|proceed|that one|the one/i.test(lower) && selectedService) {
        var stored = null;
        for (var si = 0; si < SERVICES.length; si++) {
          if (SERVICES[si].key === selectedService) { stored = SERVICES[si]; break; }
        }
        if (stored) { ariaShowSlots(stored); return; }
      }
      /* User asked a question while choosing — answer it, then nudge back */
      var faqMid = faqMatch(lower);
      if (faqMid) {
        ariaType(faqMid.r, function(){
          STATE = 'awaiting_service';
          showSuggestions(['Hydrafacial 💎 $268','Anti-Aging Facial ✨ $188','Deep Cleanse 🌿 $118','See all treatments 💆']);
        });
        return;
      }
      if (/pric(e|ing)|cost|how much|fee|rate/i.test(lower)) {
        ariaShowPricing(); return;
      }
      ariaType('Which treatment would you like? Tap one below or type the name 👆', function(){
        STATE = 'awaiting_service';
        showSuggestions(['Hydrafacial 💎 $268','Anti-Aging Facial ✨ $188','Deep Cleanse 🌿 $118','LED Therapy 💡 $148']);
      });
      return;
    }

    /* ── 3. Date selection ── */
    if (STATE === 'awaiting_date') {
      /* Try flexible date+time parse first */
      var slot = matchSlot(lower);
      if (slot && slot.mismatch) {
        ariaType(
          '📅 Quick heads-up — *' + slot.statedDate + '* is actually a *' + slot.actualDay +
          '*, not a ' + slot.statedDay + '!\n\n' +
          'Which did you mean?\n' +
          '• *' + slot.actualDay + ' ' + slot.statedDate + '* at ' + slot.time + ' (the date you said), or\n' +
          '• *' + slot.correctedLabel + '* at ' + slot.time + ' (the day you said)?\n\n' +
          'Tap below to confirm 😊',
          function(){
            STATE = 'awaiting_date';
            showSuggestions([
              slot.actualDay + ' ' + slot.statedDate + ' — ' + slot.time,
              slot.correctedLabel + ' — ' + slot.time
            ]);
          }
        );
        return;
      }
      if (slot) {
        if (!isWithinHours(slot.day, slot.time)) {
          var badDay = slot.day;
          ariaType(hoursRejectMsg(badDay), function(){
            STATE = 'awaiting_date';
            var h = getHoursForDay(badDay);
            /* Include the day in each chip so context is preserved */
            showSuggestions([badDay + ' — ' + h.openStr, badDay + ' — 2:00pm', badDay + ' — ' + h.lastStr]);
          });
          return;
        }
        /* ── Real-time availability simulation ── */
        var chkDay  = slot.day;
        var chkTime = slot.time;
        ariaType('Just checking that slot for you... 🔍', function(){
          STATE = 'awaiting_date';
          setTimeout(function(){
            /* ~20% chance the slot just got taken by another client */
            if (Math.random() < 0.2) {
              var altSlots = getNextSlots(chkDay, chkTime);
              if (altSlots.length === 0) {
                /* Edge case: no forward slots — just confirm it */
                selectedDate = chkDay; selectedTime = chkTime;
                ariaType(
                  '✅ You\'re in luck — *' + chkDay + '* at *' + chkTime + '* is the last slot and it\'s yours! 🎉\n\n👤 Your *full name*\n📱 Your *phone number*',
                  function(){ STATE = 'awaiting_details'; }
                );
              } else {
                ariaType(
                  'Oh no — that slot was *just* booked by another client! 😅\n\n' +
                  'Here are the next available times on *' + chkDay + '*:\n\n' +
                  altSlots.map(function(s){ return '• ' + s.split(' — ')[1]; }).join('\n') + '\n\n' +
                  'Which works for you?',
                  function(){
                    STATE = 'awaiting_date';
                    showSuggestions(altSlots);
                  }
                );
              }
            } else {
              /* Slot is available — proceed to details */
              selectedDate = chkDay;
              selectedTime = chkTime;
              ariaType(
                '✅ *' + chkDay + '* at *' + chkTime + '* is available! 🎉\n\nAlmost there — just need a couple of quick details:\n\n👤 Your *full name*\n📱 Your *phone number*\n\nSend both and I\'ll lock it in instantly ⚡',
                function(){ STATE = 'awaiting_details'; }
              );
            }
          }, 1800);
        });
        return;
      }
      /* Day + specific date but no time (e.g. "saturday 30 june") — validate calendar first */
      var dayDate = matchDayDate(lower);
      if (dayDate) {
        if (dayDate.mismatch) {
          ariaType(
            '📅 Quick heads-up — *' + dayDate.statedDate + '* is actually a *' + dayDate.actualDay +
            '*, not a ' + dayDate.statedDay + '!\n\n' +
            'Which did you mean:\n' +
            '• *' + dayDate.actualDay + ' ' + dayDate.statedDate + '* (the date you said), or\n' +
            '• *' + dayDate.correctedLabel + '* (the day you said)?\n\n' +
            'What time works for you? 😊',
            function(){
              STATE = 'awaiting_date';
              var h1 = getHoursForDay(dayDate.actualDay);
              var h2 = getHoursForDay(dayDate.correctedLabel);
              showSuggestions([
                dayDate.actualDay + ' ' + dayDate.statedDate + ' — ' + h1.openStr,
                dayDate.correctedLabel + ' — ' + h2.openStr
              ]);
            }
          );
        } else {
          var ddH = getHoursForDay(dayDate.dayLabel);
          ariaType('*' + dayDate.dayLabel + '* — great! 😊 What time works for you?\n\n⏰ We\'re open: Mon–Fri 10am–8pm · Sat 9am–7pm · Sun 10am–5pm', function(){
            STATE = 'awaiting_date';
            showSuggestions([dayDate.dayLabel + ' — ' + ddH.openStr, dayDate.dayLabel + ' — 2:00pm', dayDate.dayLabel + ' — ' + ddH.lastStr]);
          });
        }
        return;
      }
      /* User mentioned just a day name with no date — ask for the time */
      var dayMention = extractDayMention(lower);
      if (dayMention) {
        var dmHours = getHoursForDay(dayMention);
        ariaType('*' + dayMention + '* — great! 😊 What time works for you?\n\n⏰ We\'re open: Mon–Fri 10am–8pm · Sat 9am–7pm · Sun 10am–5pm', function(){
          STATE = 'awaiting_date';
          showSuggestions([dayMention + ' — ' + dmHours.openStr, dayMention + ' — 2:00pm', dayMention + ' — ' + dmHours.lastStr]);
        });
        return;
      }
      /* Genuine FAQ question during date step — answer then remind */
      var faqDate = faqMatch(lower);
      if (faqDate) {
        ariaType(faqDate.r, function(){
          STATE = 'awaiting_date';
          setTimeout(function(){
            ariaType('📅 Whenever you\'re ready, just tell me a date and time for your *' + selectedServiceName + '*!', function(){
              STATE = 'awaiting_date';
              showSuggestions(getGenericSlotChips(3));
            });
          }, 600);
        });
        return;
      }
      ariaType('What date and time works for you? Just tell me — any day, any time! 😊\n\nE.g. *"' + getGenericSlotChips(1)[0] + '"* or *"next Friday at 2pm"*', function(){
        STATE = 'awaiting_date';
        showSuggestions(getGenericSlotChips(3));
      });
      return;
    }

    /* ── 4. Details collection — require BOTH name AND phone before confirming ── */
    if (STATE === 'awaiting_details') {
      /* Allow consultant preference mid-details ("I want Dr. Marcus Lee", "can I have Priya") */
      var detStaff = matchStaffName(lower);

      /* Unknown staff name mentioned — redirect to actual team */
      if (!detStaff && /\b(want|have|get|book|prefer|with|see|dr\.?|doctor|would like|can i|could i|i'd like|actually)\b/i.test(lower)) {
        /* Detect a name-like pattern: two capitalised words, or "actually [Word]" */
        var unknownMatch = msg.match(/\b([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15})?)\b/);
        var unknownName  = unknownMatch ? unknownMatch[1] : null;
        /* Only fire if the extracted "name" isn't a known word or staff name */
        var notOurTeam = unknownName && !matchStaffName(unknownName.toLowerCase());
        if (notOurTeam) {
          ariaType(
            'Hmm — I don\'t see *' + unknownName + '* on our team 😊\n\n' +
            'Our consultants are:\n' +
            '👩‍⚕️ *Dr. Sarah Chen* — Botox, Skin Boosters & Injectables (Tue · Thu · Sat)\n' +
            '👨‍⚕️ *Dr. Marcus Lee* — Fillers, Chemical Peels & Injectables (Mon · Wed · Fri · Sun)\n' +
            '💆 *Clara Lim* — Hydrafacial & Anti-Aging Facials (Mon · Wed · Fri · Sat)\n' +
            '💆 *Priya Nair* — Deep Cleanse, LED & Sensitive Skin (Tue · Thu · Fri · Sat)\n\n' +
            'Who would you like to book with?',
            function(){
              STATE = 'awaiting_details';
              showSuggestions(['Dr. Sarah Chen 👩‍⚕️','Dr. Marcus Lee 👨‍⚕️','Clara Lim 💆','Priya Nair 💆']);
            }
          );
          return;
        }
      }

      if (detStaff && /\b(want|have|get|book|prefer|with|see|dr\.?|doctor|would like|can i|could i|i'd like|actually)\b/i.test(lower)) {
        var dsInfo = STAFF_SCHEDULES[detStaff];
        /* Check if they work on the already-selected date */
        var dateDay = selectedDate ? selectedDate.split(' ')[0].toLowerCase() : '';
        var dateDow = CAL_DOW[dateDay];
        var staffWorks = (dateDow !== undefined) && (dsInfo.workingDays.indexOf(dateDow) !== -1);
        if (selectedDate && !staffWorks) {
          /* Staff not in on that day — offer to keep the date with a different consultant or change date */
          ariaType(
            'Hmm — *' + dsInfo.displayName + '* isn\'t in on *' + selectedDate + '* 😔\n\n' +
            'Would you like to:\n' +
            '• Keep *' + selectedDate + '* and I\'ll assign the next available consultant, or\n' +
            '• See ' + dsInfo.firstName + '\'s availability on a different day?',
            function(){
              STATE = 'awaiting_details';
              showSuggestions(['Keep ' + selectedDate + ' ✅', 'See ' + dsInfo.firstName + '\'s dates 📅']);
            }
          );
        } else {
          selectedConsultant = detStaff;
          ariaType(
            '✅ Let me check ' + dsInfo.firstName + '\'s availability... *' + dsInfo.firstName + '* is available on *' + (selectedDate || 'your chosen date') + '* ' + dsInfo.emoji + '\n\n📝 Just need your *full name* and *phone number* to confirm!',
            function(){ STATE = 'awaiting_details'; }
          );
        }
        return;
      }

      /* Handle "Keep [date]" / "See [name]'s dates" chips from staff-unavailable response */
      if (/^keep\b/i.test(lower.trim())) {
        /* User wants to keep the existing date — assign random available consultant */
        if (!selectedConsultant) selectedConsultant = Math.random() < 0.5 ? 'dr.sarah' : 'dr.marcus';
        ariaType('Perfect — keeping *' + selectedDate + '* 😊 Just need your *full name* and *phone number* to confirm!', function(){ STATE = 'awaiting_details'; });
        return;
      }
      if (/^see\b.+\b(dates?|availab|when|schedule)/i.test(lower.trim())) {
        /* User wants to see the consultant's availability — treat as profile request */
        var seeStaff = matchStaffName(lower);
        if (seeStaff) {
          var seeInfo = STAFF_SCHEDULES[seeStaff];
          var seeLive = buildStaffWeek(seeStaff);
          var seeText = seeLive.map(function(d){ return '📅 *' + d.label + '* — ' + d.slots.slice(0,3).join(' · '); }).join('\n');
          ariaType(seeInfo.emoji + ' *' + seeInfo.displayName + '\'s* upcoming availability:\n\n' + seeText + '\n\nWhich date works for you?', function(){
            selectedConsultant = seeStaff;
            STATE = 'awaiting_date';
            showSuggestions(seeLive.slice(0,3).map(function(d){ return d.label + ' — ' + d.slots[0]; }));
          });
          return;
        }
      }

      var detPhone = extractPhone(msg);

      /*
       * If there is NO phone number in the message AND it looks like a question
       * (contains modal verbs, pronouns, question words), treat it as a FAQ query —
       * never extract a name from something like "before this could i get your doctors".
       */
      if (!detPhone && isQuestion(lower)) {
        var midFaq = faqMatch(lower);
        if (midFaq) {
          ariaType(midFaq.r, function(){
            STATE = 'awaiting_details';
            setTimeout(function(){
              ariaType('📝 Whenever you\'re ready, just send your *full name* and *phone number* to confirm your booking!', function(){
                STATE = 'awaiting_details';
              });
            }, 700);
          });
        } else {
          ariaType('Of course — happy to help! 😊\n\n📝 Once you\'re done, just send your *full name* and *phone number* to confirm your booking.', function(){
            STATE = 'awaiting_details';
          });
        }
        return;
      }

      var detName = extractNameOnly(msg);

      /* Accumulate across turns */
      if (detPhone && !partialPhone) partialPhone = detPhone;
      if (detName  && !partialName)  partialName  = detName;

      /* Both collected — upsell step before final confirmation */
      if (partialName && partialPhone) {
        ariaUpsell(partialName, partialPhone);
        return;
      }
      /* Have name, missing phone */
      if (partialName && !partialPhone) {
        ariaType('Thanks *' + partialName.split(' ')[0] + '*! 😊 Could you also share your *phone number* so we can send you a confirmation?', function(){
          STATE = 'awaiting_details';
        });
        return;
      }
      /* Have phone, missing name */
      if (partialPhone && !partialName) {
        ariaType('Got your number! 😊 And your *full name* please?', function(){
          STATE = 'awaiting_details';
        });
        return;
      }
      /* Got neither — prompt for both */
      ariaType('Just your *full name* and *phone number* and we\'re all set! 😊\n\nE.g. *"Sarah Tan, 9123 4567"*', function(){
        STATE = 'awaiting_details';
      });
      return;
    }

    /* ── 4b. Upsell decision ── */
    if (STATE === 'awaiting_upsell') {
      var upsellSvc = UPSELLS[selectedService];
      var wantsAdd  = /\byes\b|sure|add\b|include|sounds good|love|great|ok\b|okay|please|why not|go ahead|perfect|absolutely|definitely/i.test(lower);
      var wantsSkip = /\bno\b|skip|no thanks|nope|pass|without|don't|dont|not today|maybe next|another time|just the|only the/i.test(lower);
      if (wantsAdd) {
        selectedAddOn = upsellSvc ? upsellSvc.name + ' (' + upsellSvc.price + ')' : '';
        ariaType(
          'Amazing — *' + (upsellSvc ? upsellSvc.name : 'add-on') + '* added to your booking! 🎉\n\nOur team will have it ready for you.',
          function(){ ariaConfirmBooking(partialName, partialPhone); }
        );
      } else if (wantsSkip) {
        selectedAddOn = '';
        ariaType('No worries at all! 😊', function(){ ariaConfirmBooking(partialName, partialPhone); });
      } else {
        /* Ambiguous — gently re-ask */
        var reAskName = upsellSvc ? upsellSvc.name : 'the add-on';
        ariaType('Just a yes or no — would you like to add the *' + reAskName + '*?', function(){
          STATE = 'awaiting_upsell';
          showSuggestions([
            'Yes, add it! ✨' + (upsellSvc ? ' ' + upsellSvc.price : ''),
            'No thanks, proceed to confirm'
          ]);
        });
      }
      return;
    }

    /* ── 5. Staff-preference detection — store consultant and show their availability ── */
    var staffKey = matchStaffName(lower);
    if (staffKey && STATE !== 'awaiting_date' && STATE !== 'awaiting_details') {
      selectedConsultant = staffKey;
      var staffInfo = STAFF_SCHEDULES[staffKey];
      var wantsBookWithStaff = /book|appoint|schedul|reserv|availab|slot|see|with/i.test(lower);
      if (wantsBookWithStaff) {
        /* Pre-store date/time if mentioned */
        if (!selectedDate || !selectedTime) {
          var staffPreSlot = matchSlot(lower);
          if (staffPreSlot) { selectedDate = staffPreSlot.day; selectedTime = staffPreSlot.time; }
        }
        ariaType(
          'Of course! 😊 *' + staffInfo.displayName + '* is a wonderful choice.\n\nLet me pull up the treatment menu — which service would you like to book with ' + staffInfo.firstName + '?',
          function(){ ariaShowServices(); }
        );
        return;
      }
      /* Just asking about the consultant — show their profile + availability */
      var liveStaffWeek = buildStaffWeek(staffKey);
      var staffWeekText = liveStaffWeek.map(function(d){
        return '📅 *' + d.label + '* — ' + d.slots.slice(0,3).join(' · ');
      }).join('\n');
      var hisHer = staffInfo.pronoun.charAt(0).toUpperCase() + staffInfo.pronoun.slice(1);
      ariaType(
        staffInfo.emoji + ' *' + staffInfo.displayName + '* — ' + staffInfo.role + '\n\n' +
        '✨ *Specialises in:* ' + staffInfo.treatments + '\n\n' +
        '💡 ' + staffInfo.note + '\n\n' +
        '*' + hisHer + ' upcoming availability:*\n' + staffWeekText + '\n\n' +
        'Would you like to book with ' + staffInfo.firstName + '?',
        function(){
          STATE = 'awaiting_service';
          showSuggestions(['Book with ' + staffInfo.firstName + ' 📅','See all treatments 💆','Pricing 💰']);
        }
      );
      return;
    }

    /* ── 6. Booking & service intent — checked BEFORE FAQ so day/time words never hijack it ── */
    var wantsBook  = /book|appoint|schedul|reserv|availab|slot/i.test(lower);
    var wantsServs = /service|treat|facial|what do|offer|menu|option/i.test(lower);
    /* "yes" / "sure" when waiting for first action = "yes I want to book" */
    var wantsYes   = /^(yes|yeah|yep|sure|ok|okay|please|yup|absolutely|go ahead)\.?$/i.test(lower.trim());

    /* ── 6a. Unknown staff booking request — catch before ariaShowServices swallows it ── */
    if (wantsBook && /\bwith\b/i.test(lower)) {
      var withNameMatch = msg.match(/\bwith\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\b/);
      if (withNameMatch && !matchStaffName(withNameMatch[1].toLowerCase())) {
        var unknownStaffName = withNameMatch[1];
        ariaType(
          'Hmm — I don\'t see *' + unknownStaffName + '* on our team 😊\n\n' +
          'Our consultants are:\n' +
          '👩‍⚕️ *Dr. Sarah Chen* — Botox, Skin Boosters & Injectables (Tue · Thu · Sat)\n' +
          '👨‍⚕️ *Dr. Marcus Lee* — Fillers, Chemical Peels & Injectables (Mon · Wed · Fri · Sun)\n' +
          '💆 *Clara Lim* — Hydrafacial & Anti-Aging Facials (Mon · Wed · Fri · Sat)\n' +
          '💆 *Priya Nair* — Deep Cleanse, LED & Sensitive Skin (Tue · Thu · Fri · Sat)\n\n' +
          'Who would you like to book with?',
          function(){
            STATE = 'awaiting_service';
            showSuggestions(['Dr. Sarah Chen 👩‍⚕️','Dr. Marcus Lee 👨‍⚕️','Clara Lim 💆','Priya Nair 💆']);
          }
        );
        return;
      }
    }

    /* ── 6b. Questions that happen to trigger booking/service words → try FAQ first ── */
    if ((wantsBook || wantsServs) && isQuestion(lower)) {
      var svcFromQ = matchService(lower); /* non-null when a specific service is named */
      var qFaq = faqMatch(lower);
      if (qFaq) {
        ariaType(qFaq.r, function(){
          /* When a specific service was named (e.g. "I want to book a Hydrafacial"),
             set awaiting_service so a typed follow-up service name is actionable */
          if (svcFromQ) STATE = 'awaiting_service';
          showSuggestions((qFaq.s || []).slice(0, 3));
        });
        return;
      }
    }

    if (wantsBook || wantsServs || (wantsYes && (STATE === 'awaiting_first' || STATE === 'ready'))) {
      /* If the user already mentioned a date+time in this same message, pre-store it
         so ariaShowSlots can skip the date question after they pick a service */
      if (!selectedDate || !selectedTime) {
        var preSlot = matchSlot(lower);
        if (preSlot) { selectedDate = preSlot.day; selectedTime = preSlot.time; }
      }
      ariaShowServices();
      return;
    }

    /* ── 6. Pricing free-text shortcut ── */
    if (/pric(e|ing)|cost|how much|fee|rate|expensive|cheap|afford/i.test(lower)) {
      ariaShowPricing();
      return;
    }

    /* ── 7. FAQ — only reached for genuine information questions ── */
    var faq = faqMatch(lower);
    if (faq) {
      faqResponseCount++;
      var addNudge = (faqResponseCount === 3);
      ariaType(faq.r, function(){
        showSuggestions((faq.s || []).slice(0, 3));
        if (addNudge) {
          setTimeout(function(){
            addMessage(
              '<span style="font-size:0.8em;opacity:0.7;display:block;margin-top:4px;">✨ <em>This is Axoncore AI — your business could have Aria running 24/7. <a href="#ax-contact" style="color:#C4B5FD;text-decoration:none;" onclick="document.getElementById(\'ax-demo-overlay\')&&(document.getElementById(\'ax-demo-overlay\').style.display=\'none\')">Want this for your business?</a></em></span>',
              'aria',
              { html: true }
            );
          }, 1200);
        }
      });
      return;
    }

    /* ── 8. Greeting ── */
    var isGreeting = /^(hi+|hello+|hey+|yo|hiya|good\s|morning|afternoon|evening)/i.test(lower);
    if (isGreeting) {
      ariaType('Hey! Welcome to *Lumina Aesthetics* 😊\n\nHow can I help you today?', function(){
        STATE = 'awaiting_first';
        showSuggestions(['Book an appointment 📅','See our treatments 💆','Pricing 💰','Where are you located? 📍']);
      });
      return;
    }

    /* ── 9. Bare date/time mention outside booking flow ── */
    var looseSlot = matchSlot(lower);
    if (looseSlot && !looseSlot.mismatch) {
      if (!isWithinHours(looseSlot.day, looseSlot.time)) {
        ariaType(hoursRejectMsg(looseSlot.day), function(){
          showSuggestions(['Book an appointment 📅','See our hours 🕐','Book now 📅']);
        });
      } else {
        ariaType(
          'It looks like you\'d like to visit on *' + looseSlot.day + '* at *' + looseSlot.time + '*! 😊\n\nWhat treatment would you like to book?',
          function(){
            STATE = 'awaiting_service';
            showSuggestions(['Hydrafacial 💎 $268','Anti-Aging Facial ✨ $188','Deep Cleanse 🌿 $118','Book now 📅']);
          }
        );
      }
      return;
    }

    /* ── 10. Final fallback ── */
    ariaType('Happy to help! What would you like to know? 😊', function(){
      STATE = STATE === 'idle' ? 'awaiting_first' : STATE;
      showSuggestions(['Book an appointment 📅','Pricing 💰','See our treatments 💆','Where are you located? 📍']);
    });
  }

  /* ── Conversation flows ── */
  function ariaGreet() {
    STATE = 'greeting';
    ariaType(
      'Hi there! 👋 Welcome to *Lumina Aesthetics*.\n\nI\'m *Aria*, your AI assistant — available 24/7 to help you book treatments, answer questions about our services, pricing, location, and more.\n\nHow can I help you today? 💜',
      function(){
        STATE = 'awaiting_first';
        showSuggestions(['Book an appointment 📅','See our treatments 💆','Pricing 💰','Where are you located? 📍']);
      }
    );
  }

  function ariaShowServices() {
    var withLine = selectedConsultant && STAFF_SCHEDULES[selectedConsultant]
      ? '\n\n' + STAFF_SCHEDULES[selectedConsultant].emoji + ' Booking with *' + STAFF_SCHEDULES[selectedConsultant].displayName + '*'
      : '';
    ariaType(
      'Here\'s our full treatment menu at *Lumina Aesthetics* ✨' + withLine + '\n\n💎 *Hydrafacial* — $268 | 60 mins\n✨ *Anti-Aging Facial* — $188 | 75 mins\n🌿 *Organic Deep Cleanse* — $118 | 60 mins\n💡 *LED Light Therapy* — $148 | 45 mins\n✨ *Microdermabrasion* — $168 | 45 mins\n⚗️ *Chemical Peel* — from $198 | 60 mins\n🔬 *Microneedling* — $488 | 90 mins\n💉 *Skin Booster (PDRN)* — $688 | 45 mins\n💉 *Botox* — from $380/area | 30 mins\n🩺 *Dermal Consultation* — $88 | 30 mins\n\nWhich one would you like to book? I can check availability right now 🗓️',
      function(){
        STATE = 'awaiting_service';
        showSuggestions(['Hydrafacial 💎 $268','Anti-Aging Facial ✨ $188','Deep Cleanse 🌿 $118','LED Therapy 💡 $148']);
      }
    );
  }

  function ariaShowPricing() {
    ariaType(
      'Here\'s our full pricing at *Lumina Aesthetics* 💜\n\n💎 *Hydrafacial* — $268\n✨ *Anti-Aging Facial* — $188\n🌿 *Organic Deep Cleanse* — $118\n💡 *LED Light Therapy* — $148\n✨ *Microdermabrasion* — $168\n⚗️ *Chemical Peel* — from $198\n🔬 *Microneedling* — $488/session\n💉 *Skin Booster (PDRN)* — $688/session\n💉 *Botox* — from $380/area\n🩺 *Dermal Consultation* — $88 *(redeemable same-day)*\n\n🎁 *New Client Bundle:* any 2 facials for *$268*!\n💳 Atome instalment payment (3× interest-free) available\n\nWould you like to book one of these?',
      function(){
        STATE = 'awaiting_service';
        showSuggestions(['Book Hydrafacial 💎 $268','Book Consultation 🩺 $88','See our treatments 💆']);
      }
    );
  }

  function ariaShowSlots(service) {
    /* ── Validate any pre-stored date/time ── */
    if (selectedDate && selectedTime) {
      if (!isWithinHours(selectedDate, selectedTime)) {
        var rejDay = selectedDate;
        selectedDate = ''; selectedTime = '';
        ariaType(hoursRejectMsg(rejDay), function(){
          STATE = 'awaiting_date';
          var h = getHoursForDay(rejDay);
          /* Include the day name in chips so context is never lost */
          showSuggestions([rejDay + ' — ' + h.openStr, rejDay + ' — 2:00pm', rejDay + ' — ' + h.lastStr]);
        });
        return;
      }
      var withStaff = selectedConsultant ? ' with *' + STAFF_SCHEDULES[selectedConsultant].displayName + '*' : '';
      ariaType(
        'Perfect — *' + service.name + '*' + withStaff + ' on *' + selectedDate + '* at *' + selectedTime + '* 💜\n\n' +
        'Almost done! To confirm your booking please send:\n👤 *Full name*\n📱 *Phone number*',
        function(){ STATE = 'awaiting_details'; }
      );
      return;
    }

    /* ── Consultant-specific availability ── */
    if (selectedConsultant && STAFF_SCHEDULES[selectedConsultant]) {
      var staff    = STAFF_SCHEDULES[selectedConsultant];
      var liveWeek = buildStaffWeek(selectedConsultant);
      var weekText = liveWeek.map(function(d){
        return '📅 *' + d.label + '* — ' + d.slots.join(' · ');
      }).join('\n');
      var firstChips = liveWeek.slice(0,3).map(function(d){
        return d.label + ' — ' + d.slots[0];
      });
      ariaType(
        'Great choice — *' + service.name + '* with *' + staff.displayName + '* 💜\n\n' +
        '*' + staff.firstName + '\'s upcoming availability:*\n\n' + weekText + '\n\n' +
        'Which slot works for you? Or suggest any other date and time 😊',
        function(){
          STATE = 'awaiting_date';
          showSuggestions(firstChips);
        }
      );
      return;
    }

    /* ── Generic availability (live calendar) ── */
    ariaType(
      'Great choice — *' + service.name + '* (' + service.price + ' | ' + service.duration + ') 💜\n\n' +
      '*What date and time works for you?*\nJust tell me — we\'ll make it work! 😊\n\n' +
      '💡 *Some available slots coming up:*\n' +
      getGenericSlotText(4) + '\n\n' +
      'Or suggest your own preferred date and time 👇',
      function(){
        STATE = 'awaiting_date';
        showSuggestions(getGenericSlotChips(3));
      }
    );
  }

  function ariaUpsell(name, phone) {
    var upsell = UPSELLS[selectedService];
    if (!upsell) {
      ariaConfirmBooking(name, phone);
      return;
    }
    STATE = 'awaiting_upsell';
    ariaType(
      '💡 *One quick thing before I confirm!*\n\n' +
      'Clients booking *' + selectedServiceName + '* often add our *' + upsell.name + '* (' + upsell.price + '):\n\n' +
      '✨ ' + upsell.blurb + '\n\n' +
      'Want to include it? It\'ll be ready at your appointment 😊',
      function(){
        STATE = 'awaiting_upsell';
        showSuggestions([
          'Yes, add it! ✨ ' + upsell.price,
          'No thanks, just confirm'
        ]);
      }
    );
  }

  function ariaConfirmBooking(name, phone) {
    STATE = 'confirming';
    partialName = ''; partialPhone = '';

    /* Assign staff based on service type when no consultant was chosen */
    if (!selectedConsultant) {
      var doctorOnlyKeys = ['botox', 'booster', 'microneedl', 'consult'];
      if (doctorOnlyKeys.indexOf(selectedService) !== -1) {
        selectedConsultant = Math.random() < 0.5 ? 'dr.sarah' : 'dr.marcus';
      } else if (selectedService === 'peel') {
        selectedConsultant = Math.random() < 0.5 ? 'dr.marcus' : 'priya';
      } else {
        /* hydrafacial, antiaging, deepcleanse, led, microderm → aestheticians */
        selectedConsultant = Math.random() < 0.5 ? 'clara' : 'priya';
      }
    }
    var consultant = STAFF_SCHEDULES[selectedConsultant];

    /* Step 1: thank-you holding message */
    ariaType(
      'Thank you *' + name.split(' ')[0] + '*! 😊 Just a moment while I confirm everything with our team...',
      function(){
        STATE = 'confirming';
        /* Step 2: booking confirmed message after 2 seconds */
        setTimeout(function(){
          var addOnLine = selectedAddOn ? '\n💊 *Add-on:* ' + selectedAddOn : '';
          ariaType(
            '🎉 *Booking Confirmed!*\n\nYou\'re all set! Here\'s your summary:\n\n🏥 *Lumina Aesthetics*\n' +
            consultant.emoji + ' *' + consultant.displayName + '* (' + consultant.role + ')\n' +
            '💆 *' + selectedServiceName + '*' + addOnLine + '\n' +
            '📅 *' + selectedDate + ' — ' + selectedTime + '*\n' +
            '📱 *' + phone + '*\n' +
            '📍 12 Orchard Blvd, #05-01, Singapore\n\n' +
            'A confirmation SMS has been sent to *' + phone + '*. We can\'t wait to see you! 💜\n\n— Aria',
            function(){
              STATE = 'confirmed';
              document.getElementById('ax-confirm-service').textContent     = selectedServiceName;
              document.getElementById('ax-confirm-datetime').textContent    = selectedDate + ' — ' + selectedTime;
              document.getElementById('ax-confirm-consultant').textContent  = consultant.displayName;
              document.getElementById('ax-confirm-name').textContent        = name;
              var addonRow = document.getElementById('ax-confirm-addon-row');
              if (selectedAddOn) {
                document.getElementById('ax-confirm-addon').textContent = selectedAddOn;
                addonRow.style.display = '';
              } else {
                addonRow.style.display = 'none';
              }
              /* Step 3: show overlay card after 2 more seconds */
              setTimeout(function(){ overlay.style.display = 'flex'; }, 2000);
            }
          );
        }, 2000);
      }
    );
  }

  /* ── Public reset ── */
  window.axDemoReset = function() {
    STATE = 'idle';
    faqResponseCount = 0;
    selectedService = selectedServiceName = selectedDate = selectedTime = '';
    selectedConsultant = ''; selectedAddOn = '';
    partialName = ''; partialPhone = '';
    chat.innerHTML = '';
    clearSuggestions();
    inputEl.value = '';
    hideTyping();
    setTimeout(function(){ ariaGreet(); }, 300);
  };

})();
