/* ═══════════════════════════════════════════════════════════════
   riley-demo.js — Interactive Riley chat for riley.html
   Simulates Riley's real qualification + recommendation flow.
   NO external API calls — all local, instant, no latency.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var STATE = 'idle'; // idle → greet → qualify_channel → qualify_volume → recommend → book
  var CHANNEL_HINT = '';  // 'phone' | 'chat' | 'omni'
  var VOLUME_HINT  = '';  // 'lite' | 'standard' | 'pro'
  var USER_NAME    = '';

  /* ── Package data (matches CLAUDE.md pricing) ───────────────── */
  var PACKAGES = {
    phone: {
      A_lite:     { name: 'AI Phone System — Lite',     setup: '$599', monthly: '$145', mins: '300 mins/mo' },
      A_standard: { name: 'AI Phone System — Standard', setup: '$599', monthly: '$250', mins: '600 mins/mo' },
      A_pro:      { name: 'AI Phone System — Pro',      setup: '$599', monthly: '$450', mins: '1,200 mins/mo' }
    },
    chat: {
      B_lite:     { name: 'Conversion System — Lite',     setup: '$999', monthly: '$600', mins: '300 mins/mo' },
      B_standard: { name: 'Conversion System — Standard', setup: '$999', monthly: '$705', mins: '600 mins/mo' },
      B_pro:      { name: 'Conversion System — Pro',      setup: '$999', monthly: '$905', mins: '1,200 mins/mo' }
    },
    omni: {
      C_lite:     { name: 'Omnichannel Front Desk — Lite',     setup: '$1,399', monthly: '$899',   mins: '300 mins/mo' },
      C_standard: { name: 'Omnichannel Front Desk — Standard', setup: '$1,399', monthly: '$1,199', mins: '600 mins/mo' },
      C_pro:      { name: 'Omnichannel Front Desk — Pro',      setup: '$1,399', monthly: '$1,399', mins: '1,200 mins/mo' }
    }
  };

  /* ── DOM refs ───────────────────────────────────────────────── */
  var msgContainer = document.getElementById('rp-messages');
  var inputEl      = document.getElementById('rp-phone-input');
  var sendBtn      = document.getElementById('rp-phone-send');
  var confirmEl    = document.querySelector('.rp-phone__confirm');

  if (!msgContainer || !inputEl || !sendBtn) return; // page not loaded yet

  /* ── Init ───────────────────────────────────────────────────── */
  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleSend(); });

  // Auto-greet after 1.2s
  setTimeout(function () {
    addMsg('riley', "Hey there! 👋 I'm *Riley* — Axon Core's AI receptionist. I answer calls, qualify leads, and book appointments 24/7.\n\nWhat kind of business do you run?");
    STATE = 'greet';
    setInput(true);
  }, 1200);

  /* ── Send handler ───────────────────────────────────────────── */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || STATE === 'typing') return;
    inputEl.value = '';
    addMsg('caller', text);
    setTimeout(function () { respond(text.toLowerCase()); }, 600);
  }

  /* ── Response router ────────────────────────────────────────── */
  function respond(txt) {
    /* Universal FAQ intercepts */
    if (matchAny(txt, ['price','cost','how much','pricing','sgd','dollar'])) {
      return riley("Great question — I'll get to pricing once I know your setup, it only takes 30 seconds and makes sure I recommend the right fit. " + nextPrompt());
    }
    if (matchAny(txt, ['how does it work','how do you work','what do you do','capabilities','can you do','features'])) {
      return riley("I'm an AI trained on your specific business — your FAQs, pricing, services. When a client calls or messages:\n\n• I answer instantly, 24/7\n• I qualify them in 2 questions\n• I book the appointment automatically\n\nNo hold music. No missed calls. No humans needed. " + nextPrompt());
    }
    if (matchAny(txt, ['real','human','ai','robot','bot','fake','are you'])) {
      return riley("100% real AI — not a human, not a recording. The same technology answers your actual clients' calls every day. What I just said to you? That's what your callers hear. 🤖\n\n" + nextPrompt());
    }
    if (matchAny(txt, ['book','schedule','talk','call','interested','yes','sure','sounds good','let\'s go','great'])) {
      if (STATE === 'recommend' || STATE === 'book') return showBooking();
      /* If they want to book before qualifying, fast-track */
      return riley("Love the energy! Let me just quickly figure out the right fit for you — 2 quick questions. " + nextPrompt());
    }

    /* State machine */
    if (STATE === 'greet') {
      /* Extract name if they introduced themselves */
      var nameMatch = txt.match(/(?:i'm|i am|my name is|name's)\s+([a-z]+)/i);
      if (nameMatch) USER_NAME = cap(nameMatch[1]);
      return qualifyChannel();
    }

    if (STATE === 'qualify_channel') {
      if (matchAny(txt, ['phone','call','ring','voice','number'])) {
        CHANNEL_HINT = 'phone';
      } else if (matchAny(txt, ['whatsapp','instagram','facebook','social','tiktok','all','every','omni','multiple','mix'])) {
        CHANNEL_HINT = 'omni';
      } else if (matchAny(txt, ['chat','website','web','message','online','email'])) {
        CHANNEL_HINT = 'chat';
      } else {
        /* Assume omni if unclear */
        CHANNEL_HINT = 'omni';
      }
      return qualifyVolume();
    }

    if (STATE === 'qualify_volume') {
      var num = parseInt(txt.replace(/[^0-9]/g, ''), 10);
      if ((!isNaN(num) && num < 120) || matchAny(txt, ['few','small','low','quiet','not many','10','20','30','40','50','60','70','80','90','100'])) {
        VOLUME_HINT = 'lite';
      } else if ((!isNaN(num) && num >= 250) || matchAny(txt, ['lots','many','busy','high','hundreds','over 200','250','300','400','500'])) {
        VOLUME_HINT = 'pro';
      } else {
        VOLUME_HINT = 'standard';
      }
      return recommend();
    }

    if (STATE === 'recommend') {
      return showBooking();
    }

    /* Fallback */
    riley("Got it! " + nextPrompt());
  }

  /* ── Conversation steps ─────────────────────────────────────── */
  function qualifyChannel() {
    STATE = 'qualify_channel';
    riley((USER_NAME ? 'Nice to meet you, ' + USER_NAME + '! ' : 'Perfect! ') + "Quick question — how do clients usually reach you? *Phone calls*, *website chat*, *WhatsApp / Instagram / Facebook*, or a mix of all of them?");
  }

  function qualifyVolume() {
    STATE = 'qualify_volume';
    var channelLabel = CHANNEL_HINT === 'phone' ? 'calls' : CHANNEL_HINT === 'chat' ? 'website messages' : 'enquiries across your channels';
    riley("Got it. And roughly how many " + channelLabel + " does your business handle in a typical month?");
  }

  function recommend() {
    STATE = 'recommend';
    var pkg = getPackage();
    riley("Based on what you've told me, I'd recommend our *" + pkg.name + "*.\n\n• Setup: " + pkg.setup + " (one-time)\n• Monthly: " + pkg.monthly + "/mo\n• Includes: " + pkg.mins + "\n• 36-month agreement · Founding client rate\n\nThis covers " + channelCopy() + " — all handled automatically by your AI, 24/7. Want me to book you a free 30-minute strategy call with Tristan to get you live in 14 days?");
  }

  function showBooking() {
    STATE = 'book';
    riley("Wonderful! Booking you in now… 🎉", function () {
      setTimeout(function () {
        if (confirmEl) {
          /* Swap in a strategy call confirmation */
          var titleEl = confirmEl.querySelector('.rp-confirm__title');
          var subEl   = confirmEl.querySelector('.rp-confirm__sub');
          var rows    = confirmEl.querySelectorAll('.rp-confirm__row');
          if (titleEl) titleEl.textContent = 'CALL BOOKED ✓';
          if (subEl)   subEl.textContent   = 'Tristan will walk you through your custom setup.';
          if (rows[0]) rows[0].querySelector('.rp-confirm__val').textContent = USER_NAME || 'You';
          if (rows[1]) rows[1].querySelector('.rp-confirm__val').textContent = '30-min Strategy Call';
          if (rows[2]) rows[2].querySelector('.rp-confirm__val').textContent = 'hello@axoncoreai.com';
          if (rows[3]) { rows[3].querySelector('.rp-confirm__val').textContent = 'Confirmed ✓'; rows[3].querySelector('.rp-confirm__val').style.color = '#4ade80'; }
          confirmEl.classList.add('visible');
          launchConfetti();
        }
        setInput(false);
      }, 800);
    });
  }

  /* ── Riley typing then message ──────────────────────────────── */
  function riley(text, cb) {
    STATE = 'typing';
    setInput(false);
    showTyping();
    var delay = Math.min(500 + text.length * 14, 2200);
    setTimeout(function () {
      hideTyping();
      addMsg('riley', text);
      STATE = STATE === 'typing' ? 'idle' : STATE;
      setInput(true);
      if (cb) cb();
    }, delay);
  }

  /* ── Typing indicator ───────────────────────────────────────── */
  function showTyping() {
    var existing = document.getElementById('rp-typing');
    if (existing) return;
    var div = document.createElement('div');
    div.id = 'rp-typing';
    div.className = 'rp-bubble rp-bubble--riley rp-bubble--typing';
    div.innerHTML = '<span class="rp-typing-dot"></span><span class="rp-typing-dot"></span><span class="rp-typing-dot"></span>';
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

  /* ── Add bubble ─────────────────────────────────────────────── */
  function addMsg(speaker, text) {
    var div = document.createElement('div');
    div.className = 'rp-bubble rp-bubble--' + speaker;
    /* Bold *text* */
    div.innerHTML = escHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    div.style.opacity = '0';
    div.style.transform = 'translateY(10px) scale(0.96)';
    msgContainer.appendChild(div);
    scroll();
    requestAnimationFrame(function () {
      div.style.transition = 'opacity 0.3s cubic-bezier(0.34,1.56,0.64,1), transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
      div.style.opacity = '1';
      div.style.transform = 'translateY(0) scale(1)';
    });
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function scroll() {
    setTimeout(function () { msgContainer.scrollTop = msgContainer.scrollHeight; }, 50);
  }
  function setInput(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    /* preventScroll: true — THIS IS THE FIX for "scroll jumps to the bottom
       on its own ~2s after page load." setInput(true) fires from the
       auto-greet timer 1.2s after this script loads, completely unprompted
       by the visitor. #rp-phone-input lives far down the page (section 4b,
       "Try it yourself"), so a bare .focus() made the browser silently
       invoke its native "scroll focused element into view" behavior on a
       section nobody asked to see — confirmed via instrumented Playwright
       trace: focus() fires, then scrollY climbs from 0 toward that input's
       position over the next ~900ms with zero user input. preventScroll
       keeps the input ready to type into (unchanged behavior for the
       normal case where the visitor already has this section in view)
       without hijacking the viewport for everyone else. */
    if (enabled) inputEl.focus({ preventScroll: true });
    inputEl.placeholder = enabled ? 'Message Riley…' : 'Riley is typing…';
  }
  function matchAny(txt, words) {
    return words.some(function (w) { return txt.indexOf(w) !== -1; });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function nextPrompt() {
    if (STATE === 'greet')           return 'What kind of business do you run?';
    if (STATE === 'qualify_channel') return 'How do clients usually reach you?';
    if (STATE === 'qualify_volume')  return 'How many enquiries per month?';
    return 'Ready to see what this looks like for your business?';
  }
  function getPackage() {
    var ch  = CHANNEL_HINT  || 'omni';
    var vol = VOLUME_HINT   || 'standard';
    var map = { phone: { lite:'A_lite', standard:'A_standard', pro:'A_pro' },
                chat:  { lite:'B_lite', standard:'B_standard', pro:'B_pro' },
                omni:  { lite:'C_lite', standard:'C_standard', pro:'C_pro' } };
    return PACKAGES[ch][map[ch][vol]];
  }
  function channelCopy() {
    if (CHANNEL_HINT === 'phone') return 'phone calls 24/7';
    if (CHANNEL_HINT === 'chat')  return 'phone + website chat';
    return 'phone, website chat, WhatsApp, Instagram & Facebook';
  }

  /* ── Confetti ───────────────────────────────────────────────── */
  function launchConfetti() {
    var phone = document.querySelector('.rp-phone');
    if (!phone) return;
    var colors = ['#7c3aed','#a78bfa','#4ade80','#fbbf24','#f472b6'];
    for (var i = 0; i < 20; i++) {
      (function (i) {
        setTimeout(function () {
          var el = document.createElement('div');
          el.className = 'rp-confetti';
          el.style.cssText = 'left:' + (15+Math.random()*70) + '%;top:' + (10+Math.random()*50) + '%;background:' + colors[i%5] + ';width:' + (5+Math.random()*5) + 'px;height:' + (5+Math.random()*5) + 'px;animation-duration:' + (0.6+Math.random()*0.5) + 's';
          phone.appendChild(el);
          setTimeout(function () { el.remove(); }, 1200);
        }, i * 50);
      })(i);
    }
  }

})();
