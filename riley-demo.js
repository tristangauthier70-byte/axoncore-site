/* ═══════════════════════════════════════════════════════════════
   riley-demo.js — Interactive Riley chat for riley.html
   Simulates Riley's real qualification + recommendation flow.
   NO external API calls — all local, instant, no latency.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var STATE = 'idle'; // idle → greet → qualify_channel → qualify_volume → recommend → get_name → get_email → book
  var CHANNEL_HINT = '';  // 'phone' | 'chat' | 'omni'
  var VOLUME_HINT  = '';  // 'lite' | 'standard' | 'pro'
  var USER_NAME    = '';
  /* Real lead-capture fields, distinct from the earlier opportunistic
     USER_NAME capture in greet ("I'm Sarah") — this is the explicit "what
     name and email should I send this to" step (see startLeadCapture()),
     since the whole point of a lead-gen demo is to actually collect a
     usable lead, not just show a nice confirmation animation. */
  var USER_EMAIL     = '';
  var NAME_ATTEMPTS  = 0;
  var EMAIL_ATTEMPTS = 0;

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
  /* Rotates the greet-state greeting/small-talk acknowledgment (see
     greetingAck()) so a caller who says "hi" more than once before
     actually answering doesn't see the exact same line twice. */
  var GREET_ACK_COUNT = 0;
  /* Rotates greetDeclineAck() (see call site in the greet-state handler and
     the function itself below) — kept separate from DECLINE_COUNT so a
     decline typed before any recommendation exists doesn't share/skip
     rotation state with handleDecline()'s post-recommendation lines, which
     reference "the offer"/pricing that hasn't been discussed yet. */
  var GREET_DECLINE_COUNT = 0;

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
    addMsg('riley', "Hi there, I'm Riley — Axoncore's AI receptionist. I answer calls and messages, qualify the lead, and get the appointment booked, all without a human stepping in.\n\nHappy to show you exactly how that would work for you. What's the business?");
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
    /* Bug fix (broader audit pass): a plain /\d/.test() here treated ANY
       digit as a "real number was given" signal, including a percentage
       used only as a hedge ("not 100% sure") with no actual volume figure
       anywhere else in the reply. That falsely bypassed handleUncertain()
       for a genuinely uncertain caller. extractVolumeNumber() (defined
       near the qualify_volume block below) already knows how to ignore
       %-tagged numbers in favor of a real one — reuse it here so "not
       100% sure" alone routes to handleUncertain(), while "not 100% sure,
       maybe 150 a month" still correctly bypasses it and parses 150. */
    var isDigitAnswerAtVolume = STATE === 'qualify_volume' && extractVolumeNumber(txt) !== null;
    var hasFaqIntent = matchesFaqKeywords(txt);
    if (isUncertain(normTxt) && !isDigitAnswerAtVolume && !hasFaqIntent) {
      return handleUncertain();
    }

    /* Universal FAQ intercepts — these mostly never collide with a pending
       qualifying answer (no channel/volume/business-type reply plausibly
       contains "how much does this cost" or "are you a real AI"), so they
       stay ahead of the state machine at every state. The one proven
       exception is the real-AI check's bare single words ('ai'/'bot'/
       'fake'/'robot') colliding with a greet-state business description
       ("we're an AI consulting firm") — handled inside matchesRealAiFaq()
       itself (see its definition near FAQ_REALAI_PHRASES below) rather
       than here, so every call site gets the fix automatically. Word lists
       live in FAQ_PRICE_WORDS / FAQ_HOWITWORKS_WORDS / FAQ_REALAI_PHRASES /
       FAQ_REALAI_BARE_WORDS (defined near matchesFaqKeywords()) so the
       isUncertain() bypass above checks the exact same lists these
       intercepts use. */
    if (matchAny(txt, FAQ_SERVICES_WORDS)) {
      /* New — "what does Axoncore actually do / what services do you offer"
         had no dedicated answer before; it either got misread by
         FAQ_HOWITWORKS_WORDS (which explains the mechanics, not the product
         lineup) or fell through to the generic fallback. Checked ahead of
         FAQ_HOWITWORKS_WORDS so a request for "what do you offer" gets the
         package overview, not the how-it-works mechanics answer. */
      return riley("Three ways to set this up, depending on how customers reach you:\n\n• *AI Phone System* — a voice receptionist for calls, 24/7\n• *Conversion System* — phone plus a website chatbot\n• *Omnichannel Front Desk* — phone, website, WhatsApp, Instagram & Facebook, all in one inbox\n\nHappy to figure out which one fits — what's the business?");
    }
    if (matchAny(txt, FAQ_REVISION_WORDS)) {
      /* Checked BEFORE FAQ_PRICE_WORDS deliberately — "change the pricing
         later" / "update the pricing" contain the word "pricing", which is
         also a FAQ_PRICE_WORDS entry, so the generic price answer would
         otherwise win that collision and miss the more specific (and more
         honest) question actually being asked: not "what does this cost
         today" but "what if I need to change something after go-live."
         "What if I need to change the script/pricing later" is a realistic,
         slightly awkward question (there IS a real cost to it) that
         previously had no honest answer and would've fallen through to the
         generic fallback. Riley should be able to state this accurately
         rather than dodge it — matches the brief that this bot needs to
         actually know the business, not just sound friendly. */
      return riley("Good to ask upfront: hosting, uptime, and general maintenance are always free, no matter what. Changing what the AI actually says once it's live — updated pricing, new FAQs, a different script — is a flat SGD $300 per revision request. Most clients get it close to right at setup and rarely need changes. Want me to have Tristan cover this in more detail on the call?");
    }
    if (matchAny(txt, FAQ_PRICE_WORDS)) {
      /* Price was already shown in the recommendation — a confused
         follow-up anywhere from 'recommend' onward ("I have no idea how
         much this costs") needs the actual number restated, not the
         pre-qualification "I'll get to pricing once I know your setup"
         deferral, which would be untrue (setup is already known) and
         would ignore the real question. Includes get_name/get_email
         (added alongside the lead-capture flow) since qualification is
         just as complete there as at recommend/book — only the trailing
         line differs, since "want that?" only makes sense at 'recommend'
         itself (that's the one state where an affirmative here actually
         starts the booking flow); elsewhere, re-surfacing whatever's
         actually pending via nextPrompt() is the accurate follow-up. */
      if (STATE === 'recommend' || STATE === 'book' || STATE === 'get_name' || STATE === 'get_email') {
        var faqPkg = getPackage();
        var trailer = STATE === 'recommend' ? " Happy to lock in the strategy call now if you'd like — want that?" : ' ' + nextPrompt();
        return riley("Of course — that's *" + faqPkg.name + "*: " + faqPkg.setup + " setup, " + faqPkg.monthly + "/mo, " + faqPkg.mins + " included, on the 36-month founding-client rate." + trailer);
      }
      return riley("Good question — I just need a couple of details about your business first, so I can give you the real number instead of a generic estimate. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_HOWITWORKS_WORDS)) {
      return riley("Happy to walk you through it. Riley's trained on your own FAQs, pricing, and services, so when someone calls or messages your business:\n\n• They're answered instantly, 24/7\n• Qualified in a couple of quick questions\n• Booked straight onto your calendar\n\nNo hold music, no missed calls, no waiting on a human to get back to them. " + nextPrompt());
    }
    if (matchAny(txt, FAQ_RELIABILITY_WORDS)) {
      /* New in dialogue spec v2 (Section 5, item 7) — highest-priority new
         branch, checked ahead of matchesRealAiFaq() deliberately: testing
         showed a realistic phrasing like "what if the AI makes a mistake
         and double-books someone" contains the bare word "ai", which
         matchesRealAiFaq()'s FAQ_REALAI_BARE_WORDS also matches (outside
         greet state). That list is broad by design (single common words
         like "ai"/"bot"), so if it ran first it would win that collision
         and answer the wrong question — exactly the failure mode this
         branch exists to prevent. Checking the new, more specific
         reliability list first means the more substantive question gets
         the substantive answer.
         The reply already ends on its own forward-motion question
         (principle 5 — state the offer once, don't chase it), so no
         nextPrompt() is appended here — doing so would stack a second
         question mark right after the first. */
      return riley("Fair to ask, and I'd rather give you a straight answer than a made-up number: there's no published error rate, because this is a live, continuously-monitored system, not a fixed script. Double-bookings are prevented at the calendar layer — availability gets checked before anything's confirmed, the same way a good human receptionist would. And if the system itself ever causes a scheduling error, that's on Axoncore to fix, not you. Want Tristan to walk you through the monitoring setup on a call?");
    }
    if (matchAny(txt, FAQ_CONTRACT_WORDS)) {
      /* New in dialogue spec v2 (Section 5, item 8) — same priority tier
         and same reasoning as FAQ_RELIABILITY_WORDS above (own closing
         question, no nextPrompt() appended; checked ahead of
         matchesRealAiFaq() for the same collision-avoidance reason). */
      return riley("Totally fair question. A traditional receptionist in Singapore runs about SGD $126,360 over 36 months (salary + CPF) — the 36-month term is what lets Axoncore price this at a fraction of that instead of a month-to-month trial rate. That said, nothing gets signed on this chat — if the term's a concern, that's exactly what the strategy call with Tristan is for. Want me to flag it for that conversation?");
    }
    if (matchesRealAiFaq(txt)) {
      return riley("Good question — yes, real AI, not a human typing behind the scenes or a canned recording. This exact conversation, same speed and same logic, is what your customers would actually get.\n\n" + nextPrompt());
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
      /* Bug fix (item 1) — a bare greeting/small-talk reply ("hi",
         "hello", "hey", "thanks"...) to the opening "What's the
         business?" question used to fall straight through to bizMatch/
         classifyBusinessType below (which accept literally any text) and
         silently advance to qualifyChannel() — Riley never acknowledged
         the greeting at all, reading as if it hadn't understood a basic
         "hi". Detected and handled BEFORE the name/business capture below
         so a bare greeting never gets misread as a business answer. */
      if (isGreeting(txt)) {
        return riley(greetingAck(txt));
      }

      /* Bug fix (CEO review round 6, item 2 — flagged as the top-priority
         follow-up) — "not interested" typed as the literal first reply to
         "What's the business?" used to fall straight through to bizMatch/
         classifyBusinessType below (same class of bug as the bare-greeting
         fix above: those regexes accept literally any text), silently
         capturing BUSINESS_RAW = "Not Interested" and echoing it right back
         in the very next line. A skeptical visitor's first reaction being
         "not interested" is an entirely ordinary, likely input for a demo
         widget — not an edge case — so it's checked here, before the name/
         business capture, the same way the greeting check above is. Stays
         in STATE 'greet' (doesn't advance to qualifyChannel) so the
         business question is still open afterward; doesn't book anything
         and can't, since no recommendation exists yet at this point in the
         conversation. */
      if (isDeclineAtGreet(txt)) {
        return riley(greetDeclineAck());
      }

      /* Extract name if they introduced themselves. The negative lookahead
         (?!a\b|an\b|the\b) is a bug fix found during the broader audit
         pass: the old pattern `(?:i'm|i am|...)\s+([a-z]+)` captured
         whatever single word followed "I'm"/"I am" as if it were always a
         name — so "I'm a dentist" set USER_NAME to "A", and "I am the
         owner..." set it to "The". Both then leaked into qualifyChannel()
         ("A — for a dentist — ...") and even into the final booking
         confirmation card. Skipping when the next word is a/an/the lets
         those phrasings fall through to bizMatch below (which is what's
         actually meant to handle "I'm a/an X") instead of being
         misread as a name introduction. */
      var nameMatch = txt.match(/(?:i'm|i am|my name is|name's)\s+(?!a\b|an\b|the\b)([a-z]+)/i);
      if (nameMatch) USER_NAME = cap(nameMatch[1]);
      /* Comprehension capability 2.2(a) — capture the user's own noun
         phrase for their business (verbatim, reads as "heard") if they
         used an "I run/we run/..." style lead-in, and classify a
         BUSINESS_TYPE bucket independently (used as a fallback label when
         BUSINESS_RAW isn't captured, or when the phrasing is too unusual
         to match the capture regex at all — see Section 2.4/2.2(a)).
         Bug fix (broader audit pass): the lead-in list only had the "a"
         article hardcoded ("i'm a", "i am a", "we're a", "it's a", "its
         a") — "I'm an accountant" / "We're an agency" never matched at
         all (the literal substring "i'm a" is followed by "n", not a
         space, so the regex failed outright), silently leaving
         BUSINESS_RAW empty for that whole class of reply. Added the
         matching "an" sibling for each. */
      /* Bug fix (CEO review round 2, items 2 & 3; restructured in round 3,
         items 3 & 4) — lead-ins are split into two regexes because they
         precede grammatically different things:
           - DESCRIPTIVE lead-ins ("i run/we run/i'm a/it's a/...") precede
             a descriptive noun phrase ("a dental clinic"), which reads
             naturally lowercase mid-sentence — captured lowercase,
             exactly as before.
           - NAME lead-ins ("is called"/"called"/"owner of") precede an
             actual PROPER NAME ("Tony's Pizza", "Sunrise Dental"), which
             should be title-cased the same way the bare-name fallback
             below already title-cases a name typed with no lead-in at
             all. Round 2 stored both groups lowercase, which produced a
             visible, embarrassing inconsistency: "my business is called
             Tony's Pizza" came back as "For a tony's pizza —" while the
             bare name "Tony's Pizza" typed alone correctly came back
             title-cased. Splitting the capture into two regexes gives
             each group its own casing rule instead of patching casing
             in isolation.
         Also adds "it is called" (round 3 item 4) alongside the existing
         "it's called"/"its called" contracted/dropped-apostrophe forms —
         "it is called Sunrise Dental" previously matched neither lead-in
         list and fell all the way to the bare-name fallback, which
         swallowed the whole sentence verbatim ("For an It Is Called
         Sunrise Dental —") since it saw no recognized lead-in to strip.
         (Same apostrophe-tolerance reasoning as round 2's "we're called"/
         "we are called" pairing — verified via test harness below.) */
      /* "our business is (a/an/the)?" added (CEO review round 4, item 3) —
         same descriptive-noun-phrase shape as "we run/we own/...", just a
         different lead-in. "our business is a call centre" previously
         matched neither bizMatch regex (no "called", so bizMatchName
         missed it) and wasn't rejected by looksLikeBusinessName either (it
         doesn't start with i/we/it's/"this is"), so it fell all the way to
         the bare-name fallback and swallowed the ENTIRE sentence verbatim
         ("For an Our Business Is A Call Centre —"). Adding the lead-in
         here lets the normal descriptive capture strip it and the optional
         article, leaving just "call centre". */
      var bizMatchDescriptive = txt.match(/(?:i run|i own|we run|we own|we have|i have|we're a|we're an|i am a|i am an|i'm a|i'm an|it's a|it's an|its a|its an|our business is)\s+(?:a |an |the )?([a-z][a-z\s&'-]{1,38})/i);
      /* "this is called"/"that is called"/"that's called" added during
         round-3 adversarial testing: the HOSTILE_LINKING_VERB_RE comment
         below assumes "this is called X" is already claimed here before
         the hostile-probe fallback ever runs — that assumption was false
         until these three forms were added (only "it is called" had been
         requested), so "this is called Sunrise Dental" was swallowing the
         whole sentence the same way "it is called Sunrise Dental" did
         before item 4's fix. Closed for full "is called" family parity. */
      /* The optional article is now a CAPTURING group (was non-capturing)
         so the code below can tell whether it was present — needed
         because "owner of" doesn't reliably precede a proper name the
         way "is called" does: "owner of Tony's Pizza" is a name, but
         "owner of a bakery" is a generic descriptive noun, same as the
         descriptive lead-ins above. Found via round-3 regression testing:
         grouping "owner of" unconditionally into the title-cased branch
         (as CEO review round 3 suggested) turned "I am the owner of a
         bakery" into "For a Bakery —", regressing round 2's own fix for
         that exact phrase. An article immediately before the captured
         noun ("a "/"an "/"the ") is the signal that it's being used as a
         common noun this time, regardless of which lead-in introduced
         it — so that case stays lowercase; no article means it's a
         proper name, so it gets title-cased. */
      var bizMatchName = txt.match(/(?:my business is called|business is called|it's called|its called|it is called|this is called|that is called|that's called|we're called|were called|we are called|i'm the owner of|i am the owner of|we're the owners of|were the owners of|owner of)\s+(a |an |the )?([a-z][a-z\s&'-]{1,38})/i);
      /* CEO review round 5 — bizMatchName checked BEFORE bizMatchDescriptive
         (was the reverse). Round 4 added "our business is" to
         bizMatchDescriptive, which structurally overlaps with
         bizMatchName's own "business is called" pattern: for "our business
         is called sunrise dental", the old descriptive-first order let
         bizMatchDescriptive's greedy capture grab "called sunrise dental"
         verbatim (lowercase, unstripped) before bizMatchName ever got a
         chance to claim the more specific "is called" phrasing — producing
         the broken "For a called Sunrise Dental —". bizMatchName's lead-ins
         all explicitly require "called" or "owner of" somewhere in the
         phrase, so they're strictly more specific than bizMatchDescriptive's
         generic lead-ins and should win any overlap. Verified this reorder
         doesn't affect "our business is a call centre" (no "called" in it,
         so bizMatchName simply doesn't match and it falls through to
         bizMatchDescriptive exactly as before). */
      if (bizMatchName) {
        var rawBizName = bizMatchName[2].replace(/[.,!?;:]+\s*$/, '').trim();
        var nameHadArticle = !!bizMatchName[1];
        /* Only title-case when no article preceded the capture (a real
           proper name, e.g. "is called Tony's Pizza") — an article
           present ("owner of a bakery") means it's being used as a
           common noun, same casing rule as the descriptive branch. */
        if (rawBizName) BUSINESS_RAW = nameHadArticle ? rawBizName : titleCaseBusinessName(rawBizName);
      } else if (bizMatchDescriptive) {
        var rawBizDesc = bizMatchDescriptive[1].replace(/[.,!?;:]+\s*$/, '').trim();
        /* Stored lowercase, not cap()'d here -- its only consumer,
           businessTypeLine(), always embeds it mid-sentence ("for a " +
           BUSINESS_RAW + " — "), so capitalizing at capture time produced
           a stray mid-sentence capital (e.g. "for a Family dental clinic")
           once combined into qualifyChannel()'s full line. The outer
           cap(combined) in qualifyChannel() already handles capitalizing
           just the first letter of the whole sentence correctly. */
        if (rawBizDesc) BUSINESS_RAW = rawBizDesc;
      } else {
        /* Bug fix (CEO review round 2, item 4) — isGreeting(txt) above
           correctly returns false for something like "hi, bakery" (real
           content follows the greeting, so the WHOLE reply isn't just a
           greeting — correctly NOT swallowed by the greeting branch), but
           the bare-name fallback below used to then capture the ENTIRE
           reply, greeting fragment and all ("Hi, Bakery"). Strip a single
           leading greeting word/phrase (reusing GREETING_WORDS) plus its
           trailing punctuation/whitespace first, so "hi, bakery" yields
           "bakery" as the candidate name instead. No-op (returns txt
           unchanged) whenever there's no leading greeting fragment to
           strip, so every previously-working case is unaffected. */
        var nameCandidate = stripLeadingGreetingFragment(txt);
        if (looksLikeBusinessName(nameCandidate)) {
          /* Bug fix (item 2) — the single most natural way a real person
             answers "What's the business?" is just stating the business's
             name with no lead-in phrase at all ("Tony's Pizza", "Acme
             Dental Clinic"). Neither bizMatch regex above requires a
             lead-in and never fires on a bare name, which left
             BUSINESS_RAW (and therefore the whole "For a X — how do
             clients reach you?" callback) silently empty for that case.
             Fallback: treat the (greeting-stripped) reply itself as the
             business name, trimmed of trailing punctuation and capped at
             the same 38-char length the lead-in regexes already use. A
             bare name is a proper noun and reads correctly title-cased
             ("Tony's Pizza", not "for a tony's pizza"), so it's cased here
             rather than left lowercase. */
          var fallbackRaw = nameCandidate.replace(/[.,!?;:]+\s*$/, '').trim();
          if (fallbackRaw.length > 38) fallbackRaw = fallbackRaw.slice(0, 38).trim();
          /* Bug found during the warmth/personality redesign's own
             end-to-end testing — the single most common bare reply to
             "What's the business?" is a plain descriptive answer with a
             leading article ("a dental clinic", "a bakery"), not a proper
             name. Title-casing the WHOLE thing including the article
             produced "A Dental Clinic", which businessTypeLine() then
             wrapped in its OWN article — "for an A Dental Clinic —", a
             visibly broken double-article artifact on exactly the most
             natural input a real visitor would give. Fix: strip a leading
             a/an/the first and store the remainder lowercase (same casing
             rule bizMatchDescriptive already uses for this identical
             "has a leading article = descriptive noun, not a proper name"
             signal) — only fall through to the proper-noun title-case path
             when there's no leading article to strip. Trade-off: a real
             business literally named "The Golden Wok" would lose its
             title-casing under this rule (stored as lowercase "golden
             wok"). Accepted deliberately — a bare descriptive reply with
             an article is far more common than a proper name that happens
             to start with one, and the previous double-article artifact
             was an actual visible bug affecting the common case, not a
             hypothetical one. */
          var fallbackArticleMatch = fallbackRaw.match(/^(?:a|an|the)\s+(.+)/i);
          if (fallbackArticleMatch && fallbackArticleMatch[1]) {
            BUSINESS_RAW = fallbackArticleMatch[1];
          } else if (fallbackRaw) {
            BUSINESS_RAW = titleCaseBusinessName(fallbackRaw);
          }
        }
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
      /* Bug fix (CEO review round 2, item 5): the bare word 'number' used to
         sit in this list as a phone-channel signal (intended for "what's
         your number" style replies), but it's too generic/ambiguous as a
         standalone word — "we get a good number of walk-ins and enquiries"
         matched it and misclassified a no-channel-stated reply as
         phone-only. A genuine phone-number reference will almost always
         also contain "phone" or "call" elsewhere in the same reply, so
         dropping the bare word loses no real signal. */
      var isPhone = matchAnyNotNegated(txt, ['phone','call','calls','ring','voice']);
      /* Bug fix (CEO review round 3, item 5): 'all', 'every', and 'mix'
         were the same class of too-generic standalone-word problem that
         'number' was for isPhone above — "here's my number, we get calls
         all day" matched bare 'all' (via "all day") as an omni signal on
         top of the correct 'calls' phone match, pushing matchCount to 2
         and misrouting a clearly phone-only business into the pricier
         Omnichannel package. Dropped all three bare words; every genuine
         multi-channel answer is still caught by the remaining, more
         specific omni words (whatsapp/instagram/facebook/social/tiktok/
         omni/multiple) — e.g. "phone, chat, and social, all of them"
         still classifies as omni via 'social' alone. A caller who
         literally answers the qualifying prompt with the single word
         "mix" (echoing "...or a mix?") still ends up on Omnichannel too:
         matchCount stays 0, falls through phone/omni/chat and the
         fast-track intercept, and qualifyChannel()'s own unclear-answer
         default is CHANNEL_HINT = 'omni' — so removing the bare word
         loses no real signal there either. */
      var isOmni  = matchAnyNotNegated(txt, ['whatsapp','instagram','facebook','social','tiktok','omni','multiple']);
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
      /* extractVolumeNumber() (broader audit pass) — a plain "first digit
         sequence in the string" would grab the "100" out of a hedge like
         "not 100% sure, maybe 150 a month" and treat 100 as the volume
         answer, silently discarding the real figure (150) that came right
         after. Skipping any number immediately tagged with "%" fixes
         that while leaving the original "150-200 a month" → 150 behavior
         (and every other previously-passing case) unchanged. */
      var numStr = extractVolumeNumber(txt);
      var num = numStr !== null ? parseInt(numStr, 10) : NaN;
      var kMatch = txt.match(/(\d+(?:\.\d+)?)\s*k\b/i);
      if (kMatch) num = Math.round(parseFloat(kMatch[1]) * 1000);
      var hasNum = !isNaN(num);
      /* Store the actual number given (not just the bucket) whenever one
         was found, even if it doesn't cleanly land in a lite/pro bucket
         by keyword — used by recommend()'s volumeLine() callback. */
      if (hasNum) VOLUME_NUMBER = num;
      /* Bug fix (broader audit pass): the bare-digit entries this list used
         to carry ('10'...'100' here, '250'/'300'/'400'/'500' in proWord)
         are a plain matchAny() substring/word-boundary check against the
         WHOLE message, with no awareness of where that digit came from —
         so "not 100% sure, maybe 150 a month" matched the literal "100"
         inside "100%" and forced VOLUME_HINT to 'lite' via the `|| liteWord`
         branch below, completely overriding the correctly-extracted real
         answer (150, which is >=120 and should be Standard). Every
         legitimate case a bare digit was meant to catch ("just 50", "50
         a month") is already handled more precisely by the hasNum/num
         check on the same line (extractVolumeNumber() finds that exact
         number directly) — so the bare-digit entries were redundant for
         real answers and only added a false-positive risk for stray
         numbers elsewhere in the reply. Dropped; qualitative words only. */
      var liteWord = matchAny(txt, ['few','small','low','quiet','not many']);
      var proWord  = matchAny(txt, ['lots','many','busy','high','hundreds','over 200']);
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

    /* Lead capture (name + email) — runs after a recommendation has been
       accepted, before the actual booking confirmation. See
       startLeadCapture()/handleGetName()/handleGetEmail() below. Checked
       here, alongside qualify_channel/qualify_volume, since both are
       genuine pending questions with their own decline/hedge handling —
       not something the generic fast-track or recommend/book gate should
       intercept first. */
    if (STATE === 'get_name') {
      return handleGetName(txt);
    }
    if (STATE === 'get_email') {
      return handleGetEmail(txt);
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
    /* Fixed during the warmth/personality redesign — this used to be a
       plain matchAny(), which the file's own isAffirmativeConsent() comment
       already documented as unsafe for exactly this word list ("not
       interested" contains "interested"). It was previously left as-is
       here because a false positive couldn't cause an unconsented booking
       (this function never calls showBooking()) — true, but it DOES cause
       a jarring, obviously-wrong reply: "not interested" at qualify_channel
       was matching bare "interested" and producing an enthusiastic
       fast-track line, which reads exactly like the "broken transcript"
       failure mode this whole file exists to prevent, and the warmer
       phrasing this round introduced ("Love the enthusiasm!") only made
       the mismatch more visible. Switched to the same negation-aware check
       already used for this identical word list at recommend/book state,
       for the same reason. */
    if (!matchAnyNotNegated(txt, BOOKING_AFFIRM_WORDS)) {
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
        "Love the enthusiasm! Just need a couple more details to point you at the right fit — ",
        "Almost there, just one more thing so I can size this correctly for you — ",
        "Last detail, then I can get you locked onto the right package — "
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
    'pass for now', 'not ready', 'nah man', 'not doing this', 'no way'
  ];
  var DECLINE_WORDS = ['no', 'nah', 'nope', 'negative'];
  function isDecline(txt) {
    return matchAny(txt, DECLINE_PHRASES) || matchAny(txt, DECLINE_WORDS);
  }
  /* CEO review rounds 7-9 — a separate, stricter gate for the greet-state
     decline check (see call site above), NOT a change to isDecline()
     itself, which stays a substring/word-boundary match and is exactly
     right post-recommendation ("no, that's too much for us" must still
     register as a decline there).

     Pre-recommendation is different: greet state is also where free-text
     business names get captured, and round 7-9 kept finding one real
     business name after another that happened to contain a decline word
     or phrase as a substring — bare "no"-prefixed names (round 7: "No
     Frills Cleaning", "No Fuss Bakery", "No Regrets Tattoo", "Negative
     Space Gallery"), then "no way"-prefixed names (round 9: "No Way
     Jose's", "No Way Out Escape Rooms"). Patching DECLINE_PHRASES one
     newly-discovered colliding entry at a time (rounds 8-9's approach)
     just kept surfacing the next one — the list has plenty of other
     short, ironic-sounding phrases ("maybe later", "not today", "rather
     not") that are exactly as plausible as real cheeky brand names
     ("Maybe Later Vintage", "Not Today Coffee Co") as the ones already
     found, so the same collision was always going to keep recurring for
     whichever phrase got adversarially tried next.

     Structural fix (round 10): EVERY decline signal — both DECLINE_WORDS
     and DECLINE_PHRASES — counts as a decline at greet state only when it
     is the ENTIRE trimmed/punctuation-stripped reply, not a substring
     anywhere within it. This is the same principle isGreeting() already
     uses for bare greeting words, just applied to the whole decline
     surface instead of one list at a time. A visitor who types exactly
     "maybe later" or "no way" still gets the soft decline ack; a visitor
     who types "No Way Jose's" or "Maybe Later Vintage" — more words
     following the decline-shaped prefix — safely falls through to normal
     business-name capture instead, regardless of which phrase or word
     triggered it.

     CEO review round 11 correction — the original version of this comment
     claimed a longer decline sentence would harmlessly fall through
     without being captured as a business name, "protected" by
     looksLikeBusinessName()'s leading-pronoun guard. That's only true when
     the sentence happens to start with a pronoun ("I need to check with my
     team", "we're not interested"). The single most natural way people
     actually decline — the decline phrase itself, then a comma and a
     courtesy tail ("No thanks, I'm good", "Nah, that's excessive", "Not
     interested, but thanks anyway") — is NOT pronoun-led, and was sailing
     straight through to the bare-name fallback and getting echoed back
     verbatim ("For a No Thanks, I'm Good —"), reincarnating the exact
     bug this whole chain exists to fix. Verified via test harness.

     Fix: also match when the reply STARTS WITH a decline word/phrase
     immediately followed by a clause boundary (a comma or semicolon) —
     the comma is the structural signal that what follows is a separate
     clause, not a continuation of the same name. "No thanks, I'm good"
     has a comma glued right onto the decline phrase; "No Way Jose's" and
     "Maybe Later Vintage Boutique" don't have a comma there at all, so
     this doesn't reopen either collision. A real decline sentence with no
     comma at all ("nah that is excessive" with no punctuation) still
     isn't caught — accepted as residual risk, same reasoning as every
     other narrowing decision in this file: the visible failure mode (an
     embarrassing verbatim echo) is what's being eliminated, not every
     possible phrasing of a decline. */
  function isDeclineAtGreet(txt) {
    var trimmed = txt.trim();
    var normalized = trimmed.toLowerCase().replace(/[.,!?;:]+\s*$/, '').trim();
    if (DECLINE_WORDS.indexOf(normalized) !== -1 || DECLINE_PHRASES.indexOf(normalized) !== -1) return true;
    var leadingClauseMatch = trimmed.toLowerCase().match(/^([a-z' ]+?)\s*[,;]/);
    if (leadingClauseMatch) {
      var lead = leadingClauseMatch[1].trim();
      if (DECLINE_WORDS.indexOf(lead) !== -1 || DECLINE_PHRASES.indexOf(lead) !== -1) return true;
    }
    return false;
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
        return riley("All locked in already! Just reach out at hello@axoncoreai.com if anything changes. Anything else I can help with?");
      }
      if (isAffirmativeConsent(txt)) {
        return showBooking();
      }
      return riley("You're all set — the confirmation's in your inbox. Anything else I can help with before the call?");
    }

    /* STATE === 'recommend' */
    if (isDecline(txt)) {
      return handleDecline();
    }
    if (isAffirmativeConsent(txt)) {
      /* Lead capture (name + email) now happens BEFORE showBooking() —
         previously showBooking() went straight to a confirmation card that
         hardcoded Axoncore's own contact email in the "email" row instead
         of ever asking the visitor for theirs. Since generating real leads
         is the whole point of this demo, not just a nice confirmation
         animation, an affirmative here starts the explicit capture flow
         instead of booking immediately. */
      return startLeadCapture();
    }
    /* Neither a recognized decline nor a recognized affirmative — hedge
       or unrecognized text. Restate the offer without pressure; do NOT
       book, do NOT change state. */
    return riley("No worries at all. Feel free to ask me anything else, or just say the word whenever you're ready to lock in the strategy call. " + nextPrompt());
  }

  /* Warm, rotating decline acknowledgement — never books, never changes
     state. Rotates like fastTrackIntercept()'s lines so a prospect who
     declines more than once doesn't see the same sentence twice. */
  function handleDecline() {
    var lines = [
      "No worries at all — the offer's not going anywhere. Anything else I can help with in the meantime?",
      "Totally understand. It'll still be here whenever it's useful — happy to answer questions on setup or pricing anytime.",
      "No problem. I'm glad to go deeper on setup, pricing, or anything else that would help you decide."
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
        return riley("No worries — happy to help narrow it down. Are you closer to a restaurant, salon, clinic, real estate, or professional services?");
      }
      /* Still unsure on the second try — move on with a general/unknown
         business assumption instead of looping a third time. */
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("That's alright, a rough split works fine. Mostly phone, website messages, or WhatsApp/Instagram/Facebook?");
      }
      CHANNEL_HINT = CHANNEL_HINT || 'omni';
      return qualifyVolume();
    }

    if (STATE === 'qualify_volume') {
      if (UNCERTAIN_COUNT === 1) {
        return riley("No problem, a ballpark is fine. Under 100 a month, a few hundred, or more than that?");
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
        "Totally your call, no deadline attached. Just say the word whenever you'd like the strategy call, and I'll lock it in.",
        "The strategy call stays open for whenever it's useful to you.",
        "No expiry on the offer — I'm ready whenever you are."
      ];
      var hedgeLine = hedgeLines[Math.min(UNCERTAIN_COUNT - 1, hedgeLines.length - 1)];
      return riley(hedgeLine);
    }

    if (STATE === 'get_name') {
      /* Genuine hesitation about giving a name (not an outright decline,
         which handleGetName() already handles separately via isDecline())
         — reassure briefly and just move on to asking for email instead of
         looping on the same question. STATE is set BEFORE calling riley(),
         matching every other state transition in this file (riley()
         captures "whatever STATE is right now" and restores exactly that
         once the typing delay finishes). */
      STATE = 'get_email';
      return riley("No pressure — happy to skip that. What's the best email for me to send the details to?");
    }
    if (STATE === 'get_email') {
      /* Same idea as get_name — a hedge here isn't a decline, but looping
         on the same request isn't warm or helpful either. One gentle retry,
         then move on to booking without an email rather than stall the
         conversation. */
      if (UNCERTAIN_COUNT === 1) {
        return riley("No worries — just checking, is there an email I could send the package to? Totally fine to skip it too.");
      }
      return finalizeLead();
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
    riley("Nice! " + combined + "How do clients usually reach you — phone, website chat, WhatsApp/Instagram/Facebook, or a mix?");
  }

  function qualifyVolume() {
    STATE = 'qualify_volume';
    riley("Got it, thanks. And roughly how many " + channelLabel() + " a month, would you say?");
  }

  function recommend() {
    STATE = 'recommend';
    var pkg = getPackage();
    riley(volumeLine() + "*" + pkg.name + "* would be a great fit for you.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "\n• Included: " + pkg.mins + "\n• 36-month agreement, founding-client rate\n\n" + coverageSentence() + " I'd love to put 30 minutes on Tristan's calendar so we can get this live for you in 14 days — want me to set that up?");
  }
  /* Bug fix (CEO review round 2, item 6 — judgment call, see review notes).
     A single-channel omni reply (e.g. "just Instagram DMs, nothing else")
     correctly routes to Package C, Omnichannel Front Desk — that's not a
     misclassification, since Package A (phone only) and Package B (phone +
     website chat) genuinely don't cover any social channel at all in this
     pricing model (see CLAUDE.md's package table); Package C is the ONLY
     tier that covers social media, full stop, regardless of whether the
     prospect uses one platform or five. The routing was correct; the old
     phrasing wasn't — "Covers Instagram DMs, fully automated." paired with
     a package literally named "Omnichannel" reads as self-contradictory to
     a sharp prospect (singular channel vs. a name that implies "many").
     Fix is phrasing-only: frame the single channel as one entry point into
     the same shared front desk as the other channels, instead of a bare
     "covers X" claim that implies X is the whole story. Every non-omni
     tier (phone/chat) is untouched — this reframing only applies when
     CHANNEL_HINT is 'omni' and a specific CHANNEL_RAW term was captured;
     the generic "mix of everything" case (no specific CHANNEL_RAW) still
     uses the original, uncontradictory channelCopy() line. */
  function coverageSentence() {
    if (CHANNEL_HINT === 'omni' && CHANNEL_RAW) {
      /* Exclude whichever channel(s) overlap with CHANNEL_RAW itself
         (case-insensitive substring check either direction) so a reply
         like "just WhatsApp" doesn't produce the visibly duplicated
         "WhatsApp runs through the same front desk as ... WhatsApp ...". */
      var raw = CHANNEL_RAW.toLowerCase();
      var others = ['phone', 'website chat', 'WhatsApp', 'Instagram', 'Facebook'].filter(function (c) {
        var cl = c.toLowerCase();
        return raw.indexOf(cl) === -1 && cl.indexOf(raw) === -1;
      });
      var othersLabel = others.length > 1
        ? others.slice(0, -1).join(', ') + ' & ' + others[others.length - 1]
        : others.join(', ');
      return CHANNEL_RAW + ' runs through the same front desk as ' + othersLabel + ' — all fully automated.';
    }
    return 'Covers ' + (CHANNEL_RAW || channelCopy()) + ', fully automated.';
  }

  /* ── Lead capture (name + email) ───────────────────────────────
     Runs after a genuine affirmative at 'recommend' state, before the
     actual booking confirmation. This is the real point of a lead-gen
     demo — previously showBooking() went straight to a confirmation card
     that hardcoded Axoncore's OWN contact email in the "email" row,
     never once asking the visitor for theirs. Skips straight to email if
     USER_NAME was already picked up earlier (e.g. "I'm Sarah" during
     greet), so a visitor who already introduced themselves isn't asked
     their own name twice. */
  function startLeadCapture() {
    if (!USER_NAME) {
      STATE = 'get_name';
      return riley("Wonderful! First, who am I speaking with?");
    }
    STATE = 'get_email';
    return riley("Wonderful, " + USER_NAME + "! What's the best email for me to send the details to?");
  }
  function handleGetName(txt) {
    if (isDecline(txt)) {
      /* A visitor who'd rather not share their name shouldn't be pushed —
         just move on to email, the one field that actually matters for
         following up. */
      STATE = 'get_email';
      return riley("No problem at all — just an email then, so I can send the details over?");
    }
    /* Strip a self-intro lead-in ("I'm Sarah" / "It's Sarah" / "call me
       Sarah") before validating, so looksLikeBusinessName()'s leading-
       pronoun guard (which exists to reject sentence-shaped replies like
       "we don't have one yet") doesn't wrongly reject the single most
       natural way someone introduces themselves. Reuses the same
       battle-tested hostile-input/structural guard the business-name
       capture uses above rather than a bespoke check — a skeptical
       visitor typing something like "this is a scam" here gets the same
       protection it already gets at greet. */
    var stripped = txt.trim().replace(/^(i'm|i am|my name is|name's|it's|its|this is|call me)\s+/i, '');
    var candidate = stripped.replace(/[.,!?;:]+\s*$/, '').trim();
    if (candidate && candidate.length <= 40 && looksLikeBusinessName(candidate)) {
      USER_NAME = titleCaseBusinessName(candidate);
    }
    STATE = 'get_email';
    return riley((USER_NAME ? "Great to meet you, " + USER_NAME + "! " : "Great, thanks! ") + "What's the best email for me to send the details to?");
  }
  function handleGetEmail(txt) {
    if (isDecline(txt)) {
      /* Same principle as handleGetName() above — respect the "no" and
         still get them booked, rather than stall the conversation over a
         field they've chosen not to share. */
      return finalizeLead();
    }
    var emailMatch = txt.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (emailMatch) {
      USER_EMAIL = emailMatch[0].replace(/[.,!?;:]+\s*$/, '');
      return finalizeLead();
    }
    EMAIL_ATTEMPTS++;
    /* One gentle retry, then move on — mirrors the escalation pattern
       used throughout this file (handleUncertain(), fastTrackIntercept())
       so a mistyped email can't loop the conversation forever. */
    if (EMAIL_ATTEMPTS >= 2) {
      return finalizeLead();
    }
    return riley("Hmm, that doesn't quite look like a full email address — mind typing it again?");
  }
  function finalizeLead() {
    return showBooking();
  }

  function showBooking() {
    STATE = 'book';
    riley("Perfect, locking that in now!", function () {
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
          if (rows[2]) rows[2].querySelector('.rp-confirm__val').textContent = USER_EMAIL || 'On file';
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
  /* Shared by the isDigitAnswerAtVolume check and the qualify_volume
     parser itself (broader audit pass — see both call sites for the bug
     this fixes). Finds the first digit run in txt that ISN'T tagged with
     a trailing "%" — a percentage used as a hedge ("not 100% sure") is
     never the volume answer, even though it contains a digit. Returns the
     comma-stripped digit string, or null if every number found was
     %-tagged (or there were none). */
  function extractVolumeNumber(txt) {
    var tokens = txt.match(/\d[\d,]*\s*%?/g) || [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].indexOf('%') === -1) return tokens[i].replace(/[,\s]/g, '');
    }
    return null;
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
    'no clue', 'not certain', 'not really sure',
    /* Broadened (item 3) — casual real-world ways people express not
       knowing that the original list didn't cover. Each was checked
       against DECLINE_PHRASES/DECLINE_WORDS, BOOKING_AFFIRM_WORDS, and
       every FAQ_*_WORDS list before being added:
       - "idk" / "couldn't tell you" / "couldn't say" / "hard to say" /
         "beats me" / "who knows" / "no clue really" / "not too sure" /
         "not 100% sure" — no overlap with any existing list.
       - "not really" is the one phrase here worth flagging: it's a
         genuine substring of "not really interested" (a decline). It
         still can't cause an unconsented booking — isUncertain() only
         ever routes to handleUncertain(), which never calls
         showBooking() — so the worst case is a hedge-style reply instead
         of the decline-specific acknowledgment, not a wrong/broken
         outcome. Verified in the test harness below. */
    'idk', "couldn't tell you", "couldn't say", 'hard to say', 'not really',
    'beats me', 'who knows', 'no clue really', 'not too sure', 'not 100% sure'
  ];
  function isUncertain(txt) {
    return matchAny(txt, UNCERTAIN_PHRASES);
  }
  /* Bug fix (item 1) — bare greeting/small-talk detection for the greet
     state. Deliberately conservative: only fires when the ENTIRE reply is
     a greeting phrase, or a short (<=4 word) reply whose every word is
     either a greeting word or an obvious filler ("hi there", "hey
     riley"). Anything longer, or containing a word outside both lists
     ("hi, bakery"), is treated as real content and falls through to the
     normal business-capture logic instead — a greeting prefix should
     never swallow an actual answer. */
  var GREETING_WORDS = [
    'hi', 'hello', 'hey', 'hiya', 'yo',
    'good morning', 'good afternoon', 'good evening',
    'morning', 'afternoon', 'evening',
    'thanks', 'thank you'
  ];
  var GREETING_FILLER_WORDS = ['there', 'riley', 'good', 'so', 'much', 'a', 'lot', 'guys', 'team'];
  function isGreeting(txt) {
    var stripped = txt.replace(/[^a-z\s']/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!stripped) return false;
    for (var i = 0; i < GREETING_WORDS.length; i++) {
      if (stripped === GREETING_WORDS[i]) return true;
    }
    var words = stripped.split(' ');
    if (words.length > 4) return false;
    var hasGreetingCore = GREETING_WORDS.some(function (g) { return stripped.indexOf(g) !== -1; });
    if (!hasGreetingCore) return false;
    return words.every(function (w) {
      return GREETING_WORDS.indexOf(w) !== -1 || GREETING_FILLER_WORDS.indexOf(w) !== -1;
    });
  }
  /* Rotates so a caller who says "hi" more than once before answering
     doesn't see the exact same acknowledgment twice (same pattern as
     fastTrackIntercept()/handleDecline()/handleUncertain()'s rotating
     lines). Warmed up from the earlier terse "C-suite calibration" pass —
     the current brief calls for a nice, warm, helpful tone across every
     business size, not just a clipped register aimed at skeptical
     executives, so a friendly opener is the better default here. */
  function greetingAck(txt) {
    var isThanksOnly = /\b(thanks|thank you)\b/.test(txt) && !/\b(hi|hello|hey|hiya|yo|morning|afternoon|evening)\b/.test(txt);
    if (isThanksOnly) return "You're welcome! So, what's the business?";
    var lines = ["Hi there! What's the business?", "Hey! Good to meet you — what's the business?", "Hello! Happy to help — what's the business?"];
    var line = lines[Math.min(GREET_ACK_COUNT, lines.length - 1)];
    GREET_ACK_COUNT++;
    return line;
  }
  /* See call site in the greet-state handler above (CEO review round 6,
     item 2). Rotates like greetingAck()/handleDecline() so a visitor who
     declines more than once before answering doesn't see the same line
     twice. Deliberately doesn't mention "the offer" or pricing (unlike
     handleDecline(), which runs post-recommendation) — nothing has been
     discussed yet at this point, so referencing an offer would be
     premature. Ends by re-opening the same question rather than closing
     the conversation, matching Riley's real voice-agent rule: after
     hesitation, always continue. */
  function greetDeclineAck() {
    var lines = [
      "No pressure at all — happy to just answer questions if that's easier. What's the business, whenever you're ready?",
      "All good, no obligation here. I can explain how this works first if that helps, or just tell me about the business.",
      "Understood. Ask me anything, or tell me about the business if you want to see what I'd recommend."
    ];
    var line = lines[Math.min(GREET_DECLINE_COUNT, lines.length - 1)];
    GREET_DECLINE_COUNT++;
    return line;
  }
  /* Bug fix (CEO review round 2, item 4) — see call site in the greet-state
     handler above. Strips a single leading greeting word/phrase (from
     GREETING_WORDS) plus any immediately-following punctuation/whitespace
     ("hi, " / "hey — " / "morning, ") from the front of txt, so real
     content that follows a greeting fragment ("hi, bakery" → "bakery")
     can be evaluated on its own instead of the greeting prefix riding
     along into whatever gets captured next. Returns txt unchanged
     (no-op) when there's no leading greeting word to strip. Regex is
     rebuilt on each call rather than cached at module scope — this is a
     low-frequency fallback path (fires once per conversation at most),
     not a hot loop, so the simplicity is worth the trivial repeat cost. */
  function stripLeadingGreetingFragment(txt) {
    var pattern = new RegExp(
      '^(?:' + GREETING_WORDS.map(escapeRegex).join('|') + ')\\b[\\s,.:;!-]*',
      'i'
    );
    return txt.replace(pattern, '');
  }
  /* FAQ keyword lists, pulled out of the intercepts in respond() so the
     isUncertain() bypass above can check the exact same lists. A message
     containing an uncertainty phrase can still be a genuine, answerable
     FAQ question ("I have no idea how much this costs", "not sure if
     this is even real") — matchesFaqKeywords() lets respond() detect that
     and skip handleUncertain() in favor of actually answering it. */
  var FAQ_PRICE_WORDS = ['price', 'cost', 'how much', 'pricing', 'sgd', 'dollar'];
  /* Checked ahead of FAQ_HOWITWORKS_WORDS in respond() — "what do you do" /
     "what do you offer" is a request for the product lineup (the three
     packages), not the mechanics of how the AI answers a call, so it's kept
     as its own list rather than folded into FAQ_HOWITWORKS_WORDS where it
     used to live. */
  var FAQ_SERVICES_WORDS = [
    'what do you do', 'what does axoncore do', 'what do you offer',
    'what services', 'what packages', 'what do you sell', 'what is axoncore',
    'tell me about axoncore', 'what does this company do'
  ];
  var FAQ_HOWITWORKS_WORDS = ['how does it work', 'how do you work', 'capabilities', 'can you do', 'features'];
  /* "What if I need to change something later" — a realistic, slightly
     awkward question with a real cost attached (a flat SGD $300 per
     revision once live, hosting/maintenance itself stays free). Riley
     should answer this accurately rather than dodge it. */
  var FAQ_REVISION_WORDS = [
    'change the price', 'change the pricing', 'change the script',
    'change the faq', 'update the script', 'update the pricing',
    'edit the script', 'revision', 'change my pricing', 'update my pricing',
    'change something later', 'change it later'
  ];
  /* Split into a specific-phrase list and a bare-single-word list (round 4
     fix — see matchesRealAiFaq() below) rather than one flat FAQ_REALAI_WORDS
     list. The bare words ('ai'/'bot'/'robot'/'fake') are deliberately broad
     — that's fine at every state EXCEPT greet, where they collide with a
     business description that legitimately contains that vocabulary: "we're
     an AI consulting firm" and "we run a fake plant store" were both getting
     intercepted by the real-AI FAQ answer instead of registering as the
     business, because this check runs ahead of the greet-state capture in
     respond() and a bare substring match fires on ANY reply containing
     "ai"/"bot"/"fake"/"robot", qualifying answer or not. Same class of fix
     already applied to 'real'/'human' (narrowed to 'are you real'/'is this
     real'/etc. phrases below) for the exact same collision. */
  var FAQ_REALAI_PHRASES = [
    'are you real', 'are you human', 'are you a human', 'are you a bot',
    'are you a robot', 'is this real', 'is this a bot', 'real ai',
    'actual human', 'real person', 'talking to a bot', 'talking to a human',
    'even real', 'actually real'
  ];
  var FAQ_REALAI_BARE_WORDS = ['ai', 'bot', 'robot', 'fake'];
  /* Used everywhere the old flat matchAny(txt, FAQ_REALAI_WORDS) check used
     to be called (the intercept in respond() and matchesFaqKeywords() below)
     so both stay in sync. The specific phrases always count as a real-AI
     question, at any state — a business description answering "what's the
     business?" is very unlikely to also contain "are you really an AI?" in
     the same breath. The bare single words only count outside greet state;
     a genuinely skeptical "is this an ai?" one-word-ish probe at any OTHER
     point in the conversation (recommend/book/qualify_*) still gets answered
     normally, since there's no competing qualifying capture to collide with
     there. */
  function matchesRealAiFaq(txt) {
    if (matchAny(txt, FAQ_REALAI_PHRASES)) return true;
    if (STATE === 'greet') return false;
    return matchAny(txt, FAQ_REALAI_BARE_WORDS);
  }
  /* New FAQ word lists (dialogue spec v2, Section 5 items 7-8) — a
     sophisticated skeptical prospect asking about error rate/liability or
     36-month contract risk previously had no answerable branch and fell
     through to the generic fallback. Included in matchesFaqKeywords() too,
     for the same reason the original three lists are: an uncertainty
     phrase ("not sure I trust locking into 36 months") can still be a
     genuine, answerable question, and the more specific FAQ signal should
     win over the generic uncertainty heuristic. */
  /* Plural/inflection fix (found during adversarial review of the warmth
     redesign) — matchAny()'s \bWORD\b wraps each entry with a word
     boundary on BOTH sides, so a phrase ending in a plain noun only
     matches the EXACT singular form: 'double book' has no boundary
     between the 'k' and the 'i' in "double bookings" (both word
     characters), so it silently failed to match — same for 'error rate'
     vs "error rates", '36 month' vs "36 months", 'mistake' vs "mistakes",
     'contract' vs "contracts", 'cancel' vs "cancellation". Left uncaught,
     these ordinary, grammatically natural phrasings fell all the way
     through to the greet-state bare-name fallback and got echoed back
     verbatim as if they were the business name (e.g. "For a Worried
     About Double Bookings —") — the exact "echo hostile/off-topic input
     as a business name" failure class the file's 12 prior structural
     hostile/decline fixes exist to prevent, just via a different
     mechanism (an ordinary plural, not an insult or decline). Fixed by
     adding the realistic inflected variants directly, rather than
     loosening matchAny() itself — matchAny() is shared by every word list
     in this file, including the hostile/decline lists, where the strict
     boundary is exactly what keeps short words safe from collision. */
  var FAQ_RELIABILITY_WORDS = [
    'error rate', 'error rates', 'liable', 'liability', 'liabilities',
    'double-book', 'double-books', 'double-booked', 'double-booking',
    'double book', 'double books', 'double booked', 'double booking',
    'double bookings', 'mistake', 'mistakes', 'hallucinate', 'hallucinates',
    'hallucinating', 'hallucination', 'hallucinations',
    'what if you get it wrong', 'accuracy'
  ];
  var FAQ_CONTRACT_WORDS = [
    '36-month', '36-months', '36 month', '36 months', 'lock in', 'locks in',
    'lock-in', 'locked in', 'contract', 'contracts', 'cancel', 'cancels',
    'cancelling', 'canceling', 'cancellation', 'cancellations',
    'get out of', 'exit clause', 'exit clauses', 'never heard of you',
    'never heard of', "haven't heard of"
  ];
  function matchesFaqKeywords(txt) {
    return matchAny(txt, FAQ_PRICE_WORDS) || matchAny(txt, FAQ_SERVICES_WORDS) ||
      matchAny(txt, FAQ_HOWITWORKS_WORDS) || matchesRealAiFaq(txt) ||
      matchAny(txt, FAQ_RELIABILITY_WORDS) || matchAny(txt, FAQ_CONTRACT_WORDS) ||
      matchAny(txt, FAQ_REVISION_WORDS);
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function nextPrompt() {
    if (STATE === 'greet')           return "What's the business?";
    if (STATE === 'qualify_channel') return 'How do clients reach you?';
    /* Bug fix (CEO review round 2, non-blocking item 4): this used to be
       hardcoded to 'How many enquiries a month?' regardless of channel,
       which drifted from qualifyVolume()'s channel-aware wording ("how
       many calls" / "website messages" / "enquiries across your
       channels"). Reuses channelLabel() so a fast-track/FAQ intercept that
       falls back to nextPrompt() here says the same thing qualifyVolume()
       would have. */
    if (STATE === 'qualify_volume')  return 'How many ' + channelLabel() + ' a month?';
    if (STATE === 'get_name')        return 'Who am I speaking with?';
    if (STATE === 'get_email')       return "What's the best email for the details?";
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
  /* Bug fix (broader audit pass): businessTypeLine() used to hardcode
     "for a " — harmless while every BUSINESS_RAW capture came from the
     "i run/we run/i'm a/..." lead-in list (which always implies "a X"
     grammatically), but the new "i'm an accountant" support (item 2/4
     above) and the bare-name fallback (item 2) can both now produce a
     BUSINESS_RAW that starts with a vowel sound ("accountant", "agency"),
     which read as the broken "For a accountant —". Picks "a"/"an" off the
     first letter — an imperfect but standard lightweight heuristic
     (misses "a university"-style exceptions), consistent with the rest of
     this file's heuristic-based, not exhaustive, approach. */
  function articleFor(s) {
    return /^[aeiou]/i.test(s) ? 'an' : 'a';
  }
  function businessTypeLine() {
    if (BUSINESS_RAW) return 'for ' + articleFor(BUSINESS_RAW) + ' ' + BUSINESS_RAW + ' — ';
    if (BUSINESS_TYPE && BUSINESS_TYPE !== 'other' && BUSINESS_TYPE_LABELS[BUSINESS_TYPE]) {
      var label = BUSINESS_TYPE_LABELS[BUSINESS_TYPE];
      return 'for ' + articleFor(label) + ' ' + label + ' — ';
    }
    return '';
  }
  /* Bug fix (item 2) — guards the bare-business-name fallback in the
     greet-state handler above. Deliberately conservative so it only
     swallows text that plausibly IS just a business name:
       - never fires on a real question (contains "?")
       - never fires on a bare greeting (isGreeting()) — those are
         already handled separately and shouldn't double up here
       - never fires on a bare yes/no/filler word — not a name
       - never fires on a reply that opens with a first-person pronoun
         ("I'm swamped today", "we don't really have one") — those are
         sentences ABOUT the business, not the name itself, and bizMatch
         above already owns the "I run/we run/I'm a/..." lead-in forms;
         swallowing the whole sentence verbatim here would produce a
         broken-looking "business name" like "We Don't Really Have One".

     Bug fix (CEO review round 2, item 1) — none of the guards above catch
     a hostile/junk probe like "this is a stupid chatbot": it's not a
     question, not a greeting, not a bare yes/no, and doesn't open with a
     first-person pronoun, so it fell straight through and got title-cased
     and echoed back as if it were a respected business name ("For a This
     Is A Stupid Chatbot — ...").

     Round 2's fix was a single-word denylist (HOSTILE_JUNK_WORDS: stupid/
     dumb/useless/sucks/lame/awful/terrible/"hate this"/chatbot). That
     turned out to be whack-a-mole and provably not convergent: "garbage"
     had to be dropped before round 2 shipped because "Garbage Removal Co"
     is a completely plausible real business name, and round 3's review
     caught the exact same collision for "terrible" ("Terrible's BBQ" was
     silently blocked — dropped to empty BUSINESS_RAW, same "no callback"
     failure the denylist was supposed to prevent) while "this is a scam"
     — arguably the single most obvious adversarial probe a skeptical
     prospect would try — sailed straight through untouched because
     "scam" was never on the list. Any single common adjective kept in a
     denylist will eventually collide with a real name; any one removed
     re-opens a hostile-input hole. Replaced with two structural checks
     that don't grow or shrink with more words:

     1. HOSTILE_LINKING_VERB_RE — a real business name is a noun phrase,
        not a sentence. It essentially never starts with "this is"/
        "that is"/"that's"/"thats" used as a linking-verb complaint
        ("this is a scam", "this is stupid", "that's rubbish") — those
        structures state something ABOUT a thing, they don't name one.
        Guarded with "AND does not contain 'call'" so a genuine "this is
        called X" phrasing (if it ever reached this far instead of being
        claimed by the bizMatchName lead-in regex above) isn't wrongly
        rejected — belt-and-suspenders, since that overlap should already
        be moot in practice.
     2. HOSTILE_EXACT_PHRASES — a short list of common brush-off idioms
        that don't start with "this is"/"that is" ("screw this", "waste
        of time", "get lost", "not interested in this"), matched against
        the ENTIRE trimmed reply (not a substring), so they can never
        collide with a longer real name that merely happens to contain
        one of those words.

     Every single-adjective word from the old denylist (stupid, dumb,
     awful, lame, terrible, useless, garbage, sucks, hate this) is now
     DROPPED entirely — each one is a plausible fragment of a real
     business name (proven twice over: "Garbage Removal Co", "Terrible's
     BBQ"; the same collision would eventually hit every other word on
     that list too, e.g. "Awful Waffle Co", "Useless Bay Coffee",
     "Stupid Cupid Cafe" — all real-shaped names verified to pass through
     cleanly with the old list removed). "chatbot" is also dropped — "this
     is a stupid chatbot" is now caught by the linking-verb structural
     check instead of a bespoke word.

     Round 4 regression fix: round 3's HOSTILE_LINKING_VERB_RE rejected
     ANY "this is X"/"that's X" reply outright, on the theory that a real
     business name is a noun phrase, not a linking-verb sentence. That
     theory was wrong often enough to matter — plenty of real business
     names are themselves phrased exactly that way: "That's Amore",
     "That's Italian", "That's Life Counselling", "This Is It BBQ", "This
     is Sparta Gym" all silently lost their BUSINESS_RAW capture, the same
     "no callback" failure class every earlier round of this fix was
     trying to close. The structural insight (real names don't read as
     complete sentences complaining about something) is still right; it
     was just applied to the wrong trigger. What actually distinguishes
     "this is a scam" from "That's Amore" isn't the linking verb — both
     have one — it's whether an explicit negative/insult word follows it.
     Narrowed to require BOTH: the linking-verb prefix AND one of a short,
     explicit insult-word list (HOSTILE_INSULT_WORDS) appearing anywhere in
     the reply. This keeps rejecting "this is a scam" / "this is stupid" /
     "that's rubbish" while correctly letting "That's Amore" / "This Is It
     BBQ" fall through to the name capture. The old "AND does not contain
     'call'" guard is dropped as no longer needed — a genuine "this is
     called X" never contains an insult word either, so it was never at
     risk under the new, narrower check. */
  var HOSTILE_LINKING_VERB_RE = /^(this is|that is|that's|thats)\b/i;
  /* CEO review round 5 — 'garbage' and 'waste' removed as single WORDS.
     Both are exactly the failure class this file has already learned to
     avoid twice: "This is Garbage Removal Co" / "This is Waste Management
     Solutions" are ordinary self-introductions for real businesses, not
     hostile input, and bare 'garbage'/'waste' as single-word signals were
     silently rejecting them the same way bare 'garbage' collided with
     "Garbage Removal Co" in an earlier denylist round.

     Correction to this comment's earlier (wrong) claim: "this is a waste
     of time" is NOT caught by HOSTILE_EXACT_PHRASES below on its own,
     because that list requires the ENTIRE trimmed reply to equal the
     phrase, not just contain it — "this is a waste of time" != "waste of
     time". Verified via test harness this was a real hole the word removal
     opened.

     A frozen 3-word phrase ("waste of time") turned out to be too narrow
     (missed "this is a waste" with no "of time" at all, and "waste of MY
     time" — one inserted word broke the literal substring) AND left
     "garbage" with zero coverage as a bare insult ("this is garbage" sailed
     through uncaught). CEO review round 6 caught both as reproducible.

     Root fix: HOSTILE_BARE_INSULT_RE below matches "garbage"/"waste" only
     when nothing but an optional "of [pronoun] time" tail follows it to
     the end of the reply — i.e. it's the last substantive word, the shape
     of "this is garbage" / "this is a waste" / "this is a waste of my
     time". The moment more words continue past it ("garbage Removal Co",
     "waste Management Solutions"), the anchor-to-end-of-string fails and
     it's correctly treated as a business name continuing, not an insult.
     This is the same structural-shape-over-denylist principle as
     HOSTILE_LINKING_VERB_RE itself — match the grammatical shape of an
     insult, not just the word's presence. */
  var HOSTILE_INSULT_WORDS = [
    'scam', 'joke', 'rubbish', 'stupid', 'crap', 'bs',
    'bullshit', 'ridiculous', 'pointless'
  ];
  var HOSTILE_BARE_INSULT_RE = /\b(garbage|waste)\b(\s+of\s+(my|your|our|his|her|their)?\s*time)?\s*[.,!?;:]*$/i;
  var HOSTILE_EXACT_PHRASES = [
    'screw this', 'waste of time', 'get lost', 'not interested in this'
  ];
  /* Low-effort, low-risk addition (round 4, optional item) — mirrors the
     HOSTILE_LINKING_VERB_RE structural check above for a second common
     hostile shape: "you are a scam" / "you're a joke" address the bot
     directly rather than naming a business, so — unlike "this is X" —
     there's no plausible real business name that starts with "you are"/
     "you're" for this to collide with. Reuses the same HOSTILE_INSULT_WORDS
     list rather than a separate one, for the same reason #1 above narrowed
     to that list: require the linking phrase AND an explicit insult word,
     not just the phrase alone. */
  var HOSTILE_YOU_ARE_RE = /^(you are|you're|youre)\b/i;
  function looksLikeBusinessName(txt) {
    if (txt.indexOf('?') !== -1) return false;
    if (isGreeting(txt)) return false;
    var trimmed = txt.trim();
    if (!trimmed) return false;
    var bareWords = ['yes', 'no', 'yeah', 'yep', 'nope', 'sure', 'ok', 'okay', 'nah'];
    if (bareWords.indexOf(trimmed) !== -1) return false;
    if (/^(i|i'm|im|we|we're|were|it's|its)\b/.test(trimmed)) return false;
    if (HOSTILE_LINKING_VERB_RE.test(trimmed) && (matchAny(trimmed, HOSTILE_INSULT_WORDS) || HOSTILE_BARE_INSULT_RE.test(trimmed))) return false;
    if (HOSTILE_YOU_ARE_RE.test(trimmed) && (matchAny(trimmed, HOSTILE_INSULT_WORDS) || HOSTILE_BARE_INSULT_RE.test(trimmed))) return false;
    var normalized = trimmed.toLowerCase().replace(/[.,!?;:]+\s*$/, '').trim();
    if (HOSTILE_EXACT_PHRASES.indexOf(normalized) !== -1) return false;
    return true;
  }
  /* A bare business name is a proper noun and should read as one ("Tony's
     Pizza"), unlike bizMatch's lead-in captures above (deliberately left
     lowercase — see the comment at that capture site for why). Simple
     per-word capitalization; good enough for the common case without
     needing a full proper-noun/acronym dictionary. */
  function titleCaseBusinessName(s) {
    return s.split(/\s+/).map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
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
    var colors = ['#5A3FB8','#6D4FD1','#4ade80','#fbbf24','#f472b6'];
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
