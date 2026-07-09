# Riley Demo Dialogue Spec — v2 "C-Suite Calibration"

**File under spec:** `riley-demo.js` (currently 663 lines, vanilla JS, deterministic state machine — no LLM, no external API calls)
**Author:** Prompt Engineer (content/behavior spec, not code)
**Date:** 2026-07-10
**Status:** Ready for implementation. Do not modify `riley-demo.js` from this doc directly — hand to engineering.
**Supersedes:** the tone/copy pass already shipped (emoji removal, "Love the energy!" removal, de-duplicated "no worries" openers). This is a further pass on top of that baseline.

---

## 0. The brief, restated precisely

Tristan's bar: *if Elon Musk or Jeff Bezos personally typed into this demo, would the interaction read as competent, sharp, and worth their time* — not "inoffensive," but actively impressive. Two deliverables in one: (1) elevate every line of dialogue, and (2) make the bot *demonstrate* comprehension within a keyword-matching architecture that has no real NLU.

This spec treats those as separate problems on purpose. A voice rewrite alone cannot produce "comprehension" — it can only stop contradicting the illusion of it. Actual comprehension-reads require new state (Section 2) that the current architecture doesn't track yet. Sections are ordered so an engineer can implement in one pass: read Section 2 for what to build, Section 3 for what every string becomes, Section 4 to see it prove out end-to-end, Section 5 as the buildable checklist.

---

## 1. Voice principles for Riley (C-suite calibration)

Riley today is warm, hedge-y, exclamation-heavy small-business-vendor voice ("Got it!", "No worries at all!", "Sure thing!", "Glad to hear it!"). That voice is calibrated for a nervous solo restaurant owner who needs reassurance. It reads as *junior* to a founder-tier prospect — over-explaining, over-reassuring, apologizing for asking questions. Musk/Bezos-tier operators read excess warmth as either uncertainty or a sales tactic, and they're allergic to both.

**Five voice principles — each is a rule an engineer can literally check a line against:**

1. **No acknowledgment-only openers.** Riley never spends a clause confirming it heard you ("Got it.", "Understood.", "No worries.", "Sure thing.") before doing something. If acknowledgment is needed, it's folded into the same sentence as forward motion: not "Got it. Now, how many calls a month?" but "At what volume — monthly call count — does this operate?" Rationale: filler-then-question reads as two sentences doing the work of one; a sharp operator notices the padding immediately.

2. **State mechanism and numbers, not feelings.** Replace reassurance-language ("no stress," "no pressure at all," "take your time") with operational facts (what happens next, what it costs, what the number was). "No pressure at all — whenever you're ready" is Riley managing the *prospect's emotional state*, which is presumptuous with this audience. "The offer holds; here's what changes if you wait" states a fact and lets them decide. Rationale: reassurance implies Riley assumed hesitation or anxiety that may not exist — a confident operator doesn't need to be told twice that there's no pressure.

3. **Callback specificity over generic nouns.** Every reference to "your business," "your enquiries," "your setup" that *can* instead name the actual thing the user said (business type, channel, volume number) must do so. This is the load-bearing mechanic for the "comprehension" requirement — see Section 2 for exactly what state makes this possible and where it's still generic because the architecture can't support more.

4. **One claim per sentence, active voice, no qualifier words.** Strip "just," "really," "actually," "totally," "literally," "basically" — these are hedges, and a hedge in front of a factual claim reads as the speaker not fully believing it. "It's actually pretty simple" becomes "Here's how it works." "Just need your setup first" becomes "Setup, then the number is exact."

5. **The offer is stated once per turn, precisely, then dropped — never chased.** Riley states the strategy-call offer with the same confidence each time and does not add urgency, extra reassurance, or a second ask in the same message. Over-explaining why there's "no pressure" reads as pressure. If the user hedges, Riley's next line does new work (a sharper fact, a callback) rather than repeating the offer with softer padding.

**A negative test for any drafted line:** if you can imagine the sentence in a chirpy SaaS onboarding-tour tooltip, it fails principle 1, 2, or 4 and needs a rewrite.

---

## 2. What "comprehension" means in a keyword-matched, stateless-dialogue architecture

There is no NLU here — Riley cannot understand a sentence, only detect patterns in it. "Comprehension" in this demo has to be operationalized as: **the illusion of comprehension is produced when later dialogue correctly references specifics the user stated earlier, and when input classification correctly handles realistic full-sentence phrasing, not just the current single-keyword replies.** Below is exactly what to add, state-variable by state-variable, each flagged with what's achievable with existing state vs. what requires new state.

### 2.1 New state variables required

| New variable | Type | What it tracks | Set where |
|---|---|---|---|
| `BUSINESS_TYPE` | string enum: `'restaurant'\|'salon'\|'clinic'\|'realestate'\|'legal'\|'other'` | Classified category of the business, from the greet-state reply | New `classifyBusinessType()` called from `respond()` when `STATE === 'greet'` |
| `BUSINESS_RAW` | string, capped, ≤ 40 chars | The user's own noun phrase for their business if captured via regex (e.g. "boutique nail salon", "family dental clinic") — used verbatim so callbacks sound like they were *heard*, not classified | Same greet-state handler, via a new capture regex (2.4) |
| `VOLUME_NUMBER` | integer or `null` | The actual monthly number the user gave (if any), not just the lite/standard/pro bucket | `qualify_volume` handler, alongside existing bucket logic |
| `CHANNEL_RAW` | string or `''` | The specific channel word the user actually used if more specific than the bucket (e.g. "Instagram DMs" instead of just "omni") | `qualify_channel` handler |

None of these require new UI, storage, or persistence — they're plain module-scope `var`s exactly like `CHANNEL_HINT`/`VOLUME_HINT` today, reset at the same points those are (they aren't reset anywhere currently — that's fine, a single demo session doesn't need to loop).

### 2.2 Capability-by-capability breakdown

**(a) Reference business type instead of "your business" — NEW STATE REQUIRED (`BUSINESS_TYPE`, `BUSINESS_RAW`)**
Currently nothing captures what business the user said they run; the greet handler only extracts a name via `nameMatch`. Add a classifier so `qualifyChannel()`, `recommend()`, and the reliability/contract answers (2.3) can say "for a dental clinic" or, better, echo their own words: "for a boutique nail salon like yours." Falls back to generic "a business like yours" only if nothing classifies — which will still happen for truly odd input, and that's fine; forcing a bad guess is worse than the graceful generic.

**(b) Adapt channel-qualifying question phrasing to business type — ACHIEVABLE, low cost**
E.g., for a classified restaurant, the channel question can front-load the channel operators like that business actually use ("reservations by phone, or messages through Instagram/your website?") instead of the fully generic list. Nice-to-have, not required for the illusion to land — ship if time allows, cut first if not.

**(c) Reference the actual number given, not just the bucket — ACHIEVABLE with `VOLUME_NUMBER`**
`recommend()` currently says generic "This covers phone calls 24/7." With `VOLUME_NUMBER` stored, it can say "At roughly 180 enquiries a month, here's what scales:" — a concrete callback that reads as the system having actually processed the input, not templated it.

**(d) Reference the specific channel the user named — ACHIEVABLE with `CHANNEL_RAW`**
If the user typed "mostly Instagram DMs and the odd phone call," store `'Instagram DMs'` as `CHANNEL_RAW` (first specific proper-noun-ish channel term matched) and use it in `recommend()`'s coverage line instead of the generic `channelCopy()` bucket text, when available.

**(e) Handle full-sentence, multi-channel input correctly — REQUIRES A LOGIC FIX, not just new state**
Current `qualify_channel` branch checks phone-words first, then omni-words, then chat-words, in that order, and returns on the *first* match. A sentence like "we take calls but most people just message us on the website" mentions both phone and chat — under current code it's misclassified as `'phone'` only, because the phone check runs first and returns immediately. This is a real comprehension failure a sharp user will notice ("I said messages too — why phone only?"). Fix: check all three categories, and if **two or more** match, classify as `'omni'` regardless of order. Only classify as single-channel when exactly one category matches. (Detailed in Section 5.)

**(f) Handle numeric ranges and thousands separators in volume answers — REQUIRES A BUG FIX**
`qualify_volume` parses the number via `txt.replace(/[^0-9]/g, '')` then `parseInt`, which **strips out separators and concatenates remaining digits**. "150-200 a month" becomes the digit string `"150200"` → `parseInt` reads **150,200**, wildly out of range and would over-trigger the `pro` bucket on a nonsense number. This is exactly the kind of phrasing a precise, numbers-literate prospect (a Musk/Bezos type would absolutely say "150 to 200" rather than rounding) would use, and today it silently breaks. Fix: extract the **first standalone number** via regex (e.g. `/\d[\d,]*/` on the original text, then strip commas from just that match) instead of concatenating all digits in the string. Also handle "k" shorthand ("2k a month" → 2000) if feasible. (Detailed in Section 5.)

**(g) Answer sharper objections the current 3 FAQ intercepts don't cover — REQUIRES NEW BRANCHES**
Current FAQ intercepts only cover price, how-it-works, and "are you real." A sophisticated skeptical prospect asks about reliability/liability ("what's your error rate, who's liable if you double-book someone") or contract risk ("why would I lock into 36 months with a company I've never heard of"). Neither is answerable today — it falls through to the generic fallback ("Got it. " + nextPrompt()), which would visibly embarrass the demo in front of exactly the audience this is being upgraded for. Two new FAQ intercepts are specified in Section 3.13–3.14 and Section 5.

### 2.3 What stays generic, honestly

Not every gap is worth closing for a demo widget. Left as generic on purpose (flag if this changes):
- No memory across page reloads / sessions — fine, it's a single-sitting demo.
- No handling of compound multi-part questions in one message (e.g., "what's the price AND how does booking work") — the intercepts are exclusive `if` returns; only the first matched category answers. Cheap fix would be a length check but it adds branching complexity disproportionate to demo value. **Not recommended for this pass** — flag as known limitation instead (Section 6).
- No true entity extraction beyond the regexes in 2.4 — a name typo or unusual name format may fail to capture. Acceptable; `USER_NAME` is cosmetic, not load-bearing.

### 2.4 New regex/capture specs

```
BUSINESS_RAW capture (in greet handler, alongside existing nameMatch):
  /(?:i run|i own|we run|we own|we have|i have|we're a|i am a|i'm a|it's a|its a)\s+(?:a |an |the )?([a-z][a-z\s&'-]{1,38})/i
  → capture group 1, trim trailing punctuation, cap first letter, store as BUSINESS_RAW.
  If no match, BUSINESS_RAW stays ''.

BUSINESS_TYPE classifier (classifyBusinessType(txt), called same place):
  restaurant words:  ['restaurant','cafe','café','diner','eatery','bar','bistro','kitchen','food']
  salon words:       ['salon','spa','barber','nails','nail bar','aesthetics','beauty','wellness']
  clinic words:      ['clinic','dental','dentist','doctor','medical','physio','healthcare','practice']
  realestate words:  ['real estate','realtor','property','properties','agency','estate agent']
  legal words:       ['law firm','lawyer','legal','attorney','advocate']
  → first list that matchAny()-matches wins; else BUSINESS_TYPE = 'other'.

CHANNEL_RAW capture (in qualify_channel handler):
  Specific proper-noun-ish channel terms worth echoing verbatim if present:
  ['instagram dms','instagram','whatsapp','facebook messenger','facebook','tiktok','website chat','live chat']
  → first match (case-preserving from original txt, not lowercased) stored as CHANNEL_RAW; else ''.

VOLUME_NUMBER extraction (in qualify_volume handler, REPLACES current parseInt logic):
  var numMatch = txt.match(/\d[\d,]*/);
  var VOLUME_NUMBER = numMatch ? parseInt(numMatch[0].replace(/,/g, ''), 10) : null;
  (Optional "k" shorthand: if txt matches /(\d+(\.\d+)?)\s*k\b/i, multiply by 1000.)
```

---

## 3. Line-by-line dialogue rewrite

For each line: **Current** (verbatim from file, with line number), **Proposed**, **Rationale** (tied to a numbered voice principle from Section 1 and/or a comprehension capability from Section 2). Functional role — what fires it, what state it's part of, what concatenations exist — is preserved exactly; this is copy only unless a bracket note says otherwise.

### 3.1 Auto-greet (line 57)

> **Current:** "Hi, I'm *Riley* — Axon Core's AI receptionist. I answer calls, qualify leads, and book appointments 24/7.\n\nWhat kind of business do you run?"

> **Proposed:** "I'm Riley — Axon Core's AI receptionist. I handle inbound calls and messages, qualify the lead, and book the appointment, end to end, with no human in the loop.\n\nWhat's the business?"

Rationale: "I'm Riley" states the fact without the bolded self-introduction flourish; "with no human in the loop" is a sharper, more specific claim than "24/7" alone and previews the "how it works" answer without needing to be asked (principle 4). "What's the business?" is four words instead of nine — a founder-tier prospect doesn't need "What kind of business do you run?" softened with framing (principle 1).

### 3.2 `qualifyChannel()` (line 444)

> **Current:** (USER_NAME ? 'Nice to meet you, ' + USER_NAME + '! ' : 'Got it. ') + "Quick question — how do clients usually reach you? *Phone calls*, *website chat*, *WhatsApp / Instagram / Facebook*, or a mix of all of them?"

> **Proposed:** (USER_NAME ? USER_NAME + ' — ' : '') + businessTypeLine() + "How do clients reach you — phone, website chat, WhatsApp/Instagram/Facebook, or a mix?"

Where `businessTypeLine()` is a new small helper (Section 5) returning, e.g., `"For a "+BUSINESS_RAW+", that's usually "` when `BUSINESS_RAW` is set, else `''`. Example output: *"Tristan — for a boutique nail salon, that's usually phone, website chat, WhatsApp/Instagram/Facebook, or a mix?"* reads oddly grammatically — see the worked example in Section 4 for the cleaner phrasing actually used there; treat this as the mechanism, tune exact wording at implementation time to keep it grammatical per case.

Rationale: drops "Nice to meet you, X!" (too warm/small-talk for principle 1) in favor of using the name as a plain address, still personal without being saccharine. Drops "Got it." entirely per principle 1. Adds the business-type callback per capability 2.2(a)/(b).

### 3.3 `qualifyVolume()` (line 450)

> **Current:** "Got it. And roughly how many " + channelLabel + " does your business handle in a typical month?"

> **Proposed:** "And roughly how many " + channelLabel + " per month?"

Rationale: "Got it." removed (principle 1). "does your business handle in a typical month" compresses to "per month" — same information, four fewer words (principle 4). `channelLabel` logic (phone→"calls", chat→"website messages", else→"enquiries across your channels") is functionally unchanged.

### 3.4 `recommend()` (line 456)

> **Current:** "Based on what you've told me, I'd recommend our *" + pkg.name + "*.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "/mo\n• Includes: " + pkg.mins + "\n• 36-month agreement · Founding client rate\n\nThis covers " + channelCopy() + " — all handled automatically by your AI, 24/7. Want me to book you a free 30-minute strategy call with Tristan to get you live in 14 days?"

> **Proposed:** volumeLine() + "*" + pkg.name + "* fits.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "\n• Included: " + pkg.mins + "\n• 36-month agreement, founding-client rate\n\nCovers " + (CHANNEL_RAW || channelCopy()) + ", fully automated. I can put 30 minutes on Tristan's calendar to get this live in 14 days — want that?"

Where `volumeLine()` is a new helper returning, when `VOLUME_NUMBER` is set: `"At roughly " + VOLUME_NUMBER + " " + channelLabel + " a month, "` else `''`. Example: *"At roughly 180 enquiries a month, *AI Phone System — Standard* fits."*

Rationale: "Based on what you've told me, I'd recommend" is six words of throat-clearing before the actual recommendation — cut to let the number-driven callback (capability 2.2(c)) do that work instead, which is both shorter and demonstrably specific (principle 3, 4). "Want me to book you a free 30-minute strategy call with Tristan to get you live in 14 days?" restructured as statement-then-single-question ("I can put 30 minutes on Tristan's calendar... want that?") — states the mechanism plainly, asks once (principle 5).

### 3.5 `showBooking()` (line 461) + confirmation card

> **Current:** "Perfect — locking that in for you now."

> **Proposed:** "Locking that in now."

Rationale: "Perfect —" is a filler affect-word standing in for content (principle 1, 2). Three words does the same job.

> **Confirmation card text (lines 468–473)** — current: `'CALL BOOKED ✓'` / `'Tristan will walk you through your custom setup.'` / row values `'30-min Strategy Call'`, `'hello@axoncoreai.com'`, `'Confirmed ✓'`.
> **Proposed:** keep `'CALL BOOKED ✓'` and the row values as-is (they're already terse, factual UI labels, not dialogue) — only change the subtitle: `'Tristan walks you through the setup directly.'` (drops "will," present tense reads more definite/confident). Low priority; optional.

### 3.6 FAQ — price, pre-qualification (line 121)

> **Current:** "Happy to get you exact numbers — I just need your setup first so I quote the right package, not a generic one. Takes 30 seconds. " + nextPrompt()

> **Proposed:** "Exact numbers need your setup first — otherwise I'm quoting a generic package, not yours. " + nextPrompt()

Rationale: "Happy to get you" and "just need" are hedge/filler openers (principles 1, 4). Restated as a direct cause-and-effect statement. Drops "Takes 30 seconds" — a time-reassurance a confident operator doesn't need and which reads as apologizing for asking a question (principle 2).

### 3.7 FAQ — price, recommend/book state (line 119)

> **Current:** "To recap — the *" + faqPkg.name + "* is " + faqPkg.setup + " setup (one-time) plus " + faqPkg.monthly + "/mo, including " + faqPkg.mins + ", on our 36-month founding-rate agreement. Want me to lock in that free strategy call so we can walk through it together?"

> **Proposed:** "*" + faqPkg.name + "*: " + faqPkg.setup + " setup, " + faqPkg.monthly + "/mo, " + faqPkg.mins + " included, 36-month founding-client rate. I can lock in the strategy call now — want that?"

Rationale: "To recap —" is filler (principle 1); the colon-led restatement is denser and reads like a spec sheet, which is the correct register for this audience. "so we can walk through it together" softens an already-clear offer; cut per principle 5 (state once, precisely).

### 3.8 FAQ — how it works (line 124)

> **Current:** "I'm an AI trained on your specific business — your FAQs, pricing, services. When a client calls or messages:\n\n• I answer instantly, 24/7\n• I qualify them in 2 questions\n• I book the appointment automatically\n\nNo hold music. No missed calls. No humans needed. " + nextPrompt()

> **Proposed:** "Trained on your FAQs, pricing, and services. When someone calls or messages:\n\n• Answered instantly, 24/7\n• Qualified in 2 questions\n• Booked automatically\n\nNo hold music, no missed calls, no human handoff. " + nextPrompt()

Rationale: "I'm an AI trained on..." restated passively/factually ("Trained on...") reads like documentation, not self-description — a subtle but real register shift toward technical credibility. "No humans needed" → "no human handoff" is more precise (states what specifically doesn't happen) per principle 4.

### 3.9 FAQ — real AI (line 127)

> **Current:** "100% real AI — not a human, not a recording. The same technology answers your actual clients' calls every day. This exact conversation is what your callers experience.\n\n" + nextPrompt()

> **Proposed:** "Real AI, not a human or a recording. This exact conversation — same latency, same logic — is what your callers get.\n\n" + nextPrompt()

Rationale: "100%" is a superlative-flavored qualifier that reads as protesting too much (principle 4/6 — quantify or cut, don't intensify). "your actual clients' calls every day" restated more tightly as "This exact conversation... is what your callers get," adding "same latency, same logic" — a specific, technical-sounding claim that a skeptical operator finds more credible than an adjective (principle 2, 6).

### 3.10 `fastTrackIntercept()` rotating lines, qualify_channel/qualify_volume (lines 269–273)

> **Current:**
> 1. "Glad to hear it — let's make sure we get you the right fit. Two quick questions first. "
> 2. "Appreciate that — just one more thing so I recommend the right fit. "
> 3. "Great, let's lock this in — one last detail first. "

> **Proposed:**
> 1. "Right fit first needs two data points — "
> 2. "One more input before I can size this correctly — "
> 3. "Last detail, then this is locked to the right package — "

Rationale: All three current lines open with an affect word ("Glad," "Appreciate," "Great") reacting to enthusiasm the user hasn't really earned yet (they gave an unclassifiable answer, not a compliment) — principle 1, 2. Restated as plain statements of what's needed and why, each still distinct enough to satisfy the no-repeat rotation requirement.

### 3.11 `fastTrackIntercept()` idle-state fallback (line 281)

> **Current:** "Great — let's get you sorted. " + nextPrompt()

> **Proposed:** nextPrompt() (drop the lead-in entirely)

Rationale: "Great — let's get you sorted" is pure filler with zero information (principle 1, 4) — in idle state there's no prior qualifying answer to react to, so there's nothing to acknowledge; go straight to the question.

### 3.12 `handleDecline()` rotating lines (lines 369–373)

> **Current:**
> 1. "No worries at all — the offer's always open if you change your mind. Anything else I can help clarify?"
> 2. "Understood — no pressure at all. The free strategy call offer stands whenever you're ready — just ask."
> 3. "Sure thing — take whatever time you need. I'm happy to answer any other questions about the setup or pricing."

> **Proposed:**
> 1. "The offer stands, no expiry. Anything else worth covering first?"
> 2. "Understood. Same offer, whenever it's useful — the setup and pricing are open for questions in the meantime."
> 3. "Noted. I can go deeper on setup, pricing, or anything else before you decide."

Rationale: strips "No worries at all," "no pressure at all," "Sure thing" — three separate instances of principle 2's exact anti-pattern (reassurance-as-filler). Replaces with statements of fact (offer has no expiry; specific things Riley can still help with), which does the same reassurance *job* without the tone of over-managing the prospect's feelings.

### 3.13 `handleRecommendOrBookReply()` — book-state decline (line 344)

> **Current:** "That's already locked in on our end — if plans change, just let us know at hello@axoncoreai.com. Anything else I can help with?"

> **Proposed:** "Already locked in. Reach hello@axoncoreai.com if that changes. Anything else?"

Rationale: three short factual sentences replace one long hedge-inflected one; "just let us know" drops "just" per principle 4.

### 3.14 `handleRecommendOrBookReply()` — book-state neither decline-nor-affirm (line 349)

> **Current:** "You're all set — check your inbox for the confirmation. Anything else I can help with before then?"

> **Proposed:** "You're set — confirmation's in your inbox. Anything else before the call?"

Rationale: principle 4 compression; "before then" is vaguer than "before the call," which is more specific about what "then" refers to (principle 3-adjacent — specificity over generic reference, even without new state).

### 3.15 `handleRecommendOrBookReply()` — recommend-state neither (line 362)

> **Current:** "Of course. Happy to answer anything else, or whenever you're ready, just say the word and I'll lock in that free 30-minute strategy call. " + nextPrompt()

> **Proposed:** "No issue. Ask anything else, or say the word when you want the strategy call locked in. " + nextPrompt()

Rationale: "Of course. Happy to answer" is two filler beats before the actual content (principle 1); "just say the word" keeps "the word" phrase (it's a nice idiom, not a hedge) but drops "just" (principle 4).

### 3.16 `handleUncertain()` — greet, first hesitation (line 391)

> **Current:** "No worries — could be a restaurant, salon, clinic, real estate agency, anything client-facing. What's closest?"

> **Proposed:** "Broad categories: restaurant, salon, clinic, real estate, professional services. Closest fit?"

Rationale: "No worries" removed (principle 2); list restructured as a labeled set rather than a run-on reassurance sentence, reads more like a quick technical menu than hand-holding.

### 3.17 `handleUncertain()` — qualify_channel, first hesitation (line 400)

> **Current:** "No problem — even a rough idea helps. Mostly phone calls, website messages, or social media like WhatsApp/Instagram/Facebook?"

> **Proposed:** "A rough split works. Mostly phone, website messages, or WhatsApp/Instagram/Facebook?"

Rationale: "No problem" removed (principle 2); "even a rough idea helps" restated more crisply as "A rough split works" (principle 4).

### 3.18 `handleUncertain()` — qualify_volume, first hesitation (line 408)

> **Current:** "No stress — a ballpark is fine. Under 100 a month, a few hundred, or more than that?"

> **Proposed:** "Ballpark is fine. Under 100 a month, a few hundred, or more?"

Rationale: "No stress" removed (principle 2); "or more than that" tightened to "or more" (principle 4).

### 3.19 `handleUncertain()` — recommend/book hedge lines (lines 429–433)

> **Current:**
> 1. "No pressure at all — totally your call. Whenever you're ready, just say the word and I'll lock in that free 30-minute strategy call for you. No obligation either way."
> 2. "Take your time — there's no rush at all. Just let me know whenever you'd like that free strategy call and I'll get it locked in."
> 3. "Totally fine to sit with it a bit longer. The free 30-minute strategy call offer isn't going anywhere whenever you're ready."

> **Proposed:**
> 1. "Your call, no deadline attached. Say the word when you want the strategy call, and I'll lock it in."
> 2. "The strategy call stays open — let me know when it's useful."
> 3. "No expiry on the offer. Ready when you are."

Rationale: this is the single worst offender for principle 2 in the current file — "No pressure at all," "totally your call," "no obligation either way," "no rush at all," "Totally fine" is five separate over-reassurance phrases across three lines answering a single hedge. A confident operator reads this volume of reassurance as Riley being *unsure* whether the prospect is annoyed, which undercuts exactly the competence signal this rewrite is for. Replaced with three short, distinct, low-word-count variants that state the same fact (no deadline) once each, satisfying the rotation requirement without escalating the reassurance.

### 3.20 `handleUncertain()` — final fallback (line 438)

> **Current:** "That's alright, we'll figure it out together. " + nextPrompt()

> **Proposed:** nextPrompt() (drop the lead-in)

Rationale: "we'll figure it out together" is warm but content-free and only fires in an edge-case/unexpected-state situation where there's nothing specific to react to — go straight to the question, matching the 3.11 treatment of the same kind of dead-air lead-in.

### 3.21 Generic fallback in `respond()` (line 228)

> **Current:** "Got it. " + nextPrompt()

> **Proposed:** nextPrompt()

Rationale: same as above — "Got it." in the generic fallback has nothing specific to acknowledge (this fires when nothing else matched), so it's pure filler every single time it's used.

### 3.22 `nextPrompt()` strings (lines 626–629) — used standalone and concatenated everywhere above

> **Current:**
> - greet: "What kind of business do you run?"
> - qualify_channel: "How do clients usually reach you?"
> - qualify_volume: "How many enquiries per month?"
> - else: "Ready to see what this looks like for your business?"

> **Proposed:**
> - greet: "What's the business?"
> - qualify_channel: "How do clients reach you?"
> - qualify_volume: "How many enquiries a month?"
> - else: "Want to see this running for your business specifically?"

Rationale: consistent trims matching 3.2/3.3 (principle 4); "for your business specifically" in the else-case gestures at capability 2.2(a) without requiring `BUSINESS_TYPE` to be non-null — safe generic default when it isn't set.

---

## 4. Worked example conversations

Each example plays a Musk/Bezos-tier prospect: terse, precise, tests the system rather than politely following the script. Each response uses the **proposed** copy from Section 3 plus the **new state mechanics** from Section 2. Notes after each turn flag whether the current architecture (post this spec's engineering changes) can genuinely produce that line, or whether it's aspirational and needs the Section 5 change explicitly called out.

### Example A — clean happy path, comprehension on display

```
Riley:  I'm Riley — Axon Core's AI receptionist. I handle inbound calls and
        messages, qualify the lead, and book the appointment, end to end,
        with no human in the loop.

        What's the business?

User:   We run a family dental clinic, two locations.

Riley:  For a family dental clinic — how do clients reach you: phone,
        website chat, WhatsApp/Instagram/Facebook, or a mix?

User:   Mostly phone, some website bookings.

Riley:  And roughly how many calls per month?

User:   Around 180 across both locations.

Riley:  At roughly 180 calls a month, *AI Phone System — Standard* fits.

        • Setup: $599 (one-time)
        • Monthly: $250
        • Included: 600 mins/mo
        • 36-month agreement, founding-client rate

        Covers phone calls 24/7, fully automated. I can put 30 minutes on
        Tristan's calendar to get this live in 14 days — want that?

User:   Yes, book it.

Riley:  Locking that in now.
        [confirmation card appears]
```

**Notes:** "For a family dental clinic" requires `BUSINESS_TYPE`/`BUSINESS_RAW` capture (2.4) — achievable once that regex ships; the raw phrase "family dental clinic" is captured verbatim by the `BUSINESS_RAW` pattern (`i run|we run` + noun phrase) and used directly, no classification needed for the callback to read as heard. "At roughly 180 calls a month" requires the `VOLUME_NUMBER` fix in 2.2(c)/2.4 — the current `parseInt`-on-stripped-digits logic already correctly parses a clean "180" (no separators to break on), so this line works even without the range-parsing fix in 2.2(f); that fix matters for Example C below, not this one.

### Example B — skeptical, non-keyword phrasing mid-flow

```
Riley:  I'm Riley — Axon Core's AI receptionist. [...] What's the business?

User:   Boutique real estate brokerage, high-end residential.

Riley:  For a boutique real estate brokerage — how do clients reach you:
        phone, website chat, WhatsApp/Instagram/Facebook, or a mix?

User:   Honestly it's a mess — some call, some DM us on Instagram, a few
        just walk into the office.

Riley:  [multi-channel sentence — see engineering note below]
        Sounds like phone and Instagram both matter here — I'll size this
        as omnichannel. Roughly how many enquiries across all of that per
        month?

User:   Maybe 300, hard to say exactly.

Riley:  At roughly 300 enquiries a month, *Omnichannel Front Desk — Pro*
        fits.

        • Setup: $1,399 (one-time)
        • Monthly: $1,399
        • Included: 1,200 mins/mo
        • 36-month agreement, founding-client rate

        Covers phone, website chat, WhatsApp, Instagram & Facebook, fully
        automated. I can put 30 minutes on Tristan's calendar to get this
        live in 14 days — want that?

User:   What's your error rate? Who's liable if you double-book someone?

Riley:  No published error rate to quote honestly — this is a live,
        continuously-monitored system, not a static script. Double-bookings
        are prevented at the calendar layer (the system checks availability
        before confirming, same as a human would) — and Axon Core, not you,
        is responsible for fixing a scheduling error caused by the system
        itself. Want me to have Tristan walk through the monitoring setup
        on the strategy call?

User:   Sure, let's do it.

Riley:  Locking that in now.
        [confirmation card appears]
```

**Engineering honesty check on this example:**
- The user's channel answer ("some call, some DM us on Instagram, a few just walk into the office") mentions two matched categories (phone + omni/instagram) in one sentence. **As the code stands today (before Section 2.2(e)'s fix), this would be misclassified as `'phone'` only** — the phone-word check runs first and returns immediately, so the multi-channel signal is lost and Riley would never say "phone and Instagram both matter here." **This line is aspirational until the 2.2(e) fix (check-all-categories, 2+ matches → omni) ships.** Flagging explicitly per the task instructions: do not ship this response copy without that logic change, or it will silently regress to the generic omni-or-first-match behavior and the "sounds like X and Y both matter" callback will never fire.
- "Maybe 300, hard to say exactly" parses fine under both old and new number logic (single clean number, no separators) — not blocked on 2.2(f).
- The error-rate/liability question **is not answerable by any existing branch** — it requires the new `FAQ_RELIABILITY_WORDS` intercept specified in Section 5. Without that change, this input falls through to the generic fallback (`nextPrompt()` alone, post-rewrite) and the conversation would look exactly like the failure mode this whole spec exists to prevent: a sharp, well-informed prospect asks a real question and gets "How many enquiries a month?" back. **This is the single highest-priority new branch in this spec.**

### Example C — decline, then reconsider, testing the reassurance-rewrite and the number-parsing bug fix together

```
Riley:  I'm Riley — Axon Core's AI receptionist. [...] What's the business?

User:   Independent law practice, mostly conveyancing.

Riley:  For an independent law practice — how do clients reach you: phone,
        website chat, WhatsApp/Instagram/Facebook, or a mix?

User:   Phone only, we don't do social.

Riley:  And roughly how many calls per month?

User:   Somewhere between 150-200, varies by season.

Riley:  At roughly 150 calls a month, *AI Phone System — Standard* fits.

        • Setup: $599 (one-time)
        • Monthly: $250
        • Included: 600 mins/mo
        • 36-month agreement, founding-client rate

        Covers phone calls 24/7, fully automated. I can put 30 minutes on
        Tristan's calendar to get this live in 14 days — want that?

User:   Not right now, need to check with my partners first.

Riley:  The offer stands, no expiry. Anything else worth covering first?

User:   Why would I lock into a 36-month contract with a company I've
        never heard of?

Riley:  [new FAQ_CONTRACT_WORDS branch — see engineering note]
        Fair question. The 36-month term is what makes the founding-client
        rate possible — Axon Core prices this like infrastructure, not a
        trial subscription. If it's a concern, the strategy call is the
        place to raise it directly with Tristan before anything is signed
        — no commitment happens on this chat. Want me to flag that for the
        call?

User:   Sure, go ahead.

Riley:  Locking that in now.
        [confirmation card appears]
```

**Engineering honesty check on this example:**
- "Somewhere between 150-200" is the exact case that breaks under the **current** `parseInt(txt.replace(/[^0-9]/g,''),10)` logic: stripping all non-digits from "150-200" yields the digit string `"150200"`, and `parseInt` reads that as **150,200** — a number so large it would misclassify this clearly-mid-range business into the Pro tier on a parsing bug, not a real signal. **This example only produces "At roughly 150 calls a month" (taking the first number, ignoring the range) once the 2.2(f)/2.4 fix ships** (extract first standalone number via `\d[\d,]*` instead of concatenating all digits). Until then, this exact input is a live bug, not just an unhandled comprehension gap — it would actively misprice the demo in front of a numbers-precise prospect, which is the worst possible failure mode for this specific audience.
- The "why 36 months" objection **requires the new `FAQ_CONTRACT_WORDS` intercept** (Section 5) — not answerable today, same category of gap as the error-rate question in Example B.
- The decline-then-reconsider flow (decline → still gets an open, unpressured door → asks a real objection → reconsiders) exercises the rewritten `handleDecline()` line (3.12) and confirms it doesn't over-reassure on the way to answering the real question.

---

## 5. Prioritized engineering change list

Ordered by priority; each item states what to build, not just what to rewrite. Items 1–3 are bug fixes / correctness issues independent of the tone pass and should ship regardless of how much of the copy rewrite lands. Items 4–6 are the new comprehension mechanics. Items 7+ are the copy swap itself.

1. **[Bug fix, highest priority] Fix volume-number parsing.** In `qualify_volume` (currently ~line 177), replace:
   ```js
   var num = parseInt(txt.replace(/[^0-9]/g, ''), 10);
   ```
   with extraction of the first standalone number instead of concatenating every digit in the string:
   ```js
   var numMatch = txt.match(/\d[\d,]*/);
   var num = numMatch ? parseInt(numMatch[0].replace(/,/g, ''), 10) : NaN;
   var hasNum = !isNaN(num);
   ```
   This is a live correctness bug today (see Example C) — any input like "150-200", "1,200 a month", or a phone-number-shaped aside would corrupt the parsed volume. Fix independent of any copy changes.

2. **[New state] Add `VOLUME_NUMBER` as a module-scope var, set alongside the fix in item 1** (store the parsed `num` even when it doesn't cleanly land in a lite/pro bucket-by-keyword, i.e. also on the `hasNum` branches at ~189/194). Used by `recommend()`'s new `volumeLine()` helper (Section 3.4).

3. **[Logic fix] Fix multi-channel misclassification in `qualify_channel`** (currently ~line 155). Replace the current first-match-wins `if/return` chain with: check all three category word-lists, count how many matched, and only classify as the single matched category if exactly one matched; if two or more matched, classify `CHANNEL_HINT = 'omni'`. Concretely:
   ```js
   var isPhone = matchAny(txt, ['phone','call','ring','voice','number']);
   var isOmni  = matchAny(txt, ['whatsapp','instagram','facebook','social','tiktok','all','every','omni','multiple','mix']);
   var isChat  = matchAny(txt, ['chat','website','web','message','online','email']);
   var matchCount = (isPhone?1:0) + (isOmni?1:0) + (isChat?1:0);
   if (matchCount >= 2) { CHANNEL_HINT = 'omni'; return qualifyVolume(); }
   if (isPhone) { CHANNEL_HINT = 'phone'; return qualifyVolume(); }
   if (isOmni)  { CHANNEL_HINT = 'omni';  return qualifyVolume(); }
   if (isChat)  { CHANNEL_HINT = 'chat';  return qualifyVolume(); }
   // ...existing fastTrackIntercept fallback + default-to-omni unchanged
   ```
   Needed for Example B's "sounds like phone and Instagram both matter here" line to ever fire correctly.

4. **[New state + new function] Add `BUSINESS_TYPE`, `BUSINESS_RAW`, and `classifyBusinessType()`.** Called from the `STATE === 'greet'` branch (~line 143), alongside the existing `nameMatch` extraction. Word lists and the `BUSINESS_RAW` capture regex are fully specified in Section 2.4 — implement exactly as given. Store both; prefer `BUSINESS_RAW` for display when present (it reads as more "heard," per Section 2.2(a)), fall back to a `BUSINESS_TYPE`-driven generic label, fall back further to no callback at all if neither captured.

5. **[New helper functions]** `businessTypeLine()` and `volumeLine()` (used in Sections 3.2 and 3.4 respectively) — small string builders that return `''` when the relevant state isn't set, so every downstream line degrades gracefully to the current generic phrasing rather than producing broken/awkward grammar when `BUSINESS_RAW` or `VOLUME_NUMBER` is empty. Write these defensively — test the empty-state output explicitly (this is exactly the kind of seam that produces a visibly broken sentence like "For a , how do clients reach you" if the fallback isn't handled).

6. **[New state] Add `CHANNEL_RAW` capture** in the `qualify_channel` handler per Section 2.4's word list, used by `recommend()`'s coverage line (`CHANNEL_RAW || channelCopy()` per Section 3.4).

7. **[New FAQ branch — second-highest priority after item 1] `FAQ_RELIABILITY_WORDS` intercept.** New word list, e.g. `['error rate', 'liable', 'liability', 'double-book', 'double book', 'mistake', 'hallucinate', 'what if you get it wrong', 'accuracy']`, checked in `respond()` alongside the existing three FAQ intercepts (~lines 111–128), same priority tier (before the state machine, since these words don't plausibly collide with a channel/volume/business-type answer). Reply copy specified in Example B; needs a `nextPrompt()`-style continuation appended, same pattern as the existing three intercepts. This is the single most important new branch in this spec — without it, the exact audience this rewrite targets (someone who asks about error rates and liability) hits the generic fallback, which is the specific failure mode the whole request is trying to prevent.

8. **[New FAQ branch] `FAQ_CONTRACT_WORDS` intercept.** New word list, e.g. `['36-month', '36 month', 'lock in', 'lock-in', 'locked in', 'contract', 'cancel', 'get out of', 'exit clause', 'never heard of you', 'never heard of', "haven't heard of"]`. Same placement/priority as item 7. Reply copy specified in Example C.

9. **[Content-only, no logic change] Apply every line rewrite in Section 3** — items 3.1 through 3.22. Each is a pure string replacement; none change when a function is called, what state it sets, or what it concatenates, per the task's explicit constraint that this is a content upgrade, not a restructure. Do these last, after items 1–8 land, so the new copy in Sections 3.4/3.6/3.7 (which reference `volumeLine()`, `businessTypeLine()`, `CHANNEL_RAW`) has the underlying mechanics to call.

10. **[Optional, low priority] Confirmation-card subtitle tweak** per Section 3.5 — cosmetic, ship opportunistically.

11. **[Explicitly deferred, do not build this pass]** Compound multi-intent messages (e.g., "what's the price AND how does booking work" in one message) — noted as a known limitation in Section 6, not a build item, because the fix (restructuring the FAQ intercepts from exclusive-`if`-return to collect-and-concatenate) is disproportionate in complexity/risk to the value for a demo widget. Revisit only if user testing surfaces this as a common real pattern.

---

## 6. Known limitations (ship with this list, don't hide it)

- **No true multi-intent handling.** A single message asking two questions ("what's the price and how does this work") only gets the first-matched FAQ answered; the second is silently dropped. Acceptable for a demo; would need architectural change (item 11 above) to fix properly.
- **No memory across sessions/reloads.** Every demo conversation starts cold. Fine for a marketing-site widget; would matter if this became an embedded persistent assistant.
- **`BUSINESS_RAW` capture is regex-based, not real parsing.** Unusual phrasing ("boutique nail salon, we've been open since 2019") will still capture reasonably, but truly unusual sentence structures may fail to populate `BUSINESS_RAW`, falling back to the generic "a business like yours" phrasing. This is a graceful degradation, not a crash — but it does mean the "comprehension" illusion is probabilistic, not guaranteed, exactly as this spec frames it in Section 2.
- **The new FAQ_RELIABILITY_WORDS / FAQ_CONTRACT_WORDS lists are illustrative, not exhaustive.** They cover the phrasings anticipated in this spec's worked examples; real user testing will surface phrasings not on these lists (this is the same category of gap the existing three FAQ intercepts already have, and is inherent to keyword matching — flagged here so it isn't mistaken for an oversight when it surfaces).
- **This is still not a real NLU system.** Nothing in this spec changes the fundamental architecture — it adds targeted state capture and a couple of new keyword branches. A sufficiently adversarial or unusually-phrased input (which a Musk/Bezos-tier user testing the system's limits deliberately might try) can still fall through to the generic fallback. The goal of this spec is to raise the bar on what fraction of realistic sophisticated input is well-handled, not to eliminate the ceiling.
