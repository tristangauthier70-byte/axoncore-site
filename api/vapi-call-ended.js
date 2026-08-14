// /api/vapi-call-ended.js
//
// Assistant-level server URL VAPI posts ALL non-tool-call server messages
// to (end-of-call-report, status-update, hang, etc. — see serverMessages on
// the assistant config). Tool calls (check_availability, book_meeting,
// reschedule_meeting, cancel_meeting) are NOT routed here — each of those
// tools has its own server.url pointing at api/vapi-tools.js, which takes
// priority over this assistant-level default. This endpoint only acts on
// "end-of-call-report" and ignores every other message type it receives.
//
// Payload shape (VAPI docs, 2026-08-14):
//   { message: { type: "end-of-call-report", endedReason, call: {...}, artifact: { transcript, messages, recording } } }
//
// Same shared-secret auth pattern as api/vapi-tools.js — reuses
// VAPI_TOOL_WEBHOOK_SECRET since this is configured on the same assistant
// by the same person, not a separate credential to manage.

const crypto = require('crypto');
const { sendNotificationEmail } = require('./_lib/email');

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

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!process.env.VAPI_TOOL_WEBHOOK_SECRET) {
    console.error('vapi-call-ended.js: VAPI_TOOL_WEBHOOK_SECRET is not set.');
    res.status(500).json({ error: 'Webhook temporarily unavailable.' });
    return;
  }

  if (!verifyVapiSecret(req)) {
    console.warn('vapi-call-ended.js: rejected request — missing or invalid shared secret.');
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }
  }

  const message = body && body.message;

  // Every other serverMessages type (status-update, hang, speech-update,
  // etc.) lands here too since this is the assistant-level default — those
  // are expected and not an error, just nothing this endpoint acts on.
  if (!message || message.type !== 'end-of-call-report') {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const call = message.call || {};
  const summary = call.summary || message.summary || '';
  const endedReason = message.endedReason || call.endedReason || 'unknown';
  const transcript = (message.artifact && message.artifact.transcript) || call.transcript || '';
  const customerNumber = (call.customer && call.customer.number) || '';

  const html = `<div style="font-family:sans-serif;">
  <h2 style="margin:0 0 12px;">📞 Voice call ended</h2>
  <table cellpadding="0" cellspacing="0">
    <tr><td style="padding:4px 16px 4px 0;color:#666;font-size:14px;white-space:nowrap;">Ended reason</td><td style="padding:4px 0;font-size:14px;"><strong>${escapeHtml(endedReason)}</strong></td></tr>
    ${customerNumber ? `<tr><td style="padding:4px 16px 4px 0;color:#666;font-size:14px;white-space:nowrap;">Caller number</td><td style="padding:4px 0;font-size:14px;"><strong>${escapeHtml(customerNumber)}</strong></td></tr>` : ''}
  </table>
  ${summary ? `<p style="font-size:14px;"><strong>Summary:</strong><br>${escapeHtml(summary)}</p>` : ''}
  ${
    transcript
      ? `<details style="margin-top:12px;"><summary style="cursor:pointer;color:#666;font-size:13px;">Full transcript</summary><pre style="white-space:pre-wrap;font-size:12px;color:#333;background:#f5f5f5;padding:12px;border-radius:6px;">${escapeHtml(
          transcript
        )}</pre></details>`
      : ''
  }
  <p style="color:#999;font-size:12px;margin-top:16px;">If a booking/cancel/reschedule happened on this call, that's a separate email — this is just the overall call wrap-up.</p>
</div>`;

  await sendNotificationEmail({
    subject: `📞 Voice call ended${summary ? ' — ' + summary.slice(0, 60) : ''}`,
    html,
  }).catch((err) => console.error('vapi-call-ended.js: notification email failed', err));

  res.status(200).json({ ok: true });
};
