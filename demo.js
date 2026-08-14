/* demo.js
 *
 * Lumina Aesthetics "Try it live" chatbot demo, on pricing.html's Engage
 * module card. Aria — the persona this widget speaks as — used to be a
 * fully local, hardcoded JavaScript state machine: ~1,800 lines of
 * keyword-matching against a scripted FAQ array, manual date/slot
 * arithmetic, and a hand-rolled booking flow. That's retired. This file now
 * only drives the widget's UI — sending each visitor message to
 * /api/demo-chat (Claude Haiku 4.5, server-side) and rendering whatever
 * comes back — the same "thin client, real brain on the server" pattern
 * riley-chat.js already uses for Riley elsewhere on this site.
 *
 * DOM structure and CSS classes are unchanged from the old implementation
 * (#ax-demo-chat, #ax-demo-input, #ax-demo-send, #ax-demo-suggestions,
 * #ax-demo-overlay, #ax-confirm-service/-datetime/-consultant/-addon/-name)
 * — only the logic behind them changed. See git history on this file for
 * the retired local script if it's ever needed for reference.
 */
(function () {
  'use strict';

  var chat    = document.getElementById('ax-demo-chat');
  var inputEl = document.getElementById('ax-demo-input');
  var sendBtn = document.getElementById('ax-demo-send');
  var suggsEl = document.getElementById('ax-demo-suggestions');
  var overlay = document.getElementById('ax-demo-overlay');

  if (!chat || !inputEl || !sendBtn) return; // markup not present on this page

  // Must exactly match AUTO_GREET_TEXT in api/demo-chat.js — the one
  // assistant message that's allowed into history as a fixed client-side
  // constant rather than server output (same convention as riley-chat.js).
  var AUTO_GREET_TEXT =
    "Hi there! 👋 Welcome to *Lumina Aesthetics*.\n\nI'm *Aria*, your AI assistant — available 24/7 to help you book treatments, answer questions about our services, pricing, location, and more.\n\nHow can I help you today? 💜";

  var GREETING_SUGGESTIONS = ['Book an appointment 📅', 'See our treatments 💆', 'Pricing 💰', 'Where are you located? 📍'];

  // Full running conversation, resent to /api/demo-chat on every turn — the
  // backend is stateless and expects the whole history back each request.
  var history = [];
  var busy = false; // true while a request is in flight or the greeting delay is running — guards double-sends

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleSend(); });

  greet(900);

  /* ── Send handler ─────────────────────────────────────────────── */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || busy) return;
    inputEl.value = '';
    clearSuggestions();
    addMessage(text, 'user');
    history.push({ role: 'user', content: text });
    sendToAria();
  }

  function sendToAria() {
    busy = true;
    showTyping();

    fetch('/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: history }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        hideTyping();
        if (!result.ok || !result.data || typeof result.data.reply !== 'string') {
          showError();
          return;
        }
        var replyText   = result.data.reply;
        var suggestions = Array.isArray(result.data.suggestions) ? result.data.suggestions : [];
        var booking     = result.data.booking || null;

        addMessage(replyText, 'aria');
        history.push({ role: 'assistant', content: replyText });

        if (suggestions.length) showSuggestions(suggestions);
        else clearSuggestions();

        if (booking) showBookingConfirmed(booking);
      })
      .catch(function () {
        hideTyping();
        showError();
      })
      .finally(function () {
        busy = false;
      });
  }

  function showError() {
    addMessage("Sorry — that message didn't go through. Mind trying again in a moment? 😊", 'aria');
  }

  /* ── Greeting (fixed, client-side — no network call) ─────────────── */
  function greet(initialDelayMs) {
    busy = true;
    setTimeout(function () {
      showTyping();
      var delay = Math.min(800 + AUTO_GREET_TEXT.length * 6, 2000);
      setTimeout(function () {
        hideTyping();
        addMessage(AUTO_GREET_TEXT, 'aria');
        history.push({ role: 'assistant', content: AUTO_GREET_TEXT });
        showSuggestions(GREETING_SUGGESTIONS);
        busy = false;
      }, delay);
    }, initialDelayMs);
  }

  /* ── Booking confirmation overlay ─────────────────────────────────
   * booking: { service, datetime, consultant, addOn (nullable), clientName }
   * — exactly the shape api/demo-chat.js's confirm_booking tool returns.
   */
  function showBookingConfirmed(booking) {
    var confirmService    = document.getElementById('ax-confirm-service');
    var confirmDatetime   = document.getElementById('ax-confirm-datetime');
    var confirmConsultant = document.getElementById('ax-confirm-consultant');
    var confirmName       = document.getElementById('ax-confirm-name');
    var addonRow          = document.getElementById('ax-confirm-addon-row');
    var confirmAddon      = document.getElementById('ax-confirm-addon');

    if (confirmService)    confirmService.textContent    = booking.service || '';
    if (confirmDatetime)   confirmDatetime.textContent   = booking.datetime || '';
    if (confirmConsultant) confirmConsultant.textContent = booking.consultant || '';
    if (confirmName)       confirmName.textContent       = booking.clientName || '';
    if (addonRow) {
      if (booking.addOn) {
        if (confirmAddon) confirmAddon.textContent = booking.addOn;
        addonRow.style.display = '';
      } else {
        addonRow.style.display = 'none';
      }
    }

    // Small delay so the visitor reads Aria's own confirmation message
    // before the card appears on top of it — same staged reveal as before.
    setTimeout(function () { if (overlay) overlay.style.display = 'flex'; }, 1800);
  }

  /* ── Typing indicator ─────────────────────────────────────────── */
  function showTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'ax-msg ax-msg--aria';
    wrap.id = 'ax-typing-indicator';
    wrap.innerHTML = '<div class="ax-msg__bubble ax-msg__typing"><span></span><span></span><span></span></div>';
    chat.appendChild(wrap);
    scrollChat();
  }

  function hideTyping() {
    var el = document.getElementById('ax-typing-indicator');
    if (el) el.remove();
  }

  /* ── Message bubble ───────────────────────────────────────────── */
  function addMessage(text, from) {
    var wrap   = document.createElement('div');
    wrap.className = 'ax-msg ax-msg--' + from;
    var bubble = document.createElement('div');
    bubble.className = 'ax-msg__bubble';
    bubble.innerHTML = escHtml(text).replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    var meta = document.createElement('div');
    meta.className = 'ax-msg__meta';
    var now = new Date(), h = now.getHours(), m = now.getMinutes();
    meta.innerHTML = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + (from === 'aria' ? ' <span class="ax-msg__tick">&#10003;&#10003;</span>' : '');
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    scrollChat();
    return wrap;
  }

  /* ── Suggestion chips ─────────────────────────────────────────── */
  function showSuggestions(items) {
    clearSuggestions();
    items.forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = 'ax-demo__sugg';
      btn.textContent = item;
      btn.addEventListener('click', function () {
        inputEl.value = item;
        handleSend();
      });
      suggsEl.appendChild(btn);
    });
  }

  function clearSuggestions() { suggsEl.innerHTML = ''; }

  /* ── Helpers ──────────────────────────────────────────────────── */
  function scrollChat() { setTimeout(function () { chat.scrollTop = chat.scrollHeight; }, 60); }
  function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ── Public reset (wired to #ax-demo-reset and the overlay's
   * "Try the demo again" button via onclick="axDemoReset()" in pricing.html) ── */
  window.axDemoReset = function () {
    history = [];
    busy = false;
    chat.innerHTML = '';
    clearSuggestions();
    inputEl.value = '';
    hideTyping();
    greet(300);
  };
})();
