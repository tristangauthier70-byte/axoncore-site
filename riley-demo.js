/* ═══════════════════════════════════════════════════════════════
   riley-demo.js — Interactive Riley chat for riley.html
   Simulates Riley's real qualification + recommendation flow.
   NO external API calls — all local, instant, no latency.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var STATE = 'idle'; // idle → greet → qualify_channel → qualify_volume → recommend → book
  var CHANNEL_HINT = '';  // 'phone' | 'chat' | 'omni'
  var VOLUME_HINT  = '';  // 'lite' | 'standard' | 'pro'
  var USER_NAME    = '';

  /* Retry/escalation counters — let the bot handle repeated "I don't know" /
     repeated "yes please, book me" without ever asking the exact same
     question twice in a row (see handleUncertain() and the fast-track
     branch in respond()). */
  var UNCERTAIN_COUNT = 0;
  var UNCERTAIN_STATE = '';
  var FASTTRACK_COUNT = 0;
  var DECLINE_COUNT   = 0;

  /* ── Package data (matches CLAUDE.md pricing) ───────────────── */
  var PACKAGES = {
    phone: {
      A_lite:     { name: 'AI Phone System — Lite',     setup: '$599', monthly: '$145', mins: '300 mins/mo' },
      A_standard: { name: 'AI Phone System — Standard', setup: '$599', monthly: '$250', mins: '600 mins/mo' },
      A_pro:      { name: 'AI Phone System — Pro',      setup: '$599', monthly: '$450', mins: '1,200 mins/mo' }
    },
    chat: {
      B_lite:     { name: 'Conversion System — Lite',     setup: '$999', monthly: '$600', mins: '300 mins/mo' },
      B_standard: { name: 'Conversion System — Standard', setup: '$999', monthly: '$705', mins: '600 mins/mo' },
      B_pro:      { name: 'Conversion System — Pro',      setup: '$999', monthly: '$905', mins: '1,200 mins/mo' }
    },
    omni: {
      C_lite:     { name: 'Omnichannel Front Desk — Lite',     setup: '$1,399', monthly: '$899',   mins: '300 mins/mo' },
      C_standard: { name: 'Omnichannel Front Desk — Standard', setup: '$1,399', monthly: '$1,199', mins: '600 mins/mo' },
      C_pro:      { name: 'Omnichannel Front Desk — Pro',      setup: '$1,399', monthly: '$1,399', mins: '1,200 mins/mo' }
    }
  };

  /* ── DOM refs ───────────────────────────────────────────────── */
  var msgContainer = document.getElementById('rp-messages');
  var inputEl      = document.getElementById('rp-phone-input');
  var sendBtn      = document.getElementById('rp-phone-send');
  var confirmEl    = document.querySelector('.rp-phone__confirm');

  if (!msgContainer || !inputEl || !sendBtn) return; // page not loaded yet

  /* ── Init ───────────────────────────────────────────────────── */
  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleSend(); });

  // Auto-greet after 1.2s
  setTimeout(function () {
    addMsg('riley', "Hi, I'm *Riley* — Axon Core's AI receptionist. I answer calls, qualify leads, and book appointments 24/7.\n\nWhat kind of business do you run?");
    STATE = 'greet';
    setInput(true);
  }, 1200);

  /* ── Send handler ───────────────────────────────────────────── */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || STATE === 'typing') return;
    inputEl.value = '';
    addMsg('caller', text);
    setTimeout(function () { respond(text.toLowerCase()); }, 600);
  }

  /* ── Response router ────────────────────────────────────────── */
  function respond(txt) {
    var normTxt = normalizeTypos(txt);

    /* Uncertainty / "I don't know" handling — MUST run before the
       affirmative/booking intercept below. Words like "sure" are whole
       words inside "not sure", so a plain affirmative-word match (even
       with word boundaries) would still misread "I'm not sure" as
       enthusiastic consent to book. Checking negation/uncertainty first
       is what actually prevents that misfire (this was the root cause of
       the reported infinite loop).

       Exception: at qualify_volume, a literal number is a stronger,
       unambiguous signal than a hedge phrase — "not sure, maybe 100" is
       a real volume answer (100/mo), not genuine uncertainty. Only skip
       the uncertain-branch when we're actually waiting on a number AND
       one is present in the reply; every other state/case is unaffected.

       Second exception, generalized to every state: a message can contain
       an uncertainty phrase AND be a genuine, answerable FAQ question at
       the same time — "I have no idea how much this costs" or "not sure
       if this is even real" are real questions about price / whether
       Riley is really AI, not requests for reassurance. A more specific
       signal (an actual FAQ keyword) should win over the generic
       uncertainty heuristic here too, exactly like the digit case above —
       so also skip handleUncertain() whenever the FAQ intercepts below
       would recognize the message, and let them answer it instead. */
    var isDigitAnswerAtVolume = STATE === 'qualify_volume' && /\d/.test(txt);
    var hasFaqIntent = matchesFaqKeywords(txt);
    if (isUncertain(normTxt) && !isDigitAnswerAtVolume && !hasFaqIntent) {
      return handleUncertain();
    }

    /* Universal FAQ intercepts — these never collide with a pending
       qualifying answer (no channel/volume/business-type reply plausibly
       contains "how much does this cost" or "are you a real AI"), so they
       stay ahead of the state machine at every state. Word lists live in
       FAQ_PRICE_WORDS / FAQ_HOWITWORKS_WORDS / FAQ_REALAI_WORDS (defined
       near matchesFaqKeywords()) so the isUncertain() bypass above checks
       the exact same lists these intercepts use. */
    if (matchAny(txt, FAQ_PRICE_WORDS)) {
      if (STATE === 'recommend' || STATE === 'book') {
        /* Price was already shown in the recommendation — a confused
           follow-up here ("I have no idea how much this costs") needs the
           actual number restated, not the pre-qualification "I'll get to
           pricing once I know your setup" deferral, which would be untrue
           (setup is already known) and would ignore the real question. */
        var faqPkg = getPackage();
        return riley("To recap — the *" + faqPkg.name + "* is " + faqPkg.setup + " setup (one-time) plus " + faqPkg.monthly + "/mo, including " + faqPkg.mins + ", on our 36-month founding-rate agreement. Want me to lock in that free strategy call so we can walk through it together?");
      }
      return riley("Happy to get you exact numbers — I just need your setup first so I quote the right package, not a generic one. Takes 30 seconds. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_HOWITWORKS_WORDS)) {
      return riley("I'm an AI trained on your specific business — your FAQs, pricing, services. When a client calls or messages:\n\n• I answer instantly, 24/7\n• I qualify them in 2 questions\n• I book the appointment automatically\n\nNo hold music. No missed calls. No humans needed. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_REALAI_WORDS)) {
      return riley("100% real AI — not a human, not a recording. The same technology answers your actual clients' calls every day. This exact conversation is what your callers experience.\n\n" + nextPrompt());
    }

    /* State machine — runs BEFORE the generic book/interested/yes/sure
       fast-track intercept for states where a specific qualifying
       question is pending (greet / qualify_channel / qualify_volume). A
       literal answer to "how do clients reach you?" — even the single
       word "call", or "phone call", or "I run a call center" — must be
       classified as that answer first; the fast-track heuristic is only
       a genuine FALLBACK once nothing state-specific claims the input
       (checked inside qualify_channel/qualify_volume below), or the
       first-line check for states with no pending question at all
       (idle / recommend / book, handled further down). This is what
       fixes the "call"/"phone call"/"I run a call center" hijack bug:
       previously the intercept ran unconditionally before any of this. */

    if (STATE === 'greet') {
      /* Extract name if they introduced themselves. Greet has no
         content-based classifier of its own (any reply is accepted as
         "business type") so there's nothing for a fast-track heuristic
         to compete with — always proceed. This also means a reply like
         "I run a call center" can never be misrouted into the fast-track
         branch, since we don't consult that word list here at all. */
      var nameMatch = txt.match(/(?:i'm|i am|my name is|name's)\s+([a-z]+)/i);
      if (nameMatch) USER_NAME = cap(nameMatch[1]);
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      if (matchAny(txt, ['phone','call','ring','voice','number'])) {
        CHANNEL_HINT = 'phone';
        return qualifyVolume();
      }
      if (matchAny(txt, ['whatsapp','instagram','facebook','social','tiktok','all','every','omni','multiple','mix'])) {
        CHANNEL_HINT = 'omni';
        return qualifyVolume();
      }
      if (matchAny(txt, ['chat','website','web','message','online','email'])) {
        CHANNEL_HINT = 'chat';
        return qualifyVolume();
      }
      /* No literal channel word found — only NOW consider the generic
         fast-track intercept (book/interested/yes/sure/etc.) as a
         fallback, then finally assume omni if truly unclear. */
      if (fastTrackIntercept(txt)) return;
      CHANNEL_HINT = 'omni';
      return qualifyVolume();
    }

    if (STATE === 'qualify_volume') {
      var num = parseInt(txt.replace(/[^0-9]/g, ''), 10);
      var hasNum = !isNaN(num);
      var liteWord = matchAny(txt, ['few','small','low','quiet','not many','10','20','30','40','50','60','70','80','90','100']);
      var proWord  = matchAny(txt, ['lots','many','busy','high','hundreds','over 200','250','300','400','500']);
      if ((hasNum && num < 120) || liteWord) {
        VOLUME_HINT = 'lite';
        return recommend();
      }
      if ((hasNum && num >= 250) || proWord) {
        VOLUME_HINT = 'pro';
        return recommend();
      }
      if (hasNum) {
        /* A genuine number was given (e.g. "150 a month") — that's a
           real signal, not an unclear answer, even though it lands in
           the standard band. Classify it directly rather than falling
           through to the fast-track fallback below. */
        VOLUME_HINT = 'standard';
        return recommend();
      }
      /* No number and no lite/pro keyword — only now consider the
         generic fast-track intercept as a fallback, then default to
         standard if truly unclear. */
      if (fastTrackIntercept(txt)) return;
      VOLUME_HINT = 'standard';
      return recommend();
    }

    /* idle has no pending qualifying question — the fast-track intercept
       is safe to check first here since there's nothing state-specific
       competing for the same words. */
    if (STATE === 'idle') {
      if (fastTrackIntercept(txt)) return;
    }

    /* recommend/book: booking must be an OPT-IN outcome. There is no
       "default to booking" path any more — every reply here is routed
       through handleRecommendOrBookReply(), which requires a genuine,
       recognizable affirmative before ever calling showBooking(). This
       replaces the old `if (STATE === 'recommend') return showBooking();`
       unconditional fallback, which was the root cause of decline phrases
       like "no thanks" / "not interested" / "maybe later" auto-booking —
       "not interested" in particular contains the word "interested",
       which is in the affirmative list, so that fallback read an explicit
       decline as consent. Decline detection now runs BEFORE the
       affirmative check specifically so that case can never recur. */
    if (STATE === 'recommend' || STATE === 'book') {
      return handleRecommendOrBookReply(txt);
    }

    /* Fallback */
    riley("Got it. " + nextPrompt());
  }

  /* ── Generic "sounds like they want to book" fallback ──────────
     Only ever called (a) as the first-line check for idle, where no
     qualifying question is pending, or (b) as a fallback from inside
     qualify_channel/qualify_volume after a literal channel/volume answer
     has already failed to match. Returns true if it handled the reply
     (and already sent a riley() message), false if it didn't match
     anything and the caller should keep going.

     NOTE: this no longer handles recommend/book state at all — that's
     handleRecommendOrBookReply()'s job now, since booking must go
     through an explicit decline-then-affirmative gate, not this generic
     word match. BOOKING_AFFIRM_WORDS is the single shared list both
     functions consult, so "what counts as consent" can't drift between
     the two call sites. */
  function fastTrackIntercept(txt) {
    if (!matchAny(txt, BOOKING_AFFIRM_WORDS)) {
      return false;
    }
    if (STATE === 'qualify_channel' || STATE === 'qualify_volume') {
      /* Vary the line if this fires more than once so the bot never
         repeats itself verbatim in a realistic conversation. Mirrors
         handleUncertain()'s escalation: a caller who just keeps saying
         "yes"/"sure"/"great" instead of naming a real channel/volume
         (confirmed to happen — a real user's transcript hit this exact
         pattern) would otherwise lock onto the last rotating line and
         repeat it forever, never reaching a recommendation. Once every
         rotating line has been shown once, stop asking and assume a
         sensible default so the conversation keeps moving. */
      if (FASTTRACK_COUNT >= 3) {
        if (STATE === 'qualify_channel') {
          CHANNEL_HINT = CHANNEL_HINT || 'omni';
          qualifyVolume();
        } else {
          VOLUME_HINT = VOLUME_HINT || 'standard';
          recommend();
        }
        return true;
      }
      var lines = [
        "Glad to hear it — let's make sure we get you the right fit. Two quick questions first. ",
        "Appreciate that — just one more thing so I recommend the right fit. ",
        "Great, let's lock this in — one last detail first. "
      ];
      var line = lines[Math.min(FASTTRACK_COUNT, lines.length - 1)];
      FASTTRACK_COUNT++;
      riley(line + nextPrompt());
      return true;
    }
    /* Unexpected/transient state (e.g. still 'idle') — don't reference
       "2 quick questions" since qualification may already be done. */
    riley("Great — let's get you sorted. " + nextPrompt());
    return true;
  }

  /* ── Booking consent gate (recommend / book) ─────────────────────
     This is the ONLY place showBooking() gets called from recommend/book
     state. There is deliberately no catch-all "anything else -> book"
     branch anywhere else — booking is opt-in, and the only way in is a
     genuine affirmative match. Order matters: decline detection runs
     BEFORE the affirmative check, because "not interested" literally
     contains the word "interested" (one of the affirmative words) — if
     the affirmative check ran first, an explicit decline would read as
     consent. Anything that's neither a recognized decline nor a
     recognized affirmative (a hedge, or genuinely unrecognized text)
     gets a graceful, low-pressure, NON-booking response instead. */
  var DECLINE_PHRASES = [
    'no thanks', 'no thank you', 'not interested', 'not for me',
    'not right now', 'not now', 'maybe later', 'later maybe',
    'think about it', "i'll think", 'need to check', 'check with',
    'get back to you', 'not today', 'rather not', 'no for now',
    'pass for now', 'not ready'
  ];
  var DECLINE_WORDS = ['no', 'nah', 'nope', 'negative'];
  function isDecline(txt) {
    return matchAny(txt, DECLINE_PHRASES) || matchAny(txt, DECLINE_WORDS);
  }
  /* Shared with fastTrackIntercept() so "what counts as consent" is
     defined in exactly one place. */
  var BOOKING_AFFIRM_WORDS = ['book','schedule','talk','call','interested','yes','sure','sounds good','let\'s go','great'];

  /* A plain matchAny() against BOOKING_AFFIRM_WORDS isn't enough here:
     "I don't want to book anything" contains "book" (an affirmative
     word) but is obviously a decline, not consent — the naive word-list
     match would misfire exactly like the original "not interested" bug.
     isAffirmativeConsent() checks the ~4 words immediately before each
     affirmative-word match for a preceding negation ("not"/"don't"/
     "never"/etc.); a match only counts as real consent if nothing in
     that window negates it. This is the ONLY affirmative check used to
     gate showBooking() from recommend/book — fastTrackIntercept()'s
     plain matchAny() is fine to leave as-is since it never calls
     showBooking() (it only asks the next qualifying question or gives
     an encouraging nudge), so a false positive there carries no
     unconsented-booking risk. */
  var NEGATION_WORDS_RE = /\b(not|no|never|don't|dont|do not|won't|wont|can't|cant|didn't|didnt|isn't|isnt|ain't|aint)\b/i;
  function isAffirmativeConsent(txt) {
    return BOOKING_AFFIRM_WORDS.some(function (w) {
      var re = new RegExp('\\b' + escapeRegex(w) + '\\b', 'i');
      var m = re.exec(txt);
      if (!m) return false;
      var before = txt.slice(0, m.index).trim();
      var windowWords = before.length ? before.split(/\s+/).slice(-4).join(' ') : '';
      return !NEGATION_WORDS_RE.test(windowWords);
    });
  }

  function handleRecommendOrBookReply(txt) {
    if (STATE === 'book') {
      /* Booking already completed. A decline here can't un-book anything
         (nothing to gate) — just acknowledge it warmly rather than
         funneling it into the generic "you're all set" line. An
         affirmative here is harmless/idempotent (just replays the
         confirmation), never a fresh unconsented booking. */
      if (isDecline(txt)) {
        return riley("That's already locked in on our end — if plans change, just let us know at hello@axoncoreai.com. Anything else I can help with?");
      }
      if (isAffirmativeConsent(txt)) {
        return showBooking();
      }
      return riley("You're all set — check your inbox for the confirmation. Anything else I can help with before then?");
    }

    /* STATE === 'recommend' */
    if (isDecline(txt)) {
      return handleDecline();
    }
    if (isAffirmativeConsent(txt)) {
      return showBooking();
    }
    /* Neither a recognized decline nor a recognized affirmative — hedge
       or unrecognized text. Restate the offer without pressure; do NOT
       book, do NOT change state. */
    return riley("Of course. Happy to answer anything else, or whenever you're ready, just say the word and I'll lock in that free 30-minute strategy call. " + nextPrompt());
  }

  /* Warm, rotating decline acknowledgement — never books, never changes
     state. Rotates like fastTrackIntercept()'s lines so a prospect who
     declines more than once doesn't see the same sentence twice. */
  function handleDecline() {
    var lines = [
      "No worries at all — the offer's always open if you change your mind. Anything else I can help clarify?",
      "Understood — no pressure at all. The free strategy call offer stands whenever you're ready — just ask.",
      "Sure thing — take whatever time you need. I'm happy to answer any other questions about the setup or pricing."
    ];
    var line = lines[Math.min(DECLINE_COUNT, lines.length - 1)];
    DECLINE_COUNT++;
    return riley(line);
  }

  /* ── Uncertainty handling ───────────────────────────────────── */
  /* Escalates from "reassure + offer concrete examples" to "assume a
     sensible default and move the conversation forward" so a genuinely
     unsure caller is never asked the exact same question a third time
     (that loop is what a real prospect hit — see bug report). Mirrors
     Riley's real voice-agent rule: after hesitation, always continue. */
  function handleUncertain() {
    if (UNCERTAIN_STATE !== STATE) { UNCERTAIN_STATE = STATE; UNCERTAIN_COUNT = 0; }
    UNCERTAIN_COUNT++;

    if (STATE === 'greet') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("No worries — could be a restaurant, salon, clinic, real estate agency, anything client-facing. What's closest?");
      }
      /* Still unsure on the second try — move on with a general/unknown
         business assumption instead of looping a third time. */
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("No problem — even a rough idea helps. Mostly phone calls, website messages, or social media like WhatsApp/Instagram/Facebook?");
      }
      CHANNEL_HINT = CHANNEL_HINT || 'omni';
      return qualifyVolume();
    }

    if (STATE === 'qualify_volume') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("No stress — a ballpark is fine. Under 100 a month, a few hundred, or more than that?");
      }
      VOLUME_HINT = VOLUME_HINT || 'standard';
      return recommend();
    }

    if (STATE === 'recommend' || STATE === 'book') {
      /* Hesitation here is NOT consent to book. showBooking() must only
         ever fire from a genuine affirmative — handleRecommendOrBookReply()
         (called from respond(), not from here) is the only path to
         showBooking(), and it requires an explicit affirmative match.
         Auto-booking on a hedge like plain "not sure" (or, before fix #1
         above, a confused price question) would fabricate consent the
         user never gave. Riley's real "after hesitation, always continue"
         rule means keep the conversation moving forward with a
         reassuring, low-pressure nudge — it deliberately does NOT
         transition state into booking, so STATE stays exactly as it was.

         Rotates across 2-3 phrasings (same pattern as
         fastTrackIntercept()'s lines) so a prospect who hesitates more
         than once doesn't see the exact same sentence twice. */
      var hedgeLines = [
        "No pressure at all — totally your call. Whenever you're ready, just say the word and I'll lock in that free 30-minute strategy call for you. No obligation either way.",
        "Take your time — there's no rush at all. Just let me know whenever you'd like that free strategy call and I'll get it locked in.",
        "Totally fine to sit with it a bit longer. The free 30-minute strategy call offer isn't going anywhere whenever you're ready."
      ];
      var hedgeLine = hedgeLines[Math.min(UNCERTAIN_COUNT - 1, hedgeLines.length - 1)];
      return riley(hedgeLine);
    }

    return riley("That's alright, we'll figure it out together. " + nextPrompt());
  }

  /* ── Conversation steps ─────────────────────────────────────── */
  function qualifyChannel() {
    STATE = 'qualify_channel';
    riley((USER_NAME ? 'Nice to meet you, ' + USER_NAME + '! ' : 'Got it. ') + "Quick question — how do clients usually reach you? *Phone calls*, *website chat*, *WhatsApp / Instagram / Facebook*, or a mix of all of them?");
  }

  function qualifyVolume() {
    STATE = 'qualify_volume';
    var channelLabel = CHANNEL_HINT === 'phone' ? 'calls' : CHANNEL_HINT === 'chat' ? 'website messages' : 'enquiries across your channels';
    riley("Got it. And roughly how many " + channelLabel + " does your business handle in a typical month?");
  }

  function recommend() {
    STATE = 'recommend';
    var pkg = getPackage();
    riley("Based on what you've told me, I'd recommend our *" + pkg.name + "*.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "/mo\n• Includes: " + pkg.mins + "\n• 36-month agreement · Founding client rate\n\nThis covers " + channelCopy() + " — all handled automatically by your AI, 24/7. Want me to book you a free 30-minute strategy call with Tristan to get you live in 14 days?");
  }

  function showBooking() {
    STATE = 'book';
    riley("Perfect — locking that in for you now.", function () {
      setTimeout(function () {
        if (confirmEl) {
          /* Swap in a strategy call confirmation */
          var titleEl = confirmEl.querySelector('.rp-confirm__title');
          var subEl   = confirmEl.querySelector('.rp-confirm__sub');
          var rows    = confirmEl.querySelectorAll('.rp-confirm__row');
          if (titleEl) titleEl.textContent = 'CALL BOOKED ✓';
          if (subEl)   subEl.textContent   = 'Tristan will walk you through your custom setup.';
          if (rows[0]) rows[0].querySelector('.rp-confirm__val').textContent = USER_NAME || 'You';
          if (rows[1]) rows[1].querySelector('.rp-confirm__val').textContent = '30-min Strategy Call';
          if (rows[2]) rows[2].querySelector('.rp-confirm__val').textContent = 'hello@axoncoreai.com';
          if (rows[3]) { rows[3].querySelector('.rp-confirm__val').textContent = 'Confirmed ✓'; rows[3].querySelector('.rp-confirm__val').style.color = '#4ade80'; }
          confirmEl.classList.add('visible');
          launchConfetti();
        }
        setInput(false);
      }, 800);
    });
  }

  /* ── Riley typing then message ──────────────────────────────── */
  function riley(text, cb) {
    /* Capture whatever STATE actually is at call time, BEFORE it gets
       overwritten to 'typing' below. Callers like qualifyChannel() /
       qualifyVolume() / showBooking() already set STATE immediately
       before calling riley(), so capturing "whatever STATE is right now"
       naturally preserves their intended value too. This fixes the bug
       where FAQ-intercept branches in respond() (price/how-it-works/
       real/fast-track) called riley() without re-asserting state first —
       previously that silently reset STATE to 'idle' once the message
       finished typing, permanently derailing the conversation. */
    var stateBeforeTyping = STATE;
    STATE = 'typing';
    setInput(false);
    showTyping();
    var delay = Math.min(500 + text.length * 14, 2200);
    setTimeout(function () {
      hideTyping();
      addMsg('riley', text);
      STATE = STATE === 'typing' ? stateBeforeTyping : STATE;
      setInput(true);
      if (cb) cb();
    }, delay);
  }

  /* ── Typing indicator ───────────────────────────────────────── */
  function showTyping() {
    var existing = document.getElementById('rp-typing');
    if (existing) return;
    var div = document.createElement('div');
    div.id = 'rp-typing';
    div.className = 'rp-bubble rp-bubble--riley rp-bubble--typing';
    div.innerHTML = '<span class="rp-typing-dot"></span><span class="rp-typing-dot"></span><span class="rp-typing-dot"></span>';
    div.style.opacity = '0';
    div.style.transform = 'translateY(10px)';
    msgContainer.appendChild(div);
    scroll();
    requestAnimationFrame(function () {
      div.style.transition = 'opacity 0.2s, transform 0.2s';
      div.style.opacity = '1';
      div.style.transform = 'translateY(0)';
    });
  }
  function hideTyping() {
    var el = document.getElementById('rp-typing');
    if (el) el.remove();
  }

  /* ── Add bubble ─────────────────────────────────────────────── */
  function addMsg(speaker, text) {
    var div = document.createElement('div');
    div.className = 'rp-bubble rp-bubble--' + speaker;
    /* Bold *text* */
    div.innerHTML = escHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    div.style.opacity = '0';
    div.style.transform = 'translateY(10px) scale(0.96)';
    msgContainer.appendChild(div);
    scroll();
    requestAnimationFrame(function () {
      div.style.transition = 'opacity 0.3s cubic-bezier(0.34,1.56,0.64,1), transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
      div.style.opacity = '1';
      div.style.transform = 'translateY(0) scale(1)';
    });
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function scroll() {
    setTimeout(function () { msgContainer.scrollTop = msgContainer.scrollHeight; }, 50);
  }
  function setInput(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    /* preventScroll: true — THIS IS THE FIX for "scroll jumps to the bottom
       on its own ~2s after page load." setInput(true) fires from the
       auto-greet timer 1.2s after this script loads, completely unprompted
       by the visitor. #rp-phone-input lives far down the page (section 4b,
       "Try it yourself"), so a bare .focus() made the browser silently
       invoke its native "scroll focused element into view" behavior on a
       section nobody asked to see — confirmed via instrumented Playwright
       trace: focus() fires, then scrollY climbs from 0 toward that input's
       position over the next ~900ms with zero user input. preventScroll
       keeps the input ready to type into (unchanged behavior for the
       normal case where the visitor already has this section in view)
       without hijacking the viewport for everyone else. */
    if (enabled) inputEl.focus({ preventScroll: true });
    inputEl.placeholder = enabled ? 'Message Riley…' : 'Riley is typing…';
  }
  /* Word-boundary match instead of raw substring search — plain
     indexOf() let short common words like "sure"/"yes"/"ai"/"call" false-
     positive as substrings of unrelated words/phrases (e.g. "sure" would
     also "match" inside "not sure", "unsurely", etc.). \b still matches
     "sure" as a standalone word inside "not sure" — that specific case is
     handled by checking isUncertain() first in respond(), not by this
     function alone. */
  function matchAny(txt, words) {
    return words.some(function (w) {
      return new RegExp('\\b' + escapeRegex(w) + '\\b', 'i').test(txt);
    });
  }
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  /* Lightweight common-typo tolerance — e.g. "njo" was a real user typo
     for "no" in the reported transcript ("i have njo clue"). Only
     normalizes this specific text used for uncertainty detection; the
     original txt passed to matchAny()/the state machine is untouched. */
  function normalizeTypos(txt) {
    return txt.replace(/\bnjo\b/g, 'no');
  }
  /* Negation/uncertainty detection — deliberately checked BEFORE the
     affirmative "book/interested/yes/sure" list in respond(), since
     phrases like "I'm not sure" or "I have no clue" contain "sure" as a
     genuine standalone word and would otherwise be misread as consent. */
  var UNCERTAIN_PHRASES = [
    'not sure', 'unsure', "don't know", 'dont know', 'not know', 'no idea',
    'no clue', 'not certain', 'not really sure'
  ];
  function isUncertain(txt) {
    return matchAny(txt, UNCERTAIN_PHRASES);
  }
  /* FAQ keyword lists, pulled out of the intercepts in respond() so the
     isUncertain() bypass above can check the exact same lists. A message
     containing an uncertainty phrase can still be a genuine, answerable
     FAQ question ("I have no idea how much this costs", "not sure if
     this is even real") — matchesFaqKeywords() lets respond() detect that
     and skip handleUncertain() in favor of actually answering it. */
  var FAQ_PRICE_WORDS = ['price', 'cost', 'how much', 'pricing', 'sgd', 'dollar'];
  var FAQ_HOWITWORKS_WORDS = ['how does it work', 'how do you work', 'what do you do', 'capabilities', 'can you do', 'features'];
  var FAQ_REALAI_WORDS = [
    'ai', 'bot', 'robot', 'fake', 'are you real', 'are you human',
    'are you a human', 'are you a bot', 'are you a robot', 'is this real',
    'is this a bot', 'real ai', 'actual human', 'real person',
    'talking to a bot', 'talking to a human', 'even real', 'actually real'
  ];
  function matchesFaqKeywords(txt) {
    return matchAny(txt, FAQ_PRICE_WORDS) || matchAny(txt, FAQ_HOWITWORKS_WORDS) || matchAny(txt, FAQ_REALAI_WORDS);
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function nextPrompt() {
    if (STATE === 'greet')           return 'What kind of business do you run?';
    if (STATE === 'qualify_channel') return 'How do clients usually reach you?';
    if (STATE === 'qualify_volume')  return 'How many enquiries per month?';
    return 'Ready to see what this looks like for your business?';
  }
  function getPackage() {
    var ch  = CHANNEL_HINT  || 'omni';
    var vol = VOLUME_HINT   || 'standard';
    var map = { phone: { lite:'A_lite', standard:'A_standard', pro:'A_pro' },
                chat:  { lite:'B_lite', standard:'B_standard', pro:'B_pro' },
                omni:  { lite:'C_lite', standard:'C_standard', pro:'C_pro' } };
    return PACKAGES[ch][map[ch][vol]];
  }
  function channelCopy() {
    if (CHANNEL_HINT === 'phone') return 'phone calls 24/7';
    if (CHANNEL_HINT === 'chat')  return 'phone + website chat';
    return 'phone, website chat, WhatsApp, Instagram & Facebook';
  }

  /* ── Confetti ───────────────────────────────────────────────── */
  function launchConfetti() {
    var phone = document.querySelector('.rp-phone');
    if (!phone) return;
    var colors = ['#7c3aed','#a78bfa','#4ade80','#fbbf24','#f472b6'];
    for (var i = 0; i < 20; i++) {
      (function (i) {
        setTimeout(function () {
          var el = document.createElement('div');
          el.className = 'rp-confetti';
          el.style.cssText = 'left:' + (15+Math.random()*70) + '%;top:' + (10+Math.random()*50) + '%;background:' + colors[i%5] + ';width:' + (5+Math.random()*5) + 'px;height:' + (5+Math.random()*5) + 'px;animation-duration:' + (0.6+Math.random()*0.5) + 's';
          phone.appendChild(el);
          setTimeout(function () { el.remove(); }, 1200);
        }, i * 50);
      })(i);
    }
  }

})();
