// /api/_lib/email.js
//
// Sends operational notification emails to Tristan whenever a booking
// action happens on either Riley surface (chat or voice) — booked, booking
// failed, cancelled, cancel failed, rescheduled, reschedule failed. Uses
// Resend's REST API directly via fetch, the same no-SDK pattern already
// used for the Anthropic API in api/chat.js.
//
// Best-effort side channel — a failure here must never break the actual
// booking/cancel/reschedule flow the visitor is waiting on. Every call site
// awaits this but wraps it in .catch() and only logs, by design.

const RESEND_API_BASE = 'https://api.resend.com';

async function sendNotificationEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL_TO;
  const from = process.env.NOTIFY_EMAIL_FROM || 'Axoncore Notifications <onboarding@resend.dev>';

  if (!apiKey || !to) {
    console.error('email.js: RESEND_API_KEY or NOTIFY_EMAIL_TO not set — skipping notification email.');
    return { ok: false };
  }

  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('email.js: Resend API error', res.status, text);
    return { ok: false };
  }
  return { ok: true };
}

const SURFACE_LABEL = { chat: 'Website chat', voice: 'Voice call' };

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function row(label, value) {
  return `<tr><td style="padding:4px 16px 4px 0;color:#666;font-family:sans-serif;font-size:14px;white-space:nowrap;">${escapeHtml(
    label
  )}</td><td style="padding:4px 0;font-family:sans-serif;font-size:14px;"><strong>${escapeHtml(value)}</strong></td></tr>`;
}

const OUTCOME_META = {
  booked: { emoji: '✅', title: 'New meeting booked' },
  book_failed: { emoji: '⚠️', title: 'Booking attempt failed' },
  cancelled: { emoji: '❌', title: 'Meeting cancelled' },
  cancel_failed: { emoji: '⚠️', title: 'Cancellation attempt failed' },
  rescheduled: { emoji: '🔄', title: 'Meeting rescheduled' },
  reschedule_failed: { emoji: '⚠️', title: 'Reschedule attempt failed' },
};

// -> { subject, html }
function formatBookingOutcomeEmail({ surface, outcome, name, email, phone, timeLocal, newTimeLocal, reason, detail }) {
  const surfaceLabel = SURFACE_LABEL[surface] || 'Riley';
  const meta = OUTCOME_META[outcome] || { emoji: 'ℹ️', title: 'Booking activity' };

  const rows = [row('Name', name), row('Email', email), row('Phone', phone), row('Via', surfaceLabel)];
  if (timeLocal) {
    rows.push(row(outcome === 'rescheduled' || outcome === 'reschedule_failed' ? 'Original time' : 'Time', timeLocal));
  }
  if (newTimeLocal) rows.push(row('New time', newTimeLocal));
  if (reason) rows.push(row('Reason given', reason));
  if (detail) rows.push(row('Detail', detail));

  const html = `<div style="font-family:sans-serif;">
  <h2 style="margin:0 0 12px;">${meta.emoji} ${escapeHtml(meta.title)}</h2>
  <table cellpadding="0" cellspacing="0">${rows.join('')}</table>
  <p style="color:#999;font-size:12px;margin-top:16px;">Sent automatically by Riley — check Calendly directly before treating this as confirmed, especially for a failure.</p>
</div>`;

  return { subject: `${meta.emoji} ${meta.title} — ${name || 'Unknown'}`, html };
}

async function notifyBookingOutcome(params) {
  const { subject, html } = formatBookingOutcomeEmail(params);
  return sendNotificationEmail({ subject, html });
}

module.exports = { sendNotificationEmail, notifyBookingOutcome };
