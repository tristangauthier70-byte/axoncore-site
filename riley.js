(function () {
  'use strict';

  var PUBLIC_KEY   = '6ebe0428-65fd-49b7-97ff-f578df95c28b';
  var ASSISTANT_ID = 'f1c99236-1929-43bb-9ffa-aa96c11b4744';

  var vapi      = null;
  var callState = 'idle';

  var REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var WAVEFORM_SEEDS = [0.55, 0.85, 1.15, 1.3, 1.05, 0.75, 0.5];
  var waveformBars = null;

  /* ── Wait for Vapi class from self-hosted bundle ── */
  function initVapi() {
    if (typeof window.Vapi === 'undefined') {
      console.warn('[Riley] Vapi not loaded yet — retrying…');
      setTimeout(initVapi, 200);
      return;
    }

    console.log('[Riley] Vapi ready — initialising');

    try {
      vapi = new window.Vapi(PUBLIC_KEY);
    } catch (err) {
      console.warn('[Riley] Vapi init failed:', err);
      document.querySelectorAll('.riley-trigger, #riley-float-btn').forEach(function (el) {
        el.style.display = 'none';
      });
      return;
    }

    try {
      vapi.on('call-start',        onCallStart);
      vapi.on('call-end',          onCallEnd);
      vapi.on('speech-start',      onSpeechStart);
      vapi.on('speech-end',        onSpeechEnd);
      vapi.on('volume-level',      onVolumeLevel);
      vapi.on('error',             onError);
      vapi.on('call-start-failed', onCallStartFailed);
      bindUI();
      console.log('[Riley] ready — buttons bound');
    } catch (err) {
      console.warn('[Riley] event setup failed:', err);
      document.querySelectorAll('.riley-trigger, #riley-float-btn').forEach(function (el) {
        el.style.display = 'none';
      });
    }
  }

  /* ── Bind UI ── */
  function bindUI() {
    document.querySelectorAll('.riley-trigger').forEach(function (btn) {
      btn.addEventListener('click', startCall);
    });

    var endBtn  = document.getElementById('riley-end-btn');
    var muteBtn = document.getElementById('riley-mute-btn');
    if (endBtn)  endBtn.addEventListener('click', endCall);
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (callState === 'active' || callState === 'connecting')) {
        endCall();
      }
    });
  }

  /* ── State machine ── */
  function setState(s) {
    callState = s;

    var modal = document.getElementById('riley-modal');
    if (modal) modal.dataset.state = s;

    document.querySelectorAll('.riley-trigger').forEach(function (btn) {
      btn.dataset.state = s;
      btn.disabled = (s === 'connecting' || s === 'active');
      var lbl = btn.querySelector('.riley-btn-label');
      if (!lbl) return;
      switch (s) {
        case 'connecting': lbl.textContent = 'Connecting…'; break;
        case 'active':     lbl.textContent = 'In Call';     break;
        case 'ended':      lbl.textContent = 'Call ended';  break;
        case 'error':      lbl.textContent = 'Try Again';   break;
        default:           lbl.textContent = btn.dataset.defaultLabel || 'Talk to Riley'; break;
      }
    });
  }

  function setStatus(text) {
    var el = document.getElementById('riley-status-text');
    if (el) el.textContent = text;
  }

  /* ── Modal helpers ── */
  function showModal() {
    var m = document.getElementById('riley-modal');
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var endBtn = document.getElementById('riley-end-btn');
      if (endBtn) endBtn.focus();
    }, 300);
  }

  function hideModal() {
    var m = document.getElementById('riley-modal');
    if (!m) return;
    m.hidden = true;
    document.body.style.overflow = '';
    setState('idle');
    resetMute();
    resetWaveform();
    var av = document.getElementById('riley-avatar');
    if (av) av.dataset.speaking = 'false';
  }

  function getWaveformBars() {
    if (waveformBars) return waveformBars;
    var wf = document.getElementById('riley-waveform');
    waveformBars = wf ? Array.prototype.slice.call(wf.querySelectorAll('.riley-waveform__bar')) : [];
    return waveformBars;
  }

  function resetWaveform() {
    getWaveformBars().forEach(function (bar) {
      bar.style.setProperty('--bar-h', '4px');
    });
  }

  function resetMute() {
    var btn = document.getElementById('riley-mute-btn');
    if (!btn) return;
    btn.dataset.muted = 'false';
    btn.setAttribute('aria-label', 'Mute microphone');
    var lbl = btn.querySelector('.riley-btn-label');
    if (lbl) lbl.textContent = 'Mute';
  }

  /* ── Call actions ── */
  function startCall() {
    if (callState === 'connecting' || callState === 'active') return;
    if (!vapi) return;

    setState('connecting');
    setStatus('Connecting to Riley…');
    showModal();

    try {
      var result = vapi.start(ASSISTANT_ID);
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          var msg = (err && err.message && typeof err.message === 'string')
            ? err.message.toLowerCase() : '';
          if (msg.includes('permission') || msg.includes('denied') || msg.includes('microphone')) {
            onError({ type: 'mic-denied' });
          } else {
            onError({ type: 'connection-failed' });
          }
        });
      }
    } catch (err) {
      onError({ type: 'connection-failed' });
    }
  }

  function endCall() {
    if (vapi) vapi.stop();
    setTimeout(function () {
      if (callState !== 'idle' && callState !== 'ended' && callState !== 'error') {
        setState('ended');
        setStatus('Call ended. Thanks for speaking with Riley!');
        setTimeout(hideModal, 2200);
      }
    }, 1200);
  }

  function toggleMute() {
    if (!vapi) return;
    var isMuted = vapi.isMuted();
    vapi.setMuted(!isMuted);
    var btn = document.getElementById('riley-mute-btn');
    if (!btn) return;
    var willBeMuted = !isMuted;
    btn.dataset.muted = willBeMuted ? 'true' : 'false';
    btn.setAttribute('aria-label', willBeMuted ? 'Unmute microphone' : 'Mute microphone');
    var lbl = btn.querySelector('.riley-btn-label');
    if (lbl) lbl.textContent = willBeMuted ? 'Unmute' : 'Mute';
  }

  /* ── VAPI event handlers ── */
  function onCallStart() {
    setState('active');
    setStatus('Riley is listening…');
  }

  function onCallEnd() {
    setState('ended');
    setStatus('Call ended. Thanks for speaking with Riley!');
    resetWaveform();
    setTimeout(hideModal, 2200);
  }

  function onSpeechStart() {
    var av = document.getElementById('riley-avatar');
    if (av) av.dataset.speaking = 'true';
    setStatus('Riley is speaking…');
  }

  function onSpeechEnd() {
    var av = document.getElementById('riley-avatar');
    if (av) av.dataset.speaking = 'false';
    setStatus('Riley is listening…');
    resetWaveform();
  }

  /* Real amplitude from the live call — not decorative. VAPI emits a 0-1
     float periodically; spread it across bars with a fixed per-bar seed
     plus gentle phase-shifted jitter so they don't move in lockstep. */
  function onVolumeLevel(v) {
    if (REDUCE_MOTION) return;
    var bars = getWaveformBars();
    if (!bars.length) return;
    var t = performance.now() / 1000;
    bars.forEach(function (bar, i) {
      var seed   = WAVEFORM_SEEDS[i % WAVEFORM_SEEDS.length];
      var jitter = 0.75 + 0.25 * Math.sin(t * 6 + i * 1.3);
      var h = 4 + v * 40 * seed * jitter;
      bar.style.setProperty('--bar-h', Math.max(4, Math.min(44, h)).toFixed(1) + 'px');
    });
  }

  function onCallStartFailed(evt) {
    console.error('[Riley] call-start-failed:', evt);
    var stage = (evt && evt.stage) ? evt.stage : 'unknown';
    var msg   = (evt && evt.error) ? evt.error : '';
    if (typeof msg === 'string' && (msg.includes('permission') || msg.includes('denied') || msg.includes('microphone'))) {
      onError({ type: 'mic-denied' });
    } else {
      setState('error');
      setStatus("Couldn't connect to Riley — please try again in a moment.");
      console.warn('[Riley] failed at stage:', stage);
      setTimeout(hideModal, 5000);
    }
  }

  function onError(err) {
    console.error('[Riley]', err);
    var type   = (err && err.type) ? err.type : '';
    var rawMsg = (err && err.message) ? err.message
               : (err && err.error && err.error.message) ? err.error.message : '';
    var msg    = (typeof rawMsg === 'string') ? rawMsg.toLowerCase() : '';

    var display;
    if (type === 'mic-denied' || msg.includes('permission') || msg.includes('denied') || msg.includes('microphone')) {
      display = 'Microphone access denied — please allow it in your browser settings and try again.';
    } else if (msg.includes('support') || msg.includes('browser')) {
      display = "Your browser doesn't support voice calls. Please try Chrome or Safari.";
    } else {
      display = "Couldn't connect to Riley — please try again in a moment.";
    }

    setState('error');
    setStatus(display);
    setTimeout(hideModal, 5000);
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVapi);
  } else {
    initVapi();
  }

}());
