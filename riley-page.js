/* riley-page.js — animations for riley.html */
(function () {
  'use strict';

  /* ── Guards ─────────────────────────────────────────────────── */
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE  = window.innerWidth < 768;
  var TOUCH   = 'ontouchstart' in window;
  var ANIM    = !REDUCED;

  /* ── Conversation data ──────────────────────────────────────── */
  var CONV = [
    { speaker: 'caller', text: "Hi, I'm looking to book a facial — do you have availability this week?",             at: 0.05 },
    { speaker: 'riley',  text: "Hi there! You've reached Lumina Aesthetics, I'm Riley. I'd love to help — could I start with your name?", at: 0.20 },
    { speaker: 'caller', text: "It's Sarah.",                                                                         at: 0.35 },
    { speaker: 'riley',  text: "Lovely to meet you, Sarah! And the best number to reach you on?",                    at: 0.50 },
    { speaker: 'caller', text: "9123 4567",                                                                           at: 0.62 },
    { speaker: 'riley',  text: "Perfect! I've got you in for a facial consultation this week. You'll receive a text confirmation shortly — anything else I can help with?", at: 0.75 },
    { speaker: 'caller', text: "No, that's all. Thanks!",                                                             at: 0.86 },
    { speaker: 'riley',  text: "My pleasure, Sarah! Have a wonderful day. Goodbye!",                                  at: 0.92 }
  ];

  /* Label reveal thresholds */
  var LABELS_AT = [0.15, 0.45, 0.72];

  /* ── Lenis smooth scroll ────────────────────────────────────── */
  function initLenis() {
    if (TOUCH || MOBILE || !window.Lenis) return;
    var lenis = new window.Lenis({ lerp: 0.08, smoothWheel: true });
    function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    if (window.ScrollTrigger) {
      lenis.on('scroll', window.ScrollTrigger.update);
      window.gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      window.gsap.ticker.lagSmoothing(0);
    }
  }

  /* ── Custom cursor (same as main site) ─────────────────────── */
  function initCursor() {
    var dot  = document.getElementById('ax-cursor-dot');
    var ring = document.getElementById('ax-cursor-ring');
    if (!dot || !ring || TOUCH) return;
    var mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; dot.style.transform = 'translate(' + (mx-4) + 'px,' + (my-4) + 'px)'; });
    (function lerp() {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
      ring.style.transform = 'translate(' + (rx-20) + 'px,' + (ry-20) + 'px)';
      requestAnimationFrame(lerp);
    })();
    document.querySelectorAll('a, button, .rp-cap-card').forEach(function (el) {
      el.addEventListener('mouseenter', function () { ring.classList.add('ax-cursor-ring--hover'); });
      el.addEventListener('mouseleave', function () { ring.classList.remove('ax-cursor-ring--hover'); });
    });
  }

  /* ── Build phone conversation DOM ───────────────────────────── */
  function buildConversation() {
    var container = document.getElementById('rp-scroll-messages');
    if (!container) return;
    CONV.forEach(function (msg, i) {
      var div = document.createElement('div');
      div.className = 'rp-bubble rp-bubble--' + msg.speaker;
      div.setAttribute('data-idx', i);
      div.textContent = msg.text;
      container.appendChild(div);
    });
  }

  /* ── Sticky header scroll ───────────────────────────────────── */
  function initHeader() {
    var hdr = document.querySelector('.rp-header');
    if (!hdr) return;
    window.addEventListener('scroll', function () {
      hdr.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });
  }

  /* ── WebGL light rays (CTA section) ─────────────────────────── */
  function initLightRays() {
    var wrap = document.querySelector('.rp-cta__rays[data-light-rays]');
    if (!wrap || REDUCED) return;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    wrap.appendChild(canvas);
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    var vSrc = 'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}';
    var fSrc = [
      'precision mediump float;',
      'uniform vec2 u_res;',
      'uniform float u_t;',
      'uniform vec2 u_origin;',
      'void main(){',
      '  vec2 uv=(gl_FragCoord.xy-u_res*u_origin)/u_res.y;',
      '  float a=atan(uv.y,uv.x);',
      '  float r=length(uv);',
      '  float ray=0.0;',
      '  for(int i=0;i<6;i++){',
      '    float ph=float(i)*1.047+u_t*0.18;',
      '    float w=0.08+0.04*sin(float(i)+u_t*0.4);',
      '    ray+=max(0.0,1.0-abs(mod(a-ph+3.14159,6.28318)-3.14159)/w)*0.45;',
      '  }',
      '  float att=1.0-clamp(r/1.2,0.0,1.0);',
      '  gl_FragColor=vec4(0.49,0.23,0.93,ray*att*0.55);',
      '}'
    ].join('\n');

    function mkShader(t, s) { var sh = gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh); return sh; }
    var prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, vSrc));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, fSrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    var aLoc = gl.getAttribLocation(prog,'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog,'u_res');
    var uT   = gl.getUniformLocation(prog,'u_t');
    var uOrg = gl.getUniformLocation(prog,'u_origin');

    function resize() {
      canvas.width  = wrap.offsetWidth;
      canvas.height = wrap.offsetHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    var start = performance.now();
    var mx = 0.5, my = 0.55;
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX / window.innerWidth;
      my = 1 - (e.clientY / window.innerHeight);
    });

    function draw() {
      var t = (performance.now() - start) * 0.001;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, t);
      gl.uniform2f(uOrg, 0.5 + (mx-0.5)*0.06, 0.58 + (my-0.5)*0.06);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ── Pinned iPhone conversation (ScrollTrigger) ──────────────── */
  function initPhoneConversation() {
    var section   = document.getElementById('rp-demo');
    var bubbles   = document.querySelectorAll('#rp-scroll-messages .rp-bubble');
    var labels    = document.querySelectorAll('.rp-label');
    var confirm   = document.querySelector('.rp-phone__confirm');
    var progressF = document.querySelector('.rp-demo__progress-fill');

    if (!section || !window.gsap || !window.ScrollTrigger) return;

    var shown     = new Array(CONV.length).fill(false);
    var lblShown  = new Array(labels.length).fill(false);
    var confShown = false;

    function onUpdate(prog) {
      if (progressF) progressF.style.height = (prog * 100) + '%';
      CONV.forEach(function (msg, i) {
        if (!shown[i] && prog >= msg.at) {
          shown[i] = true;
          if (bubbles[i]) bubbles[i].classList.add('visible');
          var mc = document.getElementById('rp-scroll-messages');
          if (mc) mc.scrollTop = mc.scrollHeight;
        }
      });
      LABELS_AT.forEach(function (threshold, i) {
        if (!lblShown[i] && prog >= threshold) {
          lblShown[i] = true;
          if (labels[i]) labels[i].classList.add('visible');
        }
      });
      if (!confShown && prog >= 0.97) {
        confShown = true;
        if (confirm) confirm.classList.add('visible');
        launchConfetti();
      }
    }

    window.ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom+=' + (window.innerHeight * 2.5) + 'px top',
      pin: true,
      pinSpacing: true,
      scrub: true,   /* true = instant sync, smoother than 0.5 spring */
      onUpdate: function (self) { onUpdate(self.progress); }
    });
  }

  /* ── Confetti burst ──────────────────────────────────────────── */
  function launchConfetti() {
    var phone = document.querySelector('.rp-phone');
    if (!phone) return;
    var colors = ['#7c3aed','#a78bfa','#4ade80','#fbbf24','#f472b6'];
    for (var i = 0; i < 24; i++) {
      (function (i) {
        setTimeout(function () {
          var el = document.createElement('div');
          el.className = 'rp-confetti';
          el.style.cssText = [
            'left:' + (20 + Math.random()*60) + '%',
            'top:' + (20 + Math.random()*40) + '%',
            'background:' + colors[i % colors.length],
            'width:' + (5+Math.random()*5) + 'px',
            'height:' + (5+Math.random()*5) + 'px',
            'animation-duration:' + (0.6+Math.random()*0.6) + 's',
            'animation-delay:' + (Math.random()*0.3) + 's'
          ].join(';');
          phone.appendChild(el);
          setTimeout(function () { el.remove(); }, 1200);
        }, i * 40);
      })(i);
    }
  }

  /* ── Capability cards GSAP entrance ─────────────────────────── */
  function initCaps() {
    if (!window.gsap || !window.ScrollTrigger || REDUCED) return;
    window.gsap.from('.rp-cap-card', {
      y: 50, opacity: 0, rotateX: 10,
      stagger: 0.12, duration: 0.8, ease: 'back.out(1.4)',
      scrollTrigger: { trigger: '.rp-caps__grid', start: 'top 80%' }
    });
  }

  /* ── Stats counter sweep ─────────────────────────────────────── */
  function initStats() {
    if (!window.gsap || !window.ScrollTrigger) return;
    window.gsap.from('.rp-stat__num', {
      opacity: 0, y: 30, stagger: 0.1, duration: 0.7, ease: 'power3.out',
      scrollTrigger: { trigger: '.rp-stats', start: 'top 80%' }
    });
  }

  /* ── CTA headline char reveal ────────────────────────────────── */
  function initCTAReveal() {
    if (!window.gsap || !window.ScrollTrigger) return;
    var h = document.querySelector('.rp-cta__headline');
    if (!h || !window.Splitting) return;
    window.Splitting({ target: h, by: 'chars' });
    window.gsap.from(h.querySelectorAll('.char'), {
      opacity: 0, y: 20, filter: 'blur(6px)',
      stagger: 0.025, duration: 0.6, ease: 'power3.out',
      scrollTrigger: { trigger: h, start: 'top 85%' }
    });
  }

  /* ── Hero entrance ───────────────────────────────────────────── */
  function initHero() {
    if (!window.gsap || REDUCED) return;
    var tl = window.gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.rp-hero__eyebrow', { opacity: 0, y: 20, duration: 0.6 }, 0.1)
      .from('.rp-hero__headline', { opacity: 0, y: 40, duration: 0.9 }, 0.25)
      .from('.rp-hero__sub',      { opacity: 0, y: 20, duration: 0.6 }, 0.5)
      .from('.rp-hero__chip',     { opacity: 0, y: 12, stagger: 0.08, duration: 0.5 }, 0.65)
      .from('.rp-wave-bar',       { scaleY: 0, stagger: 0.04, duration: 0.5, transformOrigin: 'bottom' }, 0.4);
  }

  /* ── General data-gsap-from reveals ─────────────────────────── */
  function initReveal() {
    if (!window.gsap || !window.ScrollTrigger || REDUCED) return;
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      window.gsap.from(el, {
        opacity: 0, y: 32, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 85%' }
      });
    });
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  function init() {
    if (window.gsap && window.ScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);
    }
    buildConversation();
    initLenis();
    initCursor();
    initHeader();
    initHero();
    initCaps();
    initPhoneConversation();
    initStats();
    initCTAReveal();
    initLightRays();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
