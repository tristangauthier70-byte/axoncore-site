// /api/_lib/calendly.js
//
// Thin wrapper around Calendly's Scheduling API. No knowledge of VAPI or
// Claude lives here — just "what slots are open" and "book this slot."
// Both api/chat.js and api/vapi-tools.js go through booking-tools.js, which
// is the only thing that imports this file, so the two Riley surfaces can't
// drift out of sync on validation/phrasing (the same reason pricing-data.js
// exists as a single source of truth for pricing).
//
// Auth: a Personal Access Token is enough here — OAuth app registration is
// only required when booking on behalf of *other* Calendly accounts, and
// this always books into Axoncore's own single calendar.

const CALENDLY_API_BASE = 'https://api.calendly.com';

// ICP is Singapore service businesses — no per-caller timezone param in v1.
// Calendly still stores/returns everything in UTC regardless of this value;
// it only affects how a slot is phrased back to the visitor.
const DEFAULT_TIMEZONE = 'Asia/Singapore';

// Empirically confirmed live (see the plan) — Calendly's own account
// timezone (America/New_York, unrelated to this) doesn't affect any of this.
// Calendly rejects an available-times request whose start_time is "now" or
// earlier — a request built from the current instant with zero buffer 400s
// with "start_time must be in the future." A few minutes of buffer avoids
// that without meaningfully shrinking the offered window.
const AVAILABILITY_START_BUFFER_MS = 10 * 60 * 1000;

// Confirmed live: this endpoint caps the requested span at 7 days.
const MAX_AVAILABILITY_DAYS = 7;

const FETCH_TIMEOUT_MS = 8000;

// This exact text must match the required consent question already
// configured on the real 30min event type (position 1) — Calendly matches
// questions_and_answers entries against the event type's configured
// questions, so this can't drift from the dashboard copy. Because this tool
// answers "I agree" on the visitor's behalf, both Riley surfaces are
// required (see booking-tools.js) to have already gotten equivalent verbal/
// typed consent in conversation before book_meeting is ever called — this
// checkbox exists to represent real consent, not to launder its absence.
const CONSENT_QUESTION =
  "I agree to Axoncore collecting my name, email, and phone number to arrange this call, as described in the Privacy Policy. I understand my data may be processed outside Singapore by Axoncore's service providers (Calendly, Twilio, VAPI).";
const CONSENT_ANSWER = 'I agree';

// Must match the "AI Booking" event type's configured custom location text
// exactly (see calendly_ai_event_type in dev notes) — Calendly's API
// doesn't auto-fill this from the event type on API-created bookings the
// way it would for a human booking through the UI.
const CUSTOM_LOCATION_TEXT = "You'll receive the Google Meet link from Tristan before the call.";

function isoNoMillis(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

async function calendlyFetch(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${CALENDLY_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      // No/non-JSON body — leave data as null, caller handles it.
    }
    return { httpOk: res.ok, status: res.status, data };
  } catch (err) {
    return { httpOk: false, status: 0, data: null, networkError: err };
  } finally {
    clearTimeout(timeout);
  }
}

// -> { ok: true, slots: [{ startTimeISO, startTimeLocal }] }
// -> { ok: false, code: 'calendly_unavailable', message }
async function getAvailableSlots({ daysAhead = MAX_AVAILABILITY_DAYS } = {}) {
  // Backtest finding: days_ahead of 0 or negative produced an end_time
  // before start_time, which Calendly rejects with "start_time must be
  // before end_time" — surfaced to the caller as a misleading "calendar
  // unavailable" message for what's actually just a benign edge-case input.
  // Clamped to [1, MAX_AVAILABILITY_DAYS] instead of just the upper bound.
  const clampedDays = Math.max(1, Math.min(daysAhead, MAX_AVAILABILITY_DAYS));
  const start = new Date(Date.now() + AVAILABILITY_START_BUFFER_MS);
  const end = new Date(Date.now() + clampedDays * 24 * 60 * 60 * 1000);

  const qs = new URLSearchParams({
    event_type: process.env.CALENDLY_EVENT_TYPE_URI,
    start_time: isoNoMillis(start),
    end_time: isoNoMillis(end),
  });

  const { httpOk, status, data, networkError } = await calendlyFetch(`/event_type_available_times?${qs.toString()}`);

  if (!httpOk) {
    console.error('calendly.js: getAvailableSlots failed', status, networkError || data);
    return { ok: false, code: 'calendly_unavailable', message: 'Could not reach the calendar right now.' };
  }

  const slots = (data.collection || [])
    .filter((s) => s.status === 'available')
    .map((s) => ({ startTimeISO: s.start_time, startTimeLocal: formatSlotLocal(s.start_time) }));

  return { ok: true, slots };
}

// Shared with booking-tools.js so a booking confirmation is phrased the same
// way as an availability option ("Thursday, 13 August at 9:00 am") instead
// of duplicating this formatting logic in two places.
function formatSlotLocal(startTimeISO) {
  return new Date(startTimeISO).toLocaleString('en-SG', {
    timeZone: DEFAULT_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// -> { ok: true, confirmationId, cancelUrl, rescheduleUrl, startTimeISO }
// -> { ok: false, code: 'invalid_email' | 'invalid_phone' | 'slot_taken' | 'slot_in_past' | 'invalid_time_format' | 'calendly_unavailable', message }
async function bookMeeting({ startTimeISO, name, email, phone }) {
  const body = {
    event_type: process.env.CALENDLY_EVENT_TYPE_URI,
    start_time: startTimeISO,
    invitee: {
      name,
      email,
      timezone: DEFAULT_TIMEZONE,
      text_reminder_number: phone || undefined,
    },
    // Deliberately NOT google_conference: confirmed live (repeated attempts
    // against the real 30min event type, cross-checked against a matching
    // bug report on Calendly's own community forum) that the Scheduling API
    // cannot create a booking against an event type whose location is an
    // integration-managed conferencing kind (Google Meet/Zoom/Teams) — that
    // auto-link-generation step only runs inside Calendly's own booking-page
    // UI, not through this API. CALENDLY_EVENT_TYPE_URI therefore points at
    // a dedicated "AI Booking" event type (cloned from the real 30min one,
    // same consent question, same duration) whose location is a plain
    // Custom note telling the invitee Tristan will send the real Google
    // Meet link before the call — the meeting itself is still a real Google
    // Meet call, Calendly just isn't the one generating that link. The
    // original 30min event type (used by the site's manual Calendly widget
    // for human self-bookers) is untouched by this and keeps auto-
    // generating Meet links as before.
    //
    // Field shape confirmed by a real 201 test booking (then cancelled):
    // `location` is a TOP-LEVEL field, not nested under `event`, and isn't
    // called `location_configuration` — that name only appears as an
    // internal path segment in Calendly's 400 error bodies, which is
    // misleading if read as a literal request-body key (cost real trial and
    // error here — don't "fix" this back based on an error message alone).
    // `location.location` (the actual text) is required whenever kind is
    // custom/physical/outbound_call/ask_invitee.
    location: { kind: 'custom', location: CUSTOM_LOCATION_TEXT },
    questions_and_answers: [{ question: CONSENT_QUESTION, answer: CONSENT_ANSWER, position: 1 }],
    booking_source: 'riley_ai_agent',
  };

  const { httpOk, status, data, networkError } = await calendlyFetch('/invitees', { method: 'POST', body });

  if (httpOk) {
    const r = data.resource;
    return {
      ok: true,
      confirmationId: r.uri,
      cancelUrl: r.cancel_url,
      rescheduleUrl: r.reschedule_url,
      startTimeISO,
    };
  }

  // Calendly wraps EVERY 400 in the same generic top-level message ("The
  // supplied parameters are invalid.") — the actually-specific reason lives
  // in details[0]. Backtest finding: this used to check data.message FIRST
  // (data.message || details[0].message), which meant the specific reason
  // was never reached since the generic one is always truthy — a real
  // double-booking test surfaced the generic fallback instead of the more
  // helpful "that slot just got taken" message as a result. details[0] is
  // now checked first; classification is against real error text/codes
  // observed live (already_filled, "must be in the future", "must be a
  // time"), not guessed from docs.
  const detail = data && Array.isArray(data.details) && data.details[0];
  const detailMsg = (detail && detail.message) || '';
  const detailParam = (detail && detail.parameter) || '';
  const msg = detailMsg || (data && data.message) || '';

  let code = 'calendly_unavailable';
  if (detail && detail.code === 'already_filled') code = 'slot_taken';
  else if (/already.*filled/i.test(detailMsg)) code = 'slot_taken';
  else if (/must be in the future/i.test(detailMsg)) code = 'slot_in_past';
  else if (/must be a time/i.test(detailMsg)) code = 'invalid_time_format';
  // QA finding (2026-08-12): a real test booking with phone "123" got back
  // details: [{ message: 'phone_number is invalid format', parameter:
  // 'text_reminder_number' }] — unhandled by any branch above, so it fell
  // through to the generic calendly_unavailable code and told the visitor
  // "I'm having trouble booking that right now" (implying a system problem
  // on Axoncore's end) instead of asking them to correct a phone number
  // they can actually fix. Matched on the parameter name first (most
  // specific signal Calendly gives) with a message-text fallback in case
  // the exact wording varies.
  else if (detailParam === 'text_reminder_number' || /phone.*(invalid|format)/i.test(detailMsg)) code = 'invalid_phone';
  else if (status === 400 && /email/i.test(msg)) code = 'invalid_email';

  console.error('calendly.js: bookMeeting failed', status, networkError || data);
  return { ok: false, code, message: msg || 'Could not complete the booking.' };
}

// --- Reschedule / cancel (added 2026-08-14) ---------------------------
//
// Calendly's API has no "move this booking in place" endpoint — the same
// mechanism Calendly's own reschedule_url uses under the hood is cancel +
// rebook (confirmed by the old_invitee/new_invitee linkage fields present
// on every invitee record). rescheduleBooking() in booking-tools.js
// composes this the same way, using cancelBooking() below plus the
// existing bookMeeting() above — there's no separate "reschedule" call
// here, just the two primitives a reschedule is actually made of.
//
// Finding WHICH booking a visitor means is the other half of this: Calendly
// doesn't expose a single "find by these four fields" endpoint, so
// findMatchingBooking() below composes it from two confirmed-live calls —
// GET /scheduled_events (filterable by invitee_email, status, and
// min_start_time — all three confirmed working against the real account
// before writing this) to get the visitor's active future bookings, then
// GET /scheduled_events/{uuid}/invitees per candidate (event objects don't
// carry invitee contact fields directly) to check phone/name against what
// was actually typed/spoken.

// Cached per warm serverless instance — this never changes for a single-
// account integration, so refetching /users/me on every lookup would be
// pure wasted latency. A cold start just refetches once.
let cachedUserUri = null;
async function getCurrentUserUri() {
  if (cachedUserUri) return cachedUserUri;
  const { httpOk, data } = await calendlyFetch('/users/me');
  if (httpOk && data && data.resource && data.resource.uri) {
    cachedUserUri = data.resource.uri;
  }
  return cachedUserUri;
}

// Security-lock design (per product decision): email + phone are the HARD
// match — both must agree with what Calendly has on file for a booking to
// be considered found at all. Name and the visitor's stated original
// date/time are SOFT — used only to disambiguate when the same email+phone
// has more than one active future booking, never as a reason to reject an
// otherwise-matching booking. This means a visitor who mistypes their own
// name slightly, or is vague on the exact original time, still gets
// through — but someone who doesn't know the real phone number on file
// does not, regardless of what name/date they guess.
function normalizePhoneDigits(phone) {
  return (phone || '').replace(/[^0-9]/g, '');
}

// Real bug found in live testing (2026-08-14): a visitor was asked for
// their phone "with country code" but gave only the local number
// ("91851918", no "+65"); prompt-level compliance isn't 100% reliable, so
// pure exact-digit equality against a stored number saved WITH a country
// code silently found no match at all — even though it was genuinely
// their own real booking. Since a Singapore local mobile number is 8
// digits and effectively unique on its own, treat one side being an exact
// suffix of the other as a match too (a country code is a weak security
// signal for this business anyway — nearly every real client is +65).
// Still requires >=7 digits on the shorter side so a short accidental
// partial entry can't cheaply collide.
function phoneDigitsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 7 && longer.endsWith(shorter);
}

// -> { ok: true, matched: true, event: {uri, uuid, startTimeISO, startTimeLocal}, invitee: {name, email, phone} }
// -> { ok: true, matched: false }   (calendar reachable, nothing matched — caller must NOT reveal which field failed, see booking-tools.js)
// -> { ok: false, code: 'calendly_unavailable', message }
async function findMatchingBooking({ email, phone, name, dateTimeHint }) {
  const userUri = await getCurrentUserUri();
  if (!userUri) {
    return { ok: false, code: 'calendly_unavailable', message: 'Could not reach the calendar right now.' };
  }

  const qs = new URLSearchParams({
    user: userUri,
    invitee_email: email,
    status: 'active',
    min_start_time: isoNoMillis(new Date()),
    count: '20',
  });
  const { httpOk, status, data, networkError } = await calendlyFetch(`/scheduled_events?${qs.toString()}`);
  if (!httpOk) {
    console.error('calendly.js: findMatchingBooking (list) failed', status, networkError || data);
    return { ok: false, code: 'calendly_unavailable', message: 'Could not reach the calendar right now.' };
  }

  const candidateEvents = data.collection || [];
  if (candidateEvents.length === 0) {
    return { ok: true, matched: false };
  }

  // Event objects from the list call above don't include invitee contact
  // fields — has to be fetched per event. Candidate count here is bounded
  // by one person's own active future bookings (realistically 1, rarely
  // more than 2-3), so N+1 calls is a non-issue.
  const withInvitees = await Promise.all(
    candidateEvents.map(async (event) => {
      const uuid = event.uri.split('/').pop();
      const { httpOk: invOk, data: invData } = await calendlyFetch(`/scheduled_events/${uuid}/invitees`);
      const invitee = invOk && invData && invData.collection && invData.collection[0];
      return { event, uuid, invitee };
    })
  );

  const phoneDigits = normalizePhoneDigits(phone);
  const phoneMatches = withInvitees.filter(
    (c) => phoneDigits.length > 0 && c.invitee && phoneDigitsMatch(normalizePhoneDigits(c.invitee.text_reminder_number), phoneDigits)
  );

  if (phoneMatches.length === 0) {
    return { ok: true, matched: false };
  }

  const asMatch = (c) => ({
    ok: true,
    matched: true,
    event: {
      uri: c.event.uri,
      uuid: c.uuid,
      startTimeISO: c.event.start_time,
      startTimeLocal: formatSlotLocal(c.event.start_time),
    },
    invitee: {
      name: c.invitee.name,
      email: c.invitee.email,
      phone: c.invitee.text_reminder_number,
    },
  });

  if (phoneMatches.length === 1) {
    return asMatch(phoneMatches[0]);
  }

  // More than one active booking under the same email+phone. Real bug
  // found in testing: this used to pick the "closest" candidate to
  // dateTimeHint via Date.parse() on the visitor's free-text guess
  // ("Saturday 15 August at 9:30am singapore time") — Date.parse() can't
  // reliably parse natural language, so it silently fell through to
  // phoneMatches[0] (whichever event Calendly happened to list first)
  // instead of actually comparing times. Verified live: with two real
  // bookings 30 minutes apart, this cancelled the WRONG one with no error
  // or signal that it had guessed. Acting on the wrong real booking is the
  // one failure mode this whole feature exists to prevent, so never guess
  // from prose here.
  //
  // Exact-ISO retry path: if dateTimeHint is precisely one candidate's own
  // start_time value, this IS a resolved answer, not a guess — it means
  // the caller already went through the "ambiguous" branch once, read the
  // real options back to the visitor, and is now retrying with the exact
  // reference value copied verbatim (booking-tools.js instructs this
  // explicitly, the same copy-verbatim pattern check_availability already
  // uses for book_meeting's start_time).
  const exact = dateTimeHint && phoneMatches.find((c) => c.event.start_time === dateTimeHint);
  if (exact) {
    return asMatch(exact);
  }

  return {
    ok: true,
    matched: 'ambiguous',
    candidates: phoneMatches.map((c) => ({
      uri: c.event.uri,
      uuid: c.uuid,
      startTimeISO: c.event.start_time,
      startTimeLocal: formatSlotLocal(c.event.start_time),
    })),
  };
}

// -> { ok: true }
// -> { ok: false, code: 'calendly_unavailable', message }
async function cancelBooking({ eventUuid, reason }) {
  const { httpOk, status, data, networkError } = await calendlyFetch(`/scheduled_events/${eventUuid}/cancellation`, {
    method: 'POST',
    body: { reason: (reason || '').slice(0, 500) },
  });
  if (!httpOk) {
    console.error('calendly.js: cancelBooking failed', status, networkError || data);
    return { ok: false, code: 'calendly_unavailable', message: 'Could not cancel that booking right now.' };
  }
  return { ok: true };
}

module.exports = {
  getAvailableSlots,
  bookMeeting,
  formatSlotLocal,
  findMatchingBooking,
  cancelBooking,
  DEFAULT_TIMEZONE,
};
