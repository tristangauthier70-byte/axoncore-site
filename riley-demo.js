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

  /* "Comprehension" state (dialogue spec v2, Section 2.1) — plain
     module-scope vars, set once captured, never reset (a single demo
     session doesn't loop back through greet/qualify_channel/qualify_volume,
     so there's nothing to reset between). */
  var VOLUME_NUMBER = null;  // integer or null — the actual monthly number given, if any
  var BUSINESS_TYPE  = '';   // 'restaurant'|'salon'|'clinic'|'realestate'|'legal'|'other'|''
  var BUSINESS_RAW   = '';   // user's own noun phrase for their business, verbatim, if captured
  var CHANNEL_RAW    = '';   // specific channel term user actually used, if more specific than the bucket

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
    addMsg('riley', "I'm Riley — Axon Core's AI receptionist. I handle inbound calls and messages, qualify the lead, and book the appointment, end to end, with no human in the loop.\n\nWhat's the business?");
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
        return riley("*" + faqPkg.name + "*: " + faqPkg.setup + " setup, " + faqPkg.monthly + "/mo, " + faqPkg.mins + " included, 36-month founding-client rate. I can lock in the strategy call now — want that?");
      }
      return riley("Exact numbers need your setup first — otherwise I'm quoting a generic package, not yours. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_HOWITWORKS_WORDS)) {
      return riley("Trained on your FAQs, pricing, and services. When someone calls or messages:\n\n• Answered instantly, 24/7\n• Qualified in 2 questions\n• Booked automatically\n\nNo hold music, no missed calls, no human handoff. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_RELIABILITY_WORDS)) {
      /* New in dialogue spec v2 (Section 5, item 7) — highest-priority new
         branch, checked ahead of FAQ_REALAI_WORDS deliberately: testing
         showed a realistic phrasing like "what if the AI makes a mistake
         and double-books someone" contains the bare word "ai", which
         FAQ_REALAI_WORDS also matches. FAQ_REALAI_WORDS' word list is
         broad by design (single common words like "ai"/"bot"), so if it
         ran first it would win that collision and answer the wrong
         question — exactly the failure mode this branch exists to
         prevent. Checking the new, more specific reliability list first
         means the more substantive question gets the substantive answer.
         The reply already ends on its own forward-motion question
         (principle 5 — state the offer once, don't chase it), so no
         nextPrompt() is appended here — doing so would stack a second
         question mark right after the first. */
      return riley("No published error rate to quote honestly — this is a live, continuously-monitored system, not a static script. Double-bookings are prevented at the calendar layer (the system checks availability before confirming, same as a human would) — and Axon Core, not you, is responsible for fixing a scheduling error caused by the system itself. Want me to have Tristan walk through the monitoring setup on the strategy call?");
    }
    if (matchAny(txt, FAQ_CONTRACT_WORDS)) {
      /* New in dialogue spec v2 (Section 5, item 8) — same priority tier
         and same reasoning as FAQ_RELIABILITY_WORDS above (own closing
         question, no nextPrompt() appended; checked ahead of
         FAQ_REALAI_WORDS for the same collision-avoidance reason). */
      return riley("Fair question. The 36-month term is what makes the founding-client rate possible — Axon Core prices this like infrastructure, not a trial subscription. If it's a concern, the strategy call is the place to raise it directly with Tristan before anything is signed — no commitment happens on this chat. Want me to flag that for the call?");
    }
    if (matchAny(txt, FAQ_REALAI_WORDS)) {
      return riley("Real AI, not a human or a recording. This exact conversation — same latency, same logic — is what your callers get.\n\n" + nextPrompt());
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
      /* Comprehension capability 2.2(a) — capture the user's own noun
         phrase for their business (verbatim, reads as "heard") if they
         used an "I run/we run/..." style lead-in, and classify a
         BUSINESS_TYPE bucket independently (used as a fallback label when
         BUSINESS_RAW isn't captured, or when the phrasing is too unusual
         to match the capture regex at all — see Section 2.4/2.2(a)). */
      var bizMatch = txt.match(/(?:i run|i own|we run|we own|we have|i have|we're a|i am a|i'm a|it's a|its a)\s+(?:a |an |the )?([a-z][a-z\s&'-]{1,38})/i);
      if (bizMatch) {
        var rawBiz = bizMatch[1].replace(/[.,!?;:]+\s*$/, '').trim();
        /* Stored lowercase, not cap()'d here -- its only consumer,
           businessTypeLine(), always embeds it mid-sentence ("for a " +
           BUSINESS_RAW + " — "), so capitalizing at capture time produced
           a stray mid-sentence capital (e.g. "for a Family dental clinic")
           once combined into qualifyChannel()'s full line. The outer
           cap(combined) in qualifyChannel() already handles capitalizing
           just the first letter of the whole sentence correctly. */
        if (rawBiz) BUSINESS_RAW = rawBiz;
      }
      BUSINESS_TYPE = classifyBusinessType(txt);
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      /* Comprehension capability 2.2(d)/2.4 — capture a specific,
         proper-noun-ish channel term if the user named one, for use in
         recommend()'s coverage line. Captured regardless of which branch
         below fires. */
      CHANNEL_RAW = captureChannelRaw(txt);
      /* Logic fix (dialogue spec v2, Section 5 item 3): the old
         first-match-wins if/return chain misread "we take calls but
         people mostly message us on the website" as phone-only, because
         the phone check ran first and returned immediately — the chat
         signal in the same sentence was silently dropped. Fix: check all
         three categories, count how many matched, and only classify as a
         single channel when exactly one matched; two or more means the
         business genuinely is omnichannel. */
      /* matchAnyNotNegated(), not plain matchAny() — see its definition
         near isAffirmativeConsent() for why: a naive substring match on
         single common words like "social"/"all"/"call" false-positives
         on negated phrasing ("we don't do social", "no calls, just
         chat"), which would wrongly push matchCount to 2+ and misroute a
         genuinely single-channel answer to the omni bucket. */
      var isPhone = matchAnyNotNegated(txt, ['phone','call','calls','ring','voice','number']);
      var isOmni  = matchAnyNotNegated(txt, ['whatsapp','instagram','facebook','social','tiktok','all','every','omni','multiple','mix']);
      var isChat  = matchAnyNotNegated(txt, ['chat','website','web','message','online','email']);
      var matchCount = (isPhone ? 1 : 0) + (isOmni ? 1 : 0) + (isChat ? 1 : 0);
      if (matchCount >= 2) {
        CHANNEL_HINT = 'omni';
        return qualifyVolume();
      }
      if (isPhone) {
        CHANNEL_HINT = 'phone';
        return qualifyVolume();
      }
      if (isOmni) {
        CHANNEL_HINT = 'omni';
        return qualifyVolume();
      }
      if (isChat) {
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
      /* Bug fix (dialogue spec v2, Section 5 item 1): the old
         `parseInt(txt.replace(/[^0-9]/g, ''), 10)` stripped every
         non-digit character out of the ENTIRE string and concatenated
         whatever digits remained — "150-200 a month" became the digit
         string "150200", which parseInt read as 150,200 and would
         wildly over-trigger the Pro tier on a parsing bug, not a real
         signal. Fix: extract the first standalone number via regex
         instead of concatenating every digit in the string. Also handles
         thousands separators ("1,200 a month") and "k" shorthand
         ("2k a month" → 2000). */
      var numMatch = txt.match(/\d[\d,]*/);
      var num = numMatch ? parseInt(numMatch[0].replace(/,/g, ''), 10) : NaN;
      var kMatch = txt.match(/(\d+(?:\.\d+)?)\s*k\b/i);
      if (kMatch) num = Math.round(parseFloat(kMatch[1]) * 1000);
      var hasNum = !isNaN(num);
      /* Store the actual number given (not just the bucket) whenever one
         was found, even if it doesn't cleanly land in a lite/pro bucket
         by keyword — used by recommend()'s volumeLine() callback. */
      if (hasNum) VOLUME_NUMBER = num;
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
    riley(nextPrompt());
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
        "Right fit first needs two data points — ",
        "One more input before I can size this correctly — ",
        "Last detail, then this is locked to the right package — "
      ];
      var line = lines[Math.min(FASTTRACK_COUNT, lines.length - 1)];
      FASTTRACK_COUNT++;
      riley(line + nextPrompt());
      return true;
    }
    /* Unexpected/transient state (e.g. still 'idle') — don't reference
       "2 quick questions" since qualification may already be done. */
    riley(nextPrompt());
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
  /* General-purpose version of the same negation-window check, reused by
     the qualify_channel multi-category classifier (Section 5 item 3).
     Found via testing: a plain matchAny() on the omni word list false-
     positives on "Phone only, we don't do social." — "social" is a real
     substring match even though it's explicitly negated, which pushed
     matchCount to 2 and misclassified a single-channel (phone-only)
     answer as omni. That's the same class of bug isAffirmativeConsent()
     was already written to prevent for "I don't want to book anything",
     so it gets the same fix here rather than a bespoke one-off. */
  function matchAnyNotNegated(txt, words) {
    return words.some(function (w) {
      var re = new RegExp('\\b' + escapeRegex(w) + '\\b', 'i');
      var m = re.exec(txt);
      if (!m) return false;
      var before = txt.slice(0, m.index).trim();
      var windowWords = before.length ? before.split(/\s+/).slice(-3).join(' ') : '';
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
        return riley("Already locked in. Reach hello@axoncoreai.com if that changes. Anything else?");
      }
      if (isAffirmativeConsent(txt)) {
        return showBooking();
      }
      return riley("You're set — confirmation's in your inbox. Anything else before the call?");
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
    return riley("No issue. Ask anything else, or say the word when you want the strategy call locked in. " + nextPrompt());
  }

  /* Warm, rotating decline acknowledgement — never books, never changes
     state. Rotates like fastTrackIntercept()'s lines so a prospect who
     declines more than once doesn't see the same sentence twice. */
  function handleDecline() {
    var lines = [
      "The offer stands, no expiry. Anything else worth covering first?",
      "Understood. Same offer, whenever it's useful — the setup and pricing are open for questions in the meantime.",
      "Noted. I can go deeper on setup, pricing, or anything else before you decide."
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
        return riley("Broad categories: restaurant, salon, clinic, real estate, professional services. Closest fit?");
      }
      /* Still unsure on the second try — move on with a general/unknown
         business assumption instead of looping a third time. */
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("A rough split works. Mostly phone, website messages, or WhatsApp/Instagram/Facebook?");
      }
      CHANNEL_HINT = CHANNEL_HINT || 'omni';
      return qualifyVolume();
    }

    if (STATE === 'qualify_volume') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("Ballpark is fine. Under 100 a month, a few hundred, or more?");
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
        "Your call, no deadline attached. Say the word when you want the strategy call, and I'll lock it in.",
        "The strategy call stays open — let me know when it's useful.",
        "No expiry on the offer. Ready when you are."
      ];
      var hedgeLine = hedgeLines[Math.min(UNCERTAIN_COUNT - 1, hedgeLines.length - 1)];
      return riley(hedgeLine);
    }

    return riley(nextPrompt());
  }

  /* ── Conversation steps ─────────────────────────────────────── */
  function qualifyChannel() {
    STATE = 'qualify_channel';
    var lead = USER_NAME ? USER_NAME + ' — ' : '';
    var bizLine = businessTypeLine(); // "for a X — " or ''
    var combined = lead + bizLine;
    if (combined) combined = cap(combined); // capitalize whichever part leads
    riley(combined + "How do clients reach you — phone, website chat, WhatsApp/Instagram/Facebook, or a mix?");
  }

  function qualifyVolume() {
    STATE = 'qualify_volume';
    riley("And roughly how many " + channelLabel() + " per month?");
  }

  function recommend() {
    STATE = 'recommend';
    var pkg = getPackage();
    riley(volumeLine() + "*" + pkg.name + "* fits.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "\n• Included: " + pkg.mins + "\n• 36-month agreement, founding-client rate\n\nCovers " + (CHANNEL_RAW || channelCopy()) + ", fully automated. I can put 30 minutes on Tristan's calendar to get this live in 14 days — want that?");
  }

  function showBooking() {
    STATE = 'book';
    riley("Locking that in now.", function () {
      setTimeout(function () {
        if (confirmEl) {
          /* Swap in a strategy call confirmation */
          var titleEl = confirmEl.querySelector('.rp-confirm__title');
          var subEl   = confirmEl.querySelector('.rp-confirm__sub');
          var rows    = confirmEl.querySelectorAll('.rp-confirm__row');
          if (titleEl) titleEl.textContent = 'CALL BOOKED ✓';
          if (subEl)   subEl.textContent   = 'Tristan walks you through the setup directly.';
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
  /* New FAQ word lists (dialogue spec v2, Section 5 items 7-8) — a
     sophisticated skeptical prospect asking about error rate/liability or
     36-month contract risk previously had no answerable branch and fell
     through to the generic fallback. Included in matchesFaqKeywords() too,
     for the same reason the original three lists are: an uncertainty
     phrase ("not sure I trust locking into 36 months") can still be a
     genuine, answerable question, and the more specific FAQ signal should
     win over the generic uncertainty heuristic. */
  var FAQ_RELIABILITY_WORDS = [
    'error rate', 'liable', 'liability', 'double-book', 'double book',
    'mistake', 'hallucinate', 'what if you get it wrong', 'accuracy'
  ];
  var FAQ_CONTRACT_WORDS = [
    '36-month', '36 month', 'lock in', 'lock-in', 'locked in', 'contract',
    'cancel', 'get out of', 'exit clause', 'never heard of you',
    'never heard of', "haven't heard of"
  ];
  function matchesFaqKeywords(txt) {
    return matchAny(txt, FAQ_PRICE_WORDS) || matchAny(txt, FAQ_HOWITWORKS_WORDS) ||
      matchAny(txt, FAQ_REALAI_WORDS) || matchAny(txt, FAQ_RELIABILITY_WORDS) ||
      matchAny(txt, FAQ_CONTRACT_WORDS);
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function nextPrompt() {
    if (STATE === 'greet')           return "What's the business?";
    if (STATE === 'qualify_channel') return 'How do clients reach you?';
    if (STATE === 'qualify_volume')  return 'How many enquiries a month?';
    return 'Want to see this running for your business specifically?';
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
  function channelLabel() {
    return CHANNEL_HINT === 'phone' ? 'calls' : CHANNEL_HINT === 'chat' ? 'website messages' : 'enquiries across your channels';
  }

  /* ── Comprehension helpers (dialogue spec v2, Section 2/5) ───────
     classifyBusinessType() / captureChannelRaw() do the classification;
     businessTypeLine() / volumeLine() are the small string builders that
     turn captured state into a callback. Both string builders are written
     defensively — they return '' whenever the relevant state isn't set,
     so every call site degrades gracefully to the old generic phrasing
     instead of producing a broken sentence like "For a , how do clients
     reach you". Verified explicitly in the test harness below. */
  var BUSINESS_TYPE_WORDS = {
    restaurant: ['restaurant','cafe','café','diner','eatery','bar','bistro','kitchen','food'],
    salon:      ['salon','spa','barber','nails','nail bar','aesthetics','beauty','wellness'],
    clinic:     ['clinic','dental','dentist','doctor','medical','physio','healthcare','practice'],
    realestate: ['real estate','realtor','property','properties','agency','estate agent'],
    legal:      ['law firm','lawyer','legal','attorney','advocate']
  };
  var BUSINESS_TYPE_ORDER = ['restaurant', 'salon', 'clinic', 'realestate', 'legal'];
  function classifyBusinessType(txt) {
    for (var i = 0; i < BUSINESS_TYPE_ORDER.length; i++) {
      var key = BUSINESS_TYPE_ORDER[i];
      if (matchAny(txt, BUSINESS_TYPE_WORDS[key])) return key;
    }
    return 'other';
  }
  var BUSINESS_TYPE_LABELS = {
    restaurant: 'restaurant',
    salon: 'salon',
    clinic: 'clinic',
    realestate: 'real estate agency',
    legal: 'law firm'
  };
  function businessTypeLine() {
    if (BUSINESS_RAW) return 'for a ' + BUSINESS_RAW + ' — ';
    if (BUSINESS_TYPE && BUSINESS_TYPE !== 'other' && BUSINESS_TYPE_LABELS[BUSINESS_TYPE]) {
      return 'for a ' + BUSINESS_TYPE_LABELS[BUSINESS_TYPE] + ' — ';
    }
    return '';
  }
  /* Specific proper-noun-ish channel terms worth echoing verbatim if
     present, checked most-specific-first (e.g. "instagram dms" before
     bare "instagram"). NOTE: by the time any handler sees `txt` it has
     already been lowercased upstream (handleSend calls
     respond(text.toLowerCase())), so true case-preservation from the
     visitor's original keystrokes isn't available at this layer without
     threading the raw string through the whole state machine — a bigger
     change than this content/state pass calls for. This returns a
     proper-noun-capitalized display label instead (e.g. "WhatsApp",
     "Instagram DMs"), which reads just as "heard" in the reply. */
  var CHANNEL_RAW_TERMS = [
    { re: /\binstagram dms\b/i, label: 'Instagram DMs' },
    { re: /\binstagram\b/i, label: 'Instagram' },
    { re: /\bwhatsapp\b/i, label: 'WhatsApp' },
    { re: /\bfacebook messenger\b/i, label: 'Facebook Messenger' },
    { re: /\bfacebook\b/i, label: 'Facebook' },
    { re: /\btiktok\b/i, label: 'TikTok' },
    { re: /\bwebsite chat\b/i, label: 'website chat' },
    { re: /\blive chat\b/i, label: 'live chat' }
  ];
  function captureChannelRaw(txt) {
    for (var i = 0; i < CHANNEL_RAW_TERMS.length; i++) {
      if (CHANNEL_RAW_TERMS[i].re.test(txt)) return CHANNEL_RAW_TERMS[i].label;
    }
    return '';
  }
  function volumeLine() {
    if (VOLUME_NUMBER === null || VOLUME_NUMBER === undefined || isNaN(VOLUME_NUMBER)) return '';
    return 'At roughly ' + VOLUME_NUMBER + ' ' + channelLabel() + ' a month, ';
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
