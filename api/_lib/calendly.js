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
  const start = new Date(Date.now() + AVAILABILITY_START_BUFFER_MS);
  const end = new Date(Date.now() + Math.min(daysAhead, MAX_AVAILABILITY_DAYS) * 24 * 60 * 60 * 1000);

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
// -> { ok: false, code: 'invalid_email' | 'slot_taken' | 'calendly_unavailable', message }
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

  // Calendly's documented error codes are generic (400/401/403/404) with no
  // discrete "slot taken" vs "bad email" distinction — classification here
  // is pattern-matched against the real message text observed during Step 1
  // testing, not guessed from docs.
  const msg =
    (data && (data.message || (Array.isArray(data.details) && data.details[0] && data.details[0].message))) || '';
  let code = 'calendly_unavailable';
  if (status === 400 && /email/i.test(msg)) code = 'invalid_email';
  else if (status === 400 && /(time|slot|availab)/i.test(msg)) code = 'slot_taken';

  console.error('calendly.js: bookMeeting failed', status, networkError || data);
  return { ok: false, code, message: msg || 'Could not complete the booking.' };
}

module.exports = { getAvailableSlots, bookMeeting, formatSlotLocal, DEFAULT_TIMEZONE };
