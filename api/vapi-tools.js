// /api/vapi-tools.js
//
// Webhook VAPI POSTs to mid-call when Riley (the voice assistant) invokes a
// custom tool. Named generically rather than "booking" — a future VAPI tool
// (e.g. an FAQ lookup) can be added as another case in the dispatch below
// without a new endpoint or a new server URL entered into VAPI's dashboard.
//
// Request/response shape — CORRECTED 2026-08-14 against a real live call's
// actual payload (VAPI's own call-log API, cross-checked by sending both
// shapes to this endpoint directly): each entry in toolCallList is really
// { id, type: "function", function: { name, arguments } } — the name and
// arguments are nested under `function`, not flat on the call object. The
// original flat shape below ({ id, name, arguments }) was what an earlier
// version of this file assumed (and what an older doc reference showed),
// but every real tool call ever made against this endpoint has actually
// been silently returning "Unknown tool." as a result — check_availability
// and book_meeting included, not just the newer reschedule/cancel tools.
// This was invisible in transcripts because Riley/Gemini would just narrate
// around the failure rather than surface a raw error. getToolCallName/
// getToolCallArgs below check the nested shape FIRST and fall back to the
// flat shape, so this keeps working even if VAPI's format changes again.
//   in:  { message: { type: "tool-calls", toolCallList: [{ id, type, function: { name, arguments } }] } }
//   out: { results: [{ toolCallId, result: "<string the assistant speaks>" }] }
//
// Auth: VAPI's own secret/signature mechanism (server.secret -> a signature
// header) has open reliability reports in their community forum, so this
// uses the more explicit, unambiguous path instead — a static shared
// secret set on the tool's server.headers config in VAPI, checked here with
// the same timing-safe-compare idiom api/chat.js already uses for its own
// signing (see verifySig() there). This can write a real calendar event, so
// a request that fails this check is rejected before its body is even read.
const crypto = require('crypto');
const { executeBookingTool } = require('./_lib/booking-tools');

const TOOL_SECRET_HEADER = 'x-vapi-tool-secret';

function verifyVapiSecret(req) {
  const expected = process.env.VAPI_TOOL_WEBHOOK_SECRET;
  const provided = req.headers[TOOL_SECRET_HEADER];
  if (!expected || typeof provided !== 'string' || provided.length === 0) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!process.env.VAPI_TOOL_WEBHOOK_SECRET) {
    console.error('vapi-tools.js: VAPI_TOOL_WEBHOOK_SECRET is not set.');
    res.status(500).json({ error: 'Tool webhook temporarily unavailable.' });
    return;
  }

  if (!verifyVapiSecret(req)) {
    console.warn('vapi-tools.js: rejected request — missing or invalid shared secret.');
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  // Same defensive fallback as api/chat.js — Vercel's Node runtime normally
  // parses application/json bodies automatically.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }
  }

  const toolCallList =
    body && body.message && Array.isArray(body.message.toolCallList) ? body.message.toolCallList : [];

  if (toolCallList.length === 0) {
    res.status(400).json({ error: 'No tool calls in request.' });
    return;
  }

  // Real-call finding: a live test call ended with Riley telling the caller
  // a meeting "has been booked" with no matching Calendly event and no
  // server-side error — meaning the failure (wrong tool called, or the
  // model narrating ahead of the actual result) was invisible after the
  // fact. Logging which tool ran and whether it actually succeeded, on
  // every call, closes that blind spot for next time.
  const results = await Promise.all(
    toolCallList.map(async (call) => {
      // See the corrected shape note above the request/response comment at
      // the top of this file — check the real nested function.name/
      // function.arguments first, fall back to a flat call.name/
      // call.arguments in case VAPI's format ever reverts or varies again.
      const name = (call.function && call.function.name) || call.name;

      // QA hardening (2026-08-12): VAPI's own docs show `arguments` as an
      // already-parsed object, and every real test so far has matched
      // that — but tool-calling arguments arriving as a JSON-encoded
      // STRING instead is a known format variance in other providers'
      // function-calling implementations, and nothing here would catch it
      // (a bare string has no .start_time etc., so it would silently look
      // like a missing-field validation failure with no diagnostic trail).
      // Same defensive-parse pattern already used for req.body above.
      let args = (call.function && call.function.arguments) || call.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch (err) {
          console.warn('vapi-tools.js: tool call arguments arrived as a non-JSON string', name);
          args = {};
        }
      }
      const outcome = await executeBookingTool(name, args);
      console.log('vapi-tools.js: tool call', name, 'ok=', outcome.ok, 'args=', JSON.stringify(args));
      return { toolCallId: call.id, result: outcome.message };
    })
  );

  res.status(200).json({ results });
};
