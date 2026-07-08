/* ============================================================
   AXONCORE — The Quiet Signal Graph, Animations & Interactions
   A dark, ambient node-graph rendered site-wide behind all content.
   Reads as "Riley quietly listening/connecting" — see DESIGN.md,
   Section 5, "The Quiet Signal Graph". Ambient nodes/lines stay in
   the ink/slate family; the brand's one violet accent appears only
   as a rare emphasis at the cursor's live connection point.
   ============================================================ */

(function () {
  'use strict';

  /* ── The Quiet Signal Graph (ambient node-graph canvas) ── */
  function initParticles() {
    const canvas = document.getElementById('ax-particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W, H, particles = [], mouse = { x: null, y: null };
    const PARTICLE_COUNT = window.innerWidth < 768 ? 22 : 45;
    const MAX_DIST = 140;
    const GRAPH = '148,163,184';   /* --ax-graph-line family — ambient, always */
    const SIGNAL = '167,139,250';  /* --ax-accent — rare emphasis at the cursor's live connection only */

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function Particle() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.vx = reduceMotion ? 0 : (Math.random() - 0.5) * 0.4;
      this.vy = reduceMotion ? 0 : (Math.random() - 0.5) * 0.4;
      this.r  = Math.random() * 1.8 + 0.6;
      this.alpha = Math.random() * 0.4 + 0.25;
    }

    Particle.prototype.update = function () {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W) this.vx *= -1;
      if (this.y < 0 || this.y > H) this.vy *= -1;
    };

    function init() {
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
    }

    function draw() {
      ctx.fillStyle = '#08080A';
      ctx.fillRect(0, 0, W, H);

      // Ambient connections between nearby nodes — stays in the graph-ink/slate family always
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < MAX_DIST * MAX_DIST) {
            const dist = Math.sqrt(distSq);
            const opacity = (1 - dist / MAX_DIST) * 0.35;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${GRAPH},${opacity})`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }

        // Rare emphasis — the live connection point at the cursor brightens to Signal Violet.
        // This is the one place the ambient graph and the brand accent mix (The One Voice Rule).
        if (mouse.x !== null) {
          const dx = particles[i].x - mouse.x;
          const dy = particles[i].y - mouse.y;
          const distSq2 = dx * dx + dy * dy;
          if (distSq2 < 220 * 220) {
            const dist = Math.sqrt(distSq2);
            const opacity = (1 - dist / 220) * 0.85;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${SIGNAL},${opacity})`;
            ctx.lineWidth = 1.2;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }

        // Node
        ctx.beginPath();
        ctx.arc(particles[i].x, particles[i].y, particles[i].r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${GRAPH},${particles[i].alpha})`;
        ctx.fill();

        particles[i].update();
      }

      if (!reduceMotion && !document.hidden) requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();

    if (reduceMotion) return; // static frame only — no animation loop, no cursor reactivity

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) requestAnimationFrame(draw);
    });

    window.addEventListener('resize', function () { resize(); init(); });
    window.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseleave', function () { mouse.x = null; mouse.y = null; });
  }

  /* ── Quiet Signal Graph — contained mini instance for the ROI-stat widget card ── */
  function initSignalWidget() {
    const canvas = document.getElementById('ax-signal-widget');
    if (!canvas) return;
    const wrap = canvas.closest('.ax-roi-stat__widget');
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GRAPH = '148,163,184';
    const NODE_COUNT = 14;
    const MAX_DIST = 90;
    let W, H, nodes = [], started = false;

    function resize() {
      const rect = wrap.getBoundingClientRect();
      W = canvas.width  = rect.width;
      H = canvas.height = rect.height;
    }

    function makeNodes() {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: reduceMotion ? 0 : (Math.random() - 0.5) * 0.2,
          vy: reduceMotion ? 0 : (Math.random() - 0.5) * 0.2,
          r: Math.random() * 1.4 + 0.5,
          a: Math.random() * 0.3 + 0.2
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${GRAPH},${(1 - dist / MAX_DIST) * 0.3})`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(nodes[i].x, nodes[i].y, nodes[i].r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${GRAPH},${nodes[i].a})`;
        ctx.fill();
        nodes[i].x += nodes[i].vx;
        nodes[i].y += nodes[i].vy;
        if (nodes[i].x < 0 || nodes[i].x > W) nodes[i].vx *= -1;
        if (nodes[i].y < 0 || nodes[i].y > H) nodes[i].vy *= -1;
      }
      if (!reduceMotion) requestAnimationFrame(draw);
    }

    // Only run once the widget is actually visible — it sits below the fold on load.
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !started) {
          started = true;
          resize();
          makeNodes();
          draw();
          window.addEventListener('resize', function () { resize(); makeNodes(); });
        }
      });
    }, { threshold: 0.2 });
    observer.observe(wrap);
  }

  /* ── Scroll Reveal — 3D + Blur, bidirectional ── */
  function initScrollReveal() {
    const els = document.querySelectorAll('.ax-reveal');
    if (!els.length) return;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('ax-visible');
          entry.target.classList.remove('ax-exit');
        } else if (entry.boundingClientRect.top < 0) {
          entry.target.classList.add('ax-exit');
          entry.target.classList.remove('ax-visible');
        } else {
          entry.target.classList.remove('ax-visible');
          entry.target.classList.remove('ax-exit');
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

    els.forEach(function (el) { observer.observe(el); });
  }

  /* ── Section Gradient Sweep ── */
  function initSectionSweep() {
    const sections = document.querySelectorAll('.ax-section');
    if (!sections.length) return;

    const sweepObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('ax-section-entered');
          sweepObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });

    sections.forEach(function (el) { sweepObserver.observe(el); });
  }

  /* ── Animated Counter ── */
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = prefix + target + suffix;
      return;
    }

    const duration = 1800;
    const start = performance.now();

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = prefix + (Number.isInteger(target) ? Math.round(value) : value.toFixed(1)) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCounters() {
    const counters = document.querySelectorAll('.ax-counter');
    if (!counters.length) return;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(function (el) { observer.observe(el); });
  }

  /* ── Sticky Header with Blur ── */
  function initStickyHeader() {
    const header = document.querySelector('.ax-header');
    if (!header) return;

    function onScroll() {
      header.classList.toggle('ax-header--scrolled', window.scrollY > 60);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── Card Tilt Effect (only after reveal animation completes) ── */
  function initCardTilt() {
    const cards = document.querySelectorAll('.ax-card');
    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        if (!card.classList.contains('ax-visible')) return;
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width  - 0.5;
        const y = (e.clientY - rect.top)  / rect.height - 0.5;
        card.style.transform = 'perspective(1000px) translateY(-8px) rotateX(' + (-y * 7) + 'deg) rotateY(' + (x * 7) + 'deg) scale(1.01)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ── Typed Text Effect in Hero ── */
  function initTyped() {
    const el = document.getElementById('ax-typed');
    if (!el) return;
    const words = ['Phone Calls', 'WhatsApp', 'Instagram', 'Your Website', 'Facebook'];
    let wordIndex = 0, charIndex = 0, deleting = false;

    function type() {
      const word = words[wordIndex];
      if (!deleting) {
        el.textContent = word.slice(0, ++charIndex);
        if (charIndex === word.length) {
          deleting = true;
          setTimeout(type, 1800);
          return;
        }
      } else {
        el.textContent = word.slice(0, --charIndex);
        if (charIndex === 0) {
          deleting = false;
          wordIndex = (wordIndex + 1) % words.length;
        }
      }
      setTimeout(type, deleting ? 55 : 85);
    }
    type();
  }

  /* ── Opening entrance cleanup — remove the overlay from the DOM once its
     animation finishes (or immediately for reduced-motion) so it costs
     nothing after the ~1.1s reveal. See index.html / style.css for the
     animation itself. ── */
  function initIntroCleanup() {
    var intro = document.getElementById('ax-intro');
    if (!intro) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      intro.remove();
      return;
    }
    var band = intro.querySelector('.ax-intro__band--top');
    if (!band) { intro.remove(); return; }
    band.addEventListener('animationend', function () { intro.remove(); }, { once: true });
    // Safety net in case the animationend listener is ever missed (e.g. tab
    // backgrounded mid-animation) — never leave the overlay sitting forever.
    setTimeout(function () { if (intro.parentNode) intro.remove(); }, 2000);
  }

  /* ── Boot ── */
  function boot() {
    initIntroCleanup();
    initParticles();
    initSignalWidget();
    initScrollReveal();
    initSectionSweep();
    initCounters();
    initStickyHeader();
    initCardTilt();
    initTyped();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ── Scroll Progress Bar ── */
(function() {
  var bar = document.createElement('div');
  bar.className = 'ax-progress-bar';
  document.body.appendChild(bar);
  window.addEventListener('scroll', function() {
    var scrolled = window.scrollY;
    var total = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + '%';
  }, { passive: true });
})();

/* ── Floating CTA Button ── */
(function() {
  var btn = document.createElement('div');
  btn.className = 'ax-float-cta';
  btn.innerHTML = '<a href="#ax-contact" class="ax-btn-primary ax-float-cta__btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg><span>Book a Free Call</span></a>';
  document.body.appendChild(btn);

  var hero = document.getElementById('ax-hero');
  var contact = document.getElementById('ax-contact');

  window.addEventListener('scroll', function() {
    var scrolled = window.scrollY;
    var heroH = hero ? hero.offsetHeight : 600;
    var contactTop = contact ? contact.getBoundingClientRect().top + scrolled - 200 : Infinity;
    var show = scrolled > heroH * 0.6 && scrolled < contactTop;
    btn.classList.toggle('ax-float-visible', show);
  }, { passive: true });
})();

/* ── Hero Orb Parallax ── */
(function() {
  var orbs = document.querySelectorAll('.ax-orb');
  if (!orbs.length) return;
  var speeds = [0.22, 0.38, 0.14];

  window.addEventListener('scroll', function() {
    var s = window.scrollY;
    if (s > window.innerHeight * 1.2) return;
    orbs.forEach(function(orb, i) {
      orb.style.transform = 'translateY(' + (s * speeds[i]) + 'px)';
    });
  }, { passive: true });
})();

/* ── Extended Card Tilt — pricing + steps ── */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var selectors = '.ax-pricing__card, .ax-step, .ax-testimonial__card, .ax-service-card';
    document.querySelectorAll(selectors).forEach(function(card) {
      card.addEventListener('mousemove', function(e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width  - 0.5;
        var y = (e.clientY - rect.top)  / rect.height - 0.5;
        var tilt = card.classList.contains('ax-pricing__card--popular') ? 5 : 7;
        card.style.transform = 'perspective(900px) translateY(-6px) rotateX(' + (-y * tilt) + 'deg) rotateY(' + (x * tilt) + 'deg)';
        card.style.transition = 'none';
      });
      card.addEventListener('mouseleave', function() {
        card.style.transform = '';
        card.style.transition = '';
      });
    });
  });
})();

/* ── Magnetic Button Effect ── */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.ax-btn-primary, .ax-btn-ghost').forEach(function(btn) {
      btn.addEventListener('mousemove', function(e) {
        var rect = btn.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top  + rect.height / 2;
        var dx = (e.clientX - cx) * 0.25;
        var dy = (e.clientY - cy) * 0.25;
        btn.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) translateY(-2px)';
      });
      btn.addEventListener('mouseleave', function() {
        btn.style.transform = '';
      });
    });
  });
})();

/* ── Hero Content Fade on Scroll ── */
(function() {
  var hero = document.querySelector('.ax-hero__content');
  if (!hero) return;
  var heroH = document.querySelector('.ax-hero') ? document.querySelector('.ax-hero').offsetHeight : 700;

  window.addEventListener('scroll', function() {
    var s = window.scrollY;
    var ratio = Math.min(s / (heroH * 0.55), 1);
    hero.style.opacity = 1 - ratio * 0.5;
    hero.style.transform = 'translateY(' + (s * 0.12) + 'px)';
  }, { passive: true });
})();

/* ── Pricing Card — Full Details Toggle ── */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.ax-pricing__toggle').forEach(function(btn) {
      var details = btn.nextElementSibling;
      if (!details || !details.classList.contains('ax-pricing__details')) return;
      var label = btn.querySelector('.ax-pricing__toggle-text');
      var openText = 'Hide package details';
      var closedText = label ? label.textContent : 'See full package details';

      btn.addEventListener('click', function() {
        var open = btn.classList.toggle('ax-pricing__toggle--open');
        details.classList.toggle('ax-pricing__details--open', open);
        // Real content height, not a guessed fixed value -- a fixed
        // max-height (previously 900px in CSS) silently clips whichever
        // package's content happens to run longer than that guess at a
        // given viewport width, with no visible error. Recomputed on
        // every open so it's always correct for however long the content
        // actually is, at whatever width the browser happens to be.
        details.style.maxHeight = open ? details.scrollHeight + 'px' : '';
        btn.setAttribute('aria-expanded', open);
        if (label) label.textContent = open ? openText : closedText;
      });
    });

    // If the window is resized while a panel is open (rotation, DevTools
    // docking, manual resize), text reflows and the panel's real height
    // changes -- recompute so it can't silently clip again.
    var resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        document.querySelectorAll('.ax-pricing__details--open').forEach(function(d) {
          d.style.maxHeight = d.scrollHeight + 'px';
        });
      }, 150);
    });
  });
})();
