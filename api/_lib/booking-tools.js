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

const { getAvailableSlots, bookMeeting, formatSlotLocal, findMatchingBooking, cancelBooking } = require('./calendly');
const { notifyBookingOutcome } = require('./email');

// Never let a notification-email failure surface as a booking-flow failure
// — the visitor's actual booking/cancel/reschedule result is already
// decided by this point, this is a best-effort side channel only.
async function notify(params) {
  try {
    await notifyBookingOutcome(params);
  } catch (err) {
    console.error('booking-tools.js: notification email failed', err);
  }
}

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
    'Book a confirmed meeting slot on the calendar. Only call this after the visitor has explicitly picked one specific time from what check_availability returned, and after you have their name, email, and phone number, and after they have agreed to Axoncore collecting that information (name, email, phone) via Calendly and its processors to arrange the call. Do NOT call this a second time in the same conversation to move a time that was already successfully booked earlier — there is no reschedule/cancel tool, so a second call creates a separate second real meeting instead of changing the first one. If the visitor wants to change a time that is already booked, tell them plainly that the confirmation email Calendly sent includes a reschedule link, or that Tristan can handle the change directly — never call this tool again for that purpose.',
  parameters: {
    type: 'object',
    properties: {
      start_time: {
        type: 'string',
        description:
          'The exact UTC start_time value from check_availability\'s result, copied character-for-character. This is ALREADY converted from Singapore local time to UTC for you — never compute, convert, or reconstruct it yourself from the spoken local time (e.g. "9:00 am Singapore" is NOT "09:00:00Z" — copy the actual provided value, which will usually have a different hour).',
      },
      name: { type: 'string', description: "The visitor's full name." },
      email: { type: 'string', description: "The visitor's email address." },
      phone: { type: 'string', description: "The visitor's phone number." },
    },
    required: ['start_time', 'name', 'email', 'phone'],
  },
};

// Security-lock design: name/email/phone/original_date_time are collected
// from the visitor for BOTH tools below and checked against Calendly's own
// record of the booking before anything is changed — see
// findMatchingBooking() in calendly.js for exactly which of these four are
// a hard requirement (email, phone) vs. a soft disambiguator (name,
// original_date_time). Neither tool call should ever happen without the
// caller (Claude) having already asked for and read back all four plus
// gotten explicit confirmation — that's a prompt-level responsibility, not
// something this schema can enforce on its own.
const RESCHEDULE_MEETING_TOOL = {
  name: 'reschedule_meeting',
  description:
    "Move an existing confirmed booking to a new time. Call this only after the visitor has given their full name, email, phone number, and the original date/time of their existing booking (the security check used to confirm it's really their booking), AND has picked a new specific time from what check_availability returned for the new slot. If no matching booking is found, this returns a generic 'could not find a matching appointment' result — do not tell the visitor which specific field failed to match, just offer to have Tristan follow up directly.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The visitor's full name." },
      email: { type: 'string', description: "The visitor's email address — must match the email on the existing booking." },
      phone: { type: 'string', description: "The visitor's phone number, with country code — must match the phone on the existing booking." },
      original_date_time: {
        type: 'string',
        description:
          "The date/time of their EXISTING booking, as the visitor described it (e.g. 'Saturday 15 August at 10am'). Used only to identify which booking they mean if they have more than one — doesn't need to be perfectly formatted or converted.",
      },
      new_start_time: {
        type: 'string',
        description:
          "The exact UTC start_time value from check_availability's result for the NEW time, copied character-for-character — same rule as book_meeting's start_time: never compute or reconstruct this yourself.",
      },
    },
    required: ['name', 'email', 'phone', 'original_date_time', 'new_start_time'],
  },
};

const CANCEL_MEETING_TOOL = {
  name: 'cancel_meeting',
  description:
    "Cancel an existing confirmed booking. Call this only after the visitor has given their full name, email, phone number, and the original date/time of their existing booking (the security check used to confirm it's really their booking), AND has given a reason for cancelling. If no matching booking is found, this returns a generic 'could not find a matching appointment' result — do not tell the visitor which specific field failed to match, just offer to have Tristan follow up directly.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The visitor's full name." },
      email: { type: 'string', description: "The visitor's email address — must match the email on the existing booking." },
      phone: { type: 'string', description: "The visitor's phone number, with country code — must match the phone on the existing booking." },
      original_date_time: {
        type: 'string',
        description:
          "The date/time of their EXISTING booking, as the visitor described it. Used only to identify which booking they mean if they have more than one.",
      },
      reason: {
        type: 'string',
        description: 'Why the visitor is cancelling — one of the offered preset reasons, or their own words if they chose something else.',
      },
    },
    required: ['name', 'email', 'phone', 'original_date_time', 'reason'],
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
// surface: 'chat' | 'voice' | undefined — which Riley the call came from,
// used only to label the notification email, never to change behavior.
async function executeBookingTool(name, rawInput, surface) {
  const input = rawInput || {};

  if (name === 'check_availability') {
    // QA finding (2026-08-12): a real test with days_ahead sent as the
    // STRING "3" (rather than the integer 3) silently fell through to
    // undefined here (Number.isInteger rejects strings outright) and
    // defaulted to the max 7-day window instead of respecting the request.
    // Harmless in effect (7 is a safe/valid default, and VAPI's own docs
    // show integer arguments), but coercing first means a numeric-looking
    // string input still gets read correctly instead of silently ignored.
    const coercedDaysAhead = Number(input.days_ahead);
    const daysAhead = Number.isInteger(coercedDaysAhead) ? coercedDaysAhead : undefined;
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

    // Real bug found in testing (2026-08-14): a visitor asked "does 10am
    // work?" on a day already offered at 9am, and Riley flatly said "10am
    // isn't available" — false. pickSpreadSlots only surfaces ONE slot per
    // calendar day (for variety in the initial offer), but Calendly
    // genuinely had ~19 real bookable times that same day; 10am was one of
    // them. Riley was comparing against the 3 spoken options instead of an
    // actual availability check. Including every other real slot on those
    // SAME days (already fetched, no extra API call) lets Riley answer a
    // same-day "what about X time" honestly from real data instead of
    // guessing from absence.
    const pickedISOs = new Set(picks.map((s) => s.startTimeISO));
    const pickedDates = new Set(picks.map((s) => s.startTimeISO.slice(0, 10)));
    const sameDayOthers = result.slots.filter(
      (s) => pickedDates.has(s.startTimeISO.slice(0, 10)) && !pickedISOs.has(s.startTimeISO)
    );
    const otherTimesNote =
      sameDayOthers.length > 0
        ? ` If the visitor asks for a different specific time on one of those same days, check this list of every other real slot available that day before saying anything is unavailable (copy verbatim if you use one, never invent a time not in this list): ${sameDayOthers
            .map((s) => `${s.startTimeLocal} = ${s.startTimeISO}`)
            .join(' | ')}.`
        : '';
    // Fix-verification finding: even with the previous "for reference only,
    // don't speak it" wording, a real conversation still booked the WRONG
    // real slot — 09:00 UTC instead of the correct 01:00 UTC for "9:00 am
    // Singapore" — because the model reconstructed a UTC string by pasting
    // the spoken local hour straight in, rather than copying the given
    // value. Silent and structurally valid (still a real bookable slot), so
    // nothing else catches it — this has to be prevented at the prompt
    // level. Now explicit that the values are pre-converted and must be
    // copied verbatim, with the exact failure mode named directly.
    // QA finding (2026-08-12): a real conversation described the closest
    // offered option as "today" ("that's today, in about 45 minutes") when
    // it was actually the next calendar day — the model substituted a
    // relative-day word for the real weekday/date given right here in
    // `spoken`. Same class of bug as the UTC-copy issue above (a value the
    // tool already computed correctly gets silently replaced by the
    // model's own — wrong — inference), so it gets the same fix: name the
    // exact failure mode directly rather than assume it won't happen.
    return {
      ok: true,
      message: `Say to the caller, in your own words: "${spoken}, all Singapore time — which works for you?" Always state the actual weekday and date exactly as given above for each option — never substitute a relative word like "today" or "tomorrow", even for the closest option. Never state that a different time is unavailable unless you've actually checked it against real data — a wrong guess here has been a real, confirmed bug (a visitor asked about 10am and was wrongly told it wasn't available, when it genuinely was).${otherTimesNote} If the visitor asks about a day beyond what's listed here, call check_availability again rather than guessing. Once they pick one, call book_meeting with its start_time value COPIED EXACTLY, character-for-character, from the reference list below. These values are already correctly converted to UTC for you — do not calculate, convert, or reconstruct start_time yourself from the spoken local time, and never assume the UTC hour matches the Singapore hour shown (it usually won't). Reference (exact start_time per option — copy verbatim, never speak it): ${reference}`,
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
      // QA finding (2026-08-12): a real conversation where the visitor said
      // "whatever's soonest" booked the CORRECT slot (verified against
      // Calendly — right day, right UTC time) but Riley's own final reply
      // told the visitor the meeting was "today" when the booked day was
      // actually tomorrow — a relative-word paraphrase slip on top of an
      // otherwise-correct booking. Same fix shape as the earlier UTC-time
      // bug: name the exact failure mode directly in the tool result rather
      // than trust the model to avoid it unprompted.
      const spokenDate = formatSlotLocal(result.startTimeISO);
      await notify({
        surface,
        outcome: 'booked',
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        timeLocal: spokenDate,
      });
      return {
        ok: true,
        message: `Booked. Tell the caller it's confirmed for "${spokenDate}, Singapore time" — state that exact day and date, never a relative word like "today" or "tomorrow" even if it's the soonest option. Tristan will send the Google Meet link before the call. A confirmation has been sent to ${input.email.trim()}.`,
      };
    }

    // One notification covers every failure code below — the visitor's
    // contact fields are already known at this point regardless of which
    // specific Calendly error came back.
    await notify({
      surface,
      outcome: 'book_failed',
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      detail: result.code || result.message,
    });

    if (result.code === 'invalid_email') {
      return { ok: false, message: "That email didn't go through — could you double check it and give it to me again?" };
    }
    if (result.code === 'invalid_phone') {
      return { ok: false, message: "That phone number didn't go through — could you give it again, including the country code?" };
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

  if (name === 'reschedule_meeting' || name === 'cancel_meeting') {
    const validation = validateContactFields(input);
    if (!validation.ok) return validation;

    if (name === 'reschedule_meeting' && (typeof input.new_start_time !== 'string' || input.new_start_time.trim().length === 0)) {
      return { ok: false, message: 'A specific new time is needed — call check_availability again if the options are unclear.' };
    }

    const match = await findMatchingBooking({
      email: input.email.trim(),
      phone: input.phone.trim(),
      name: input.name.trim(),
      dateTimeHint: input.original_date_time,
    });

    if (!match.ok) {
      return { ok: false, message: "I'm having trouble reaching the calendar right now — I can have Tristan follow up directly instead." };
    }
    // More than one active booking matched on email+phone alone — never
    // guess which one from a free-text hint (see the comment in
    // calendly.js on why that used to silently pick the wrong one). This
    // is NOT the same as a genuine no-match: it doesn't count toward the
    // "stop after two tries" rule, and it should not lead to the Tristan
    // handoff — it's a legitimate one extra question, not a failed guess.
    if (match.matched === 'ambiguous') {
      const spoken = match.candidates.map((c) => c.startTimeLocal).join(', or ');
      const reference = match.candidates.map((c) => `${c.startTimeLocal} = ${c.startTimeISO}`).join(' | ');
      return {
        ok: false,
        ambiguous: true,
        message: `More than one active booking matches that name/email/phone. Say to the visitor, in your own words: "${spoken}, all Singapore time — which one do you mean?" Once they pick one, call this tool again with original_date_time set to the EXACT ISO value copied verbatim from the reference below for their chosen option — never re-describe it in your own words or re-type what they said, since a second free-text guess can't be reliably matched either. Reference (copy verbatim, never speak it): ${reference}. This is a legitimate clarifying question, not a failed match — do not treat it as one of the two allowed no-match attempts, and do not offer the Tristan handoff for this specifically.`,
      };
    }
    // Deliberately the SAME generic message whether the email had zero
    // bookings, or matched a booking but the phone didn't — per the
    // product decision not to reveal which specific field failed, so a
    // wrong guess at someone else's details gets no signal about which
    // part was correct.
    if (!match.matched) {
      await notify({
        surface,
        outcome: name === 'cancel_meeting' ? 'cancel_failed' : 'reschedule_failed',
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        detail: 'No matching booking found for the details given',
      });
      return {
        ok: false,
        message: "I couldn't find a matching appointment with those details — I can have Tristan follow up directly instead.",
      };
    }

    if (name === 'cancel_meeting') {
      const reason =
        typeof input.reason === 'string' && input.reason.trim().length > 0 ? input.reason.trim().slice(0, 500) : 'No reason given';
      const cancelResult = await cancelBooking({ eventUuid: match.event.uuid, reason });
      if (!cancelResult.ok) {
        await notify({
          surface,
          outcome: 'cancel_failed',
          name: input.name.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
          timeLocal: match.event.startTimeLocal,
          detail: 'Calendly cancellation call failed',
        });
        return { ok: false, message: "I'm having trouble cancelling that right now — I can have Tristan follow up directly instead." };
      }
      await notify({
        surface,
        outcome: 'cancelled',
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        timeLocal: match.event.startTimeLocal,
        reason,
      });
      return {
        ok: true,
        message: `Cancelled. Tell the visitor their appointment for "${match.event.startTimeLocal}, Singapore time" has been cancelled, and a cancellation confirmation has been sent to ${input.email.trim()}.`,
      };
    }

    // reschedule_meeting: Calendly has no in-place "move" endpoint — this
    // is cancel-the-old + book-the-new, the same two steps Calendly's own
    // reschedule_url performs behind the scenes (see calendly.js).
    const cancelResult = await cancelBooking({ eventUuid: match.event.uuid, reason: 'Rescheduled by client via AI assistant' });
    if (!cancelResult.ok) {
      await notify({
        surface,
        outcome: 'reschedule_failed',
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        timeLocal: match.event.startTimeLocal,
        detail: 'Calendly cancellation call (step 1 of reschedule) failed',
      });
      return { ok: false, message: "I'm having trouble updating that booking right now — I can have Tristan follow up directly instead." };
    }

    const bookResult = await bookMeeting({
      startTimeISO: input.new_start_time.trim(),
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
    });

    if (bookResult.ok) {
      const spokenDate = formatSlotLocal(bookResult.startTimeISO);
      await notify({
        surface,
        outcome: 'rescheduled',
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
        timeLocal: match.event.startTimeLocal,
        newTimeLocal: spokenDate,
      });
      return {
        ok: true,
        message: `Rescheduled. Tell the visitor it's confirmed for "${spokenDate}, Singapore time" — state that exact day and date, never a relative word like "today" or "tomorrow". A fresh confirmation has been sent to ${input.email.trim()}.`,
      };
    }

    // Real failure mode worth naming explicitly: the OLD slot is already
    // released at this point (the cancellation above already succeeded),
    // so a failure here means the visitor currently has NO booking at all
    // — never let this read like a harmless retry of an unchanged state.
    // Flagged clearly in the notification too, since this is the one
    // failure mode where Tristan needs to personally follow up, not just
    // be informed.
    await notify({
      surface,
      outcome: 'reschedule_failed',
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      timeLocal: match.event.startTimeLocal,
      detail: `URGENT — old slot already released, new booking failed (${bookResult.code || 'unknown error'}). Visitor currently has NO booking at all.`,
    });

    if (bookResult.code === 'slot_taken') {
      return {
        ok: false,
        message:
          'The original time has already been released, and that new slot was just taken by someone else — the visitor currently has no booking at all. Call check_availability again immediately and get them onto a fresh slot right away, do not just apologize and stop.',
      };
    }
    return {
      ok: false,
      message:
        "The original time has already been released, but the new one could not be booked — the visitor currently has no booking at all. Say this plainly and offer to have Tristan follow up directly to get them rebooked.",
    };
  }

  return { ok: false, message: 'Unknown tool.' };
}

module.exports = {
  CHECK_AVAILABILITY_TOOL,
  BOOK_MEETING_TOOL,
  RESCHEDULE_MEETING_TOOL,
  CANCEL_MEETING_TOOL,
  toClaudeToolSchema,
  executeBookingTool,
};
