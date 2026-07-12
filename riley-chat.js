/* riley-chat.js
 *
 * Real Riley — calls /api/chat (Claude, server-side) instead of the old
 * riley-demo.js keyword-matching state machine or the abandoned Voiceflow
 * embed. Drives the interactive phone mockup in the "Try it yourself"
 * section (#rp-messages / #rp-phone-input / #rp-phone-send).
 *
 * Bubble/typing-indicator DOM structure and CSS classes are carried over
 * unchanged from riley-demo.js (rp-bubble / rp-bubble--riley /
 * rp-bubble--caller / rp-bubble--typing) so the visual style matches what
 * was already established — only the "brain" behind it changed.
 */
(function () {
  var msgContainer = document.getElementById('rp-messages');
  var inputEl = document.getElementById('rp-phone-input');
  var sendBtn = document.getElementById('rp-phone-send');

  if (!msgContainer || !inputEl || !sendBtn) return; // page not loaded yet / markup missing

  var AUTO_GREET_TEXT =
    "Hi, I'm Riley — Axoncore's AI receptionist. I handle inbound calls and messages, qualify the lead, and get the appointment booked, end to end, with no human in the loop.\n\nWhat's the business?";

  // Full running conversation, resent to /api/chat on every turn — this is
  // the client-side history-resend pattern the backend expects. Kept in
  // page memory only; nothing here is persisted across a reload.
  var history = [];
  var busy = false; // true while a request is in flight or the auto-greet delay is running

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleSend();
  });

  // Auto-greet after 1.2s, same timing/feel as the previous engine.
  setInput(false);
  setTimeout(function () {
    addMsg('riley', AUTO_GREET_TEXT);
    history.push({ role: 'assistant', content: AUTO_GREET_TEXT });
    setInput(true);
  }, 1200);

  /* ── Send handler ─────────────────────────────────────────────── */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || busy) return;
    inputEl.value = '';
    addMsg('caller', text);
    history.push({ role: 'user', content: text });
    sendToRiley();
  }

  function sendToRiley() {
    busy = true;
    setInput(false);
    showTyping();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: history }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        hideTyping();
        if (!result.ok || !result.data || typeof result.data.reply !== 'string') {
          showError();
          return;
        }
        addMsg('riley', result.data.reply);
        history.push({ role: 'assistant', content: result.data.reply });
      })
      .catch(function () {
        hideTyping();
        showError();
      })
      .finally(function () {
        busy = false;
        setInput(true);
      });
  }

  function showError() {
    addMsg(
      'riley',
      "Sorry — that message didn't go through. Mind trying again in a moment?"
    );
  }

  /* ── Typing indicator ─────────────────────────────────────────── */
  function showTyping() {
    var existing = document.getElementById('rp-typing');
    if (existing) return;
    var div = document.createElement('div');
    div.id = 'rp-typing';
    div.className = 'rp-bubble rp-bubble--riley rp-bubble--typing';
    div.innerHTML =
      '<span class="rp-typing-dot"></span><span class="rp-typing-dot"></span><span class="rp-typing-dot"></span>';
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

  /* ── Add bubble ───────────────────────────────────────────────── */
  function addMsg(speaker, text) {
    var div = document.createElement('div');
    div.className = 'rp-bubble rp-bubble--' + speaker;
    div.innerHTML = escHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    div.style.opacity = '0';
    div.style.transform = 'translateY(10px) scale(0.96)';
    msgContainer.appendChild(div);
    scroll();
    requestAnimationFrame(function () {
      div.style.transition =
        'opacity 0.3s cubic-bezier(0.34,1.56,0.64,1), transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
      div.style.opacity = '1';
      div.style.transform = 'translateY(0) scale(1)';
    });
  }

  /* ── Helpers ──────────────────────────────────────────────────── */
  function scroll() {
    setTimeout(function () {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 50);
  }
  function setInput(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (enabled) inputEl.focus({ preventScroll: true });
    inputEl.placeholder = enabled ? 'Message Riley…' : 'Riley is typing…';
  }
  function escHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Hint chips: click-to-fill-and-send ──────────────────────── */
  // Exposed globally so the onclick="rp_insertHint(this)" attributes in
  // riley.html's markup can reach it — same wiring pattern as the old
  // riley-demo.js version, just pointed at this module's input/send refs.
  window.rp_insertHint = function (el) {
    if (inputEl.disabled) return;
    inputEl.value = el.textContent;
    inputEl.focus();
    if (!sendBtn.disabled) sendBtn.click();
  };
})();
