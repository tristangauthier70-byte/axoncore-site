// /api/_lib/booking-tools.js
//
// Product logic shared by both Riley surfaces (api/chat.js for text, and
// api/vapi-tools.js for the voice agent). Neither surface talks to
// calendly.js directly — everything routes through executeBookingTool()
// here, so a confirmation phrase or a validation rule can't drift between
// the two the way tier.js/roi.js once drifted on pricing before
// pricing-data.js existed as a single source of truth.
//
// Tool schemas are defined once, in a generic {name, description,
// parameters} shape (plain JSON Schema for `parameters`) and adapted per
// surface — VAPI's function-calling shape and Anthropic's input_schema
// shape are structurally identical, so toClaudeToolSchema() below is a thin
// rename, not a real transform.

const { getAvailableSlots, bookMeeting, formatSlotLocal } = require('./calendly');

const CHECK_AVAILABILITY_TOOL = {
  name: 'check_availability',
  description:
    'Check open meeting slots on the calendar for the next few days, in Singapore time. Call this when the visitor wants to book a meeting, before asking for their contact details.',
  parameters: {
    type: 'object',
    properties: {
      days_ahead: {
        type: 'integer',
        description: 'How many days ahead to check. Defaults to 7, max 7.',
      },
    },
    required: [],
  },
};

const BOOK_MEETING_TOOL = {
  name: 'book_meeting',
  description:
    'Book a confirmed meeting slot on the calendar. Only call this after the visitor has explicitly picked one specific time from what check_availability returned, and after you have their name, email, and phone number, and after they have agreed to Axoncore collecting that information (name, email, phone) via Calendly and its processors to arrange the call.',
  parameters: {
    type: 'object',
    properties: {
      start_time: {
        type: 'string',
        description:
          'The exact slot start time, copied exactly from a startTimeISO value check_availability returned (ISO 8601 UTC, e.g. 2026-08-14T01:00:00Z). Never invent or reformat this.',
      },
      name: { type: 'string', description: "The visitor's full name." },
      email: { type: 'string', description: "The visitor's email address." },
      phone: { type: 'string', description: "The visitor's phone number." },
    },
    required: ['start_time', 'name', 'email', 'phone'],
  },
};

function toClaudeToolSchema(tool) {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

// --- Validation --------------------------------------------------------
// These values land directly in a real calendar entry Tristan will see, so
// they get the same defensive-cap instinct as chat.js's MAX_MESSAGE_LENGTH.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 20;

function validateContactFields({ name, email, phone }) {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: "That name didn't come through right — could you give me your full name again?" };
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { ok: false, message: "That email doesn't look valid — could you double check it and give it to me again?" };
  }
  if (typeof phone !== 'string' || phone.trim().length === 0 || phone.length > MAX_PHONE_LENGTH) {
    return { ok: false, message: "That phone number didn't come through right — could you give it again?" };
  }
  return { ok: true };
}

// Prefer one option per distinct calendar day (spoken/read as "Thursday at
// 9am, Friday at 2pm, Monday at 10am") over three slots from the same
// morning, which reads as repetitive and gives a false sense of scarcity.
function pickSpreadSlots(slots, count) {
  const picked = [];
  const seenDates = new Set();
  for (const slot of slots) {
    const dateKey = slot.startTimeISO.slice(0, 10);
    if (seenDates.has(dateKey)) continue;
    seenDates.add(dateKey);
    picked.push(slot);
    if (picked.length >= count) return picked;
  }
  // Not enough distinct days in the window — fill out from whatever's left.
  for (const slot of slots) {
    if (picked.length >= count) break;
    if (!picked.includes(slot)) picked.push(slot);
  }
  return picked;
}

// -> { ok: boolean, message: string } — `message` is what VAPI speaks
// directly and what Claude reads as the tool_result to paraphrase in
// Riley's own voice. Never throws; every failure path (Calendly down, bad
// input, slot taken) resolves to a graceful message, never a raw error.
async function executeBookingTool(name, rawInput) {
  const input = rawInput || {};

  if (name === 'check_availability') {
    const daysAhead = Number.isInteger(input.days_ahead) ? input.days_ahead : undefined;
    const result = await getAvailableSlots({ daysAhead });

    if (!result.ok) {
      return {
        ok: false,
        message: "I'm having trouble reaching the calendar right now — I can have Tristan follow up directly instead.",
      };
    }
    if (result.slots.length === 0) {
      return {
        ok: true,
        message: 'No open slots in the next week — worth having Tristan follow up directly, or I can check a bit further out.',
      };
    }

    const picks = pickSpreadSlots(result.slots, 3);
    // Deliberately split into a "say this" sentence and a separately labeled
    // reference block, rather than one run-on sentence mixing spoken text
    // with inline ISO timestamps — a live voice model composing speech from
    // a single blended string stumbled on this in testing ("I seem to have
    // misspoken"). Keeping what to SAY and what to REMEMBER visually and
    // structurally distinct removes that ambiguity.
    const spoken = picks.map((s) => s.startTimeLocal).join(', or ');
    const reference = picks.map((s) => `${s.startTimeLocal} = ${s.startTimeISO}`).join(' | ');
    return {
      ok: true,
      message: `Say to the caller, in your own words: "${spoken}, all Singapore time — which works for you?" Then once they pick one, use its exact start_time to call book_meeting. Do not say "start_time" or read any ISO timestamp aloud — that's for your own reference only. Reference (start_time for each option, not to be spoken): ${reference}`,
    };
  }

  if (name === 'book_meeting') {
    if (typeof input.start_time !== 'string' || input.start_time.trim().length === 0) {
      return { ok: false, message: 'A specific time is needed before booking — call check_availability again if the options are unclear.' };
    }

    const validation = validateContactFields(input);
    if (!validation.ok) return validation;

    const result = await bookMeeting({
      startTimeISO: input.start_time.trim(),
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
    });

    if (result.ok) {
      return {
        ok: true,
        message: `Booked for ${formatSlotLocal(result.startTimeISO)}, Singapore time. Tristan will send the Google Meet link before the call. A confirmation has been sent to ${input.email.trim()}.`,
      };
    }

    if (result.code === 'invalid_email') {
      return { ok: false, message: "That email didn't go through — could you double check it and give it to me again?" };
    }
    if (result.code === 'slot_taken') {
      return { ok: false, message: 'That slot just got taken — call check_availability again for fresh options rather than asking them to repeat themselves.' };
    }
    if (result.code === 'slot_in_past' || result.code === 'invalid_time_format') {
      return { ok: false, message: 'That time is not valid to book — call check_availability again and use one of its exact options rather than reconstructing the time yourself.' };
    }
    return {
      ok: false,
      message: "I'm having trouble booking that right now — I can have Tristan follow up directly instead.",
    };
  }

  return { ok: false, message: 'Unknown tool.' };
}

module.exports = { CHECK_AVAILABILITY_TOOL, BOOK_MEETING_TOOL, toClaudeToolSchema, executeBookingTool };
