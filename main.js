/* ============================================================
   AXONCORE — Particle Network, Animations & Interactions
   ============================================================ */

(function () {
  'use strict';

  /* ── Particle Network Canvas ── */
  function initParticles() {
    const canvas = document.getElementById('ax-particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W, H, particles = [], mouse = { x: null, y: null };
    const PARTICLE_COUNT = window.innerWidth < 768 ? 22 : 45;
    const MAX_DIST = 140;
    const ACCENT = '167,139,250';

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function Particle() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.r  = Math.random() * 1.8 + 0.6;
      this.alpha = Math.random() * 0.5 + 0.3;
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
      ctx.fillStyle = '#080612';
      ctx.fillRect(0, 0, W, H);

      // Draw lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < MAX_DIST * MAX_DIST) {
            const dist = Math.sqrt(distSq);
            var mdx = mouse.x !== null ? particles[i].x - mouse.x : 9999;
            var mdy = mouse.x !== null ? particles[i].y - mouse.y : 0;
            var mouseDist = mouse.x !== null ? Math.sqrt(mdx * mdx + mdy * mdy) : 9999;
            var mouseBoost = mouseDist < 250 ? (1 - mouseDist / 250) * 0.45 : 0;
            var opacity = (1 - dist / MAX_DIST) * (0.45 + mouseBoost);
            var width = 0.6 + mouseBoost * 1.5;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${ACCENT},${opacity})`;
            ctx.lineWidth = width;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }

        // Mouse interaction — bright connecting lines to nearby particles
        if (mouse.x !== null) {
          const dx = particles[i].x - mouse.x;
          const dy = particles[i].y - mouse.y;
          const distSq2 = dx * dx + dy * dy;
          if (distSq2 < 220 * 220) {
            const dist = Math.sqrt(distSq2);
            const opacity = (1 - dist / 220) * 0.85;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${ACCENT},${opacity})`;
            ctx.lineWidth = 1.2;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }

        // Draw dot
        ctx.beginPath();
        ctx.arc(particles[i].x, particles[i].y, particles[i].r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ACCENT},${particles[i].alpha})`;
        ctx.fill();

        particles[i].update();
      }

      if (!document.hidden) requestAnimationFrame(draw);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) requestAnimationFrame(draw);
    });

    window.addEventListener('resize', function () { resize(); init(); });
    window.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseleave', function () { mouse.x = null; mouse.y = null; });

    resize();
    init();
    draw();
  }

  /* ── Scroll Reveal — 3D + Blur ── */
  function initScrollReveal() {
    const els = document.querySelectorAll('.ax-reveal');
    if (!els.length) return;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('ax-visible');
          observer.unobserve(entry.target);
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

  /* ── Boot ── */
  function boot() {
    initParticles();
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
