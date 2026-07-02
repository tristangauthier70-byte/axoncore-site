/**
 * riley-orb.js
 * ─────────────────────────────────────────────────────────────────────────
 * Audio-reactive "voice orb" WebGL visualization for Riley (Axon Core AI).
 * A wireframe geodesic sphere with organic, noise-driven vertex displacement,
 * a denser dotted sphere nested inside, a soft additive glow, and occasional
 * expanding "ripple" rings — all rendered on a fully transparent canvas so it
 * composites cleanly onto a dark host page. No bundler, no build step.
 *
 * ── PUBLIC API (attached to window.RileyOrb) ──────────────────────────────
 *
 *   window.RileyOrb.init(canvasEl) -> boolean
 *     Starts the scene on the given <canvas>. Returns true if WebGL is
 *     available and the scene started, false otherwise (caller should show
 *     a fallback, e.g. a static glow/icon). Safe to call again later — any
 *     previous instance is torn down automatically first.
 *
 *   window.RileyOrb.setVolume(v)
 *     v is a float 0.0–1.0. Call this frequently (~10–20x/sec) while a call
 *     is live. Drives displacement amplitude, glow brightness/scale, and a
 *     subtle whole-orb scale pulse. Internally smoothed (lerped) each frame
 *     so rapid/choppy input still reads as fluid motion, not laggy or jittery.
 *
 *   window.RileyOrb.setActive(isActive)
 *     boolean. true while a call is connecting/active: rotation speeds up
 *     and ripple rings begin spawning periodically (and on volume spikes).
 *     false when idle: slow ambient motion only, no rings. When active but
 *     volume is ~0 (Riley is listening, caller is silent), motion falls back
 *     to a gently elevated idle-like state rather than freezing.
 *
 *   window.RileyOrb.destroy()
 *     Stops the render loop, removes listeners, and disposes all Three.js
 *     geometries/materials/textures. Call this whenever the orb is removed
 *     from the page (e.g. SPA navigation) to avoid leaking GPU resources.
 *
 * ── HOST PAGE REQUIREMENTS ─────────────────────────────────────────────────
 * Add this import map to the page <head> (before this module is imported),
 * and load this file with <script type="module" src="./riley-orb.js"></script>
 * (or import it from another module). No other build tooling is required.
 *
 *   <script type="importmap">
 *   {
 *     "imports": {
 *       "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"
 *     }
 *   }
 *   </script>
 *
 * Only the bare "three" specifier is needed — see the glow/bloom note below
 * for why no postprocessing addon import is required.
 *
 * ── WIRING REAL AUDIO INTO setVolume() ─────────────────────────────────────
 * Typical setup with the Web Audio API against a live <audio>/<video> element
 * or a WebRTC/VAPI remote audio stream:
 *
 *   const audioCtx = new AudioContext();
 *   const source = audioCtx.createMediaStreamSource(remoteStream); // or createMediaElementSource
 *   const analyser = audioCtx.createAnalyser();
 *   analyser.fftSize = 256;
 *   source.connect(analyser);
 *   const data = new Uint8Array(analyser.frequencyBinCount);
 *
 *   function tick() {
 *     analyser.getByteFrequencyData(data);
 *     let sum = 0;
 *     for (let i = 0; i < data.length; i++) sum += data[i];
 *     const rms = sum / data.length / 255; // normalize to 0-1
 *     window.RileyOrb.setVolume(Math.min(1, rms * 1.6)); // small gain boost feels better
 *     requestAnimationFrame(tick);
 *   }
 *   tick();
 *
 * If using VAPI's client SDK, its "volume-level" event already emits a
 * 0-1 float — just forward it directly: vapi.on('volume-level', (v) => window.RileyOrb.setVolume(v));
 *
 * ── GLOW/BLOOM TECHNIQUE (documented per spec) ─────────────────────────────
 * This implementation uses the ADDITIVE-SPRITE fallback glow, not
 * EffectComposer/UnrealBloomPass. Reason: UnrealBloomPass's composite shader
 * writes into a full-screen render target sized to the renderer, and in
 * practice reliably fights with alpha:true transparent canvases — glow
 * bleeds into background pixels that would otherwise carry alpha 0, and the
 * multi-pass blur/composite chain routinely ends up flattening or discarding
 * the destination alpha channel, producing an opaque or incorrectly-matted
 * background when composited over the host page. That is untestable here
 * (no dev server/browser available in this task), so it's a real risk not
 * worth taking. Two soft-edged radial-gradient sprites (a bright core +
 * a wider soft halo), rendered with THREE.AdditiveBlending in the normal
 * forward pass, achieve a convincing glow while keeping per-pixel alpha
 * correct (additive blending's alpha accumulates from the sprite's own
 * gradient alpha, so empty background pixels stay fully transparent and
 * glow pixels naturally gain partial alpha). It's also cheaper — no extra
 * render targets/passes — which helps hold 60fps alongside the per-vertex
 * noise displacement.
 *
 * ── NOISE TECHNIQUE ─────────────────────────────────────────────────────
 * A compact classic 3D Simplex noise (Gustavson-style permutation lattice,
 * ported inline — no extra CDN dependency) drives per-vertex radial
 * displacement: each vertex is pushed in/out along its own normalized
 * direction from the sphere's center (valid since both spheres are
 * centered at the origin) by noise(baseVertexPosition * frequency + time).
 * Base (undisplaced) positions and per-vertex direction vectors are
 * precomputed once at geometry creation, so per-frame cost is just one
 * noise sample + a lerp per vertex — no normal recomputation is needed
 * since all materials here are unlit (MeshBasicMaterial/PointsMaterial).
 *
 * ── RING IMPLEMENTATION ─────────────────────────────────────────────────
 * Each ripple is a THREE.TorusGeometry lying in the XY plane (facing the
 * camera by default, since the camera looks down -Z), given a small random
 * tilt for organic variety. On spawn it's added to a pool with a start
 * timestamp; every frame each pooled ring's scale grows and opacity fades
 * over ~1.5s (eased), and once its lifetime elapses its geometry/material
 * are disposed and it's removed from the scene and the pool — no leaks.
 * Rings spawn periodically (every ~1.5-3s while active) and additionally on
 * volume spikes (with a short cooldown so spikes can't spam rings).
 */

import * as THREE from 'three';

// ───────────────────────────────────────────────────────────────────────
// Exact palette — do not introduce any other hues. Glow textures are pure
// white-to-transparent gradients; their visible color comes entirely from
// each material's `color`, which is always one of these three values.
// ───────────────────────────────────────────────────────────────────────
const COLOR_PRIMARY = 0xA78BFA; // outer wireframe stroke
const COLOR_ACCENT = 0x8B7CF6; // rings + inner sphere + glow tint
const COLOR_AMBIENT = 0x1E2433; // fog / ambient tint only

// ───────────────────────────────────────────────────────────────────────
// Compact inline 3D Simplex noise (classic Gustavson-style permutation
// lattice implementation, deterministically seeded so results are stable
// across reloads). Public-domain algorithm; this is an original port.
// ───────────────────────────────────────────────────────────────────────
class SimplexNoise3D {
  constructor(seed = 1337) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }

    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise3D(x, y, z) {
    const grad3 = SimplexNoise3D.GRAD3;
    const perm = this.perm;
    const permMod12 = this.permMod12;
    const F3 = 1.0 / 3.0;
    const G3 = 1.0 / 6.0;

    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = x - X0, y0 = y - Y0, z0 = z - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
  }
}
SimplexNoise3D.GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

// ───────────────────────────────────────────────────────────────────────
// Small helper: builds a soft radial-gradient CanvasTexture (white center
// fading to transparent). Used only as an alpha mask for glow sprites —
// actual color comes from SpriteMaterial.color, so no new hues appear.
// ───────────────────────────────────────────────────────────────────────
function createGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Precompute base (undisplaced) positions + per-vertex outward direction
// for a geometry centered at the origin (direction == normalized position).
function precomputeDisplacementData(geometry) {
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const base = new Float32Array(posAttr.array); // clone
  const dirs = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    const x = base[ix], y = base[ix + 1], z = base[ix + 2];
    const len = Math.hypot(x, y, z) || 1;
    dirs[ix] = x / len;
    dirs[ix + 1] = y / len;
    dirs[ix + 2] = z / len;
  }
  return { base, dirs };
}

function applyDisplacement(geometry, data, amplitude, noiseTime, noise, frequency) {
  const posAttr = geometry.attributes.position;
  const arr = posAttr.array;
  const { base, dirs } = data;
  for (let i = 0; i < posAttr.count; i++) {
    const ix = i * 3;
    const bx = base[ix], by = base[ix + 1], bz = base[ix + 2];
    const n = noise.noise3D(
      bx * frequency + noiseTime,
      by * frequency + noiseTime,
      bz * frequency - noiseTime
    );
    arr[ix] = bx + dirs[ix] * n * amplitude;
    arr[ix + 1] = by + dirs[ix + 1] * n * amplitude;
    arr[ix + 2] = bz + dirs[ix + 2] * n * amplitude;
  }
  posAttr.needsUpdate = true;
}

// ───────────────────────────────────────────────────────────────────────
// Single module-level instance holder. init() tears down any previous
// instance first, so repeated init()/destroy() cycles (SPA navigation)
// never leak resources even if a caller forgets to call destroy().
// ───────────────────────────────────────────────────────────────────────
let instance = null;

function buildScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  // alpha:true alone does NOT make clears transparent — the renderer's
  // default clear alpha is 1 (opaque). Explicitly zero it so every frame
  // clears to full transparency and the page shows through.
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const width = canvas.clientWidth || window.innerWidth || 300;
  const height = canvas.clientHeight || window.innerHeight || 300;
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(COLOR_AMBIENT, 5.5, 11);

  const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 100);
  camera.position.set(0, 0, 6);

  // ── Outer wireframe icosahedron (organic, lumpy displacement) ──
  const outerGeo = new THREE.IcosahedronGeometry(1.6, 4); // moderate polycount (~2562 verts)
  const outerMat = new THREE.MeshBasicMaterial({
    color: COLOR_PRIMARY,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.frustumCulled = false; // displacement is small; avoid per-frame bounding recompute
  const outerData = precomputeDisplacementData(outerGeo);

  // ── Inner denser dotted sphere ──
  const innerGeo = new THREE.IcosahedronGeometry(0.72, 3); // denser relative to its size (~642 pts)
  const innerMat = new THREE.PointsMaterial({
    color: COLOR_ACCENT,
    size: 0.032,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  });
  const innerPoints = new THREE.Points(innerGeo, innerMat);
  innerPoints.frustumCulled = false;
  const innerData = precomputeDisplacementData(innerGeo);

  const orbGroup = new THREE.Group();
  orbGroup.add(outerMesh, innerPoints);
  scene.add(orbGroup);

  // ── Additive glow sprites (bright core + soft wide halo) ──
  const glowTexture = createGlowTexture();
  const glowCoreMat = new THREE.SpriteMaterial({
    map: glowTexture,
    color: COLOR_ACCENT,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const glowHaloMat = new THREE.SpriteMaterial({
    map: glowTexture,
    color: COLOR_PRIMARY,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const glowCore = new THREE.Sprite(glowCoreMat);
  const glowHalo = new THREE.Sprite(glowHaloMat);
  glowCore.scale.set(3.0, 3.0, 1);
  glowHalo.scale.set(5.2, 5.2, 1);
  scene.add(glowHalo, glowCore); // halo first so core layers visually on top

  // ── Ring ripple pool ──
  const ringsGroup = new THREE.Group();
  scene.add(ringsGroup);
  const ringPool = []; // { mesh, geometry, material, start, duration }
  const RING_DURATION = 1.5;

  return {
    canvas,
    renderer,
    scene,
    camera,
    orbGroup,
    outerMesh,
    outerGeo,
    outerMat,
    outerData,
    innerPoints,
    innerGeo,
    innerMat,
    innerData,
    glowTexture,
    glowCore,
    glowCoreMat,
    glowHalo,
    glowHaloMat,
    ringsGroup,
    ringPool,
    RING_DURATION,
  };
}

function spawnRing(ctx) {
  const geometry = new THREE.TorusGeometry(1.75, 0.014, 10, 72);
  const material = new THREE.MeshBasicMaterial({
    color: COLOR_ACCENT,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Slight random tilt so successive rings don't look mechanically identical.
  mesh.rotation.x = (Math.random() - 0.5) * 0.4;
  mesh.rotation.y = (Math.random() - 0.5) * 0.4;
  ctx.ringsGroup.add(mesh);
  ctx.ringPool.push({
    mesh,
    geometry,
    material,
    start: ctx.clockElapsed,
    duration: ctx.RING_DURATION,
  });
}

function disposeRing(ctx, ring) {
  ctx.ringsGroup.remove(ring.mesh);
  ring.geometry.dispose();
  ring.material.dispose();
}

function updateRings(ctx) {
  for (let i = ctx.ringPool.length - 1; i >= 0; i--) {
    const ring = ctx.ringPool[i];
    const t = (ctx.clockElapsed - ring.start) / ring.duration;
    if (t >= 1) {
      disposeRing(ctx, ring);
      ctx.ringPool.splice(i, 1);
      continue;
    }
    const eased = 1 - Math.pow(1 - t, 2); // ease-out
    const scale = 1 + eased * 1.9;
    ring.mesh.scale.setScalar(scale);
    ring.material.opacity = 0.55 * (1 - t);
  }
}

function randRingInterval() {
  return 1.5 + Math.random() * 1.5; // 1.5s - 3s
}

// ── Static single-frame render used for reduced-motion mode ──
function renderStaticFrame(ctx) {
  const idleAmplitude = ctx.active ? 0.085 : 0.05;
  const noiseTime = 0.73; // fixed, pleasant snapshot — never advances
  applyDisplacement(ctx.outerGeo, ctx.outerData, idleAmplitude, noiseTime, ctx.noise, 0.9);
  applyDisplacement(ctx.innerGeo, ctx.innerData, idleAmplitude * 0.6, noiseTime + 4.1, ctx.noise, 1.1);

  const glowScale = 3.0 * (1 + ctx.displayVolume * 0.5);
  ctx.glowCore.scale.set(glowScale, glowScale, 1);
  ctx.glowHalo.scale.set(glowScale * 1.7, glowScale * 1.7, 1);
  ctx.glowCoreMat.opacity = 0.5 + ctx.displayVolume * 0.35;
  ctx.glowHaloMat.opacity = 0.26 + ctx.displayVolume * 0.2;

  ctx.renderer.render(ctx.scene, ctx.camera);
}

function animate(ctx) {
  ctx.rafId = requestAnimationFrame(() => animate(ctx));

  const delta = Math.min(ctx.clock.getDelta(), 0.1); // clamp to avoid huge jumps on tab-switch
  ctx.clockElapsed += delta;

  // Smooth (lerp) the live volume so raw setVolume() calls (10-20x/sec)
  // read as fluid, not stepped/laggy.
  const smoothing = 1 - Math.exp(-delta * 10);
  ctx.displayVolume += (ctx.targetVolume - ctx.displayVolume) * smoothing;

  const active = ctx.active;
  const v = ctx.displayVolume;

  // ── Displacement amplitude & noise speed ──
  const idleAmplitude = 0.05;
  const activeBaseAmplitude = 0.09; // elevated-but-calm motion during active silence
  const amplitude = active ? activeBaseAmplitude + v * 0.55 : idleAmplitude;

  const idleNoiseSpeed = 0.15;
  const activeNoiseSpeed = 0.28 + v * 0.7;
  const noiseSpeed = active ? activeNoiseSpeed : idleNoiseSpeed;
  ctx.noiseTime += delta * noiseSpeed;

  applyDisplacement(ctx.outerGeo, ctx.outerData, amplitude, ctx.noiseTime, ctx.noise, 0.9);
  applyDisplacement(ctx.innerGeo, ctx.innerData, amplitude * 0.6, ctx.noiseTime * 1.15 + 4.1, ctx.noise, 1.1);

  // ── Rotation (auto, faster while active) ──
  const rotSpeed = active ? 0.16 : 0.045;
  ctx.orbGroup.rotation.y += rotSpeed * delta;
  ctx.orbGroup.rotation.x = Math.sin(ctx.clockElapsed * (active ? 0.22 : 0.12)) * (active ? 0.09 : 0.05);

  // ── Whole-orb subtle scale pulse tied to volume ──
  const targetGroupScale = active ? 1 + v * 0.08 : 1 + Math.sin(ctx.clockElapsed * 0.35) * 0.012;
  ctx.orbGroup.scale.setScalar(
    ctx.orbGroup.scale.x + (targetGroupScale - ctx.orbGroup.scale.x) * Math.min(1, delta * 6)
  );

  // ── Glow brightness/scale ──
  const glowBase = active ? 1 + v * 0.55 : 1 + Math.sin(ctx.clockElapsed * 0.35) * 0.03;
  const coreScale = 3.0 * glowBase;
  ctx.glowCore.scale.set(coreScale, coreScale, 1);
  ctx.glowHalo.scale.set(coreScale * 1.73, coreScale * 1.73, 1);
  ctx.glowCoreMat.opacity = active ? 0.5 + v * 0.4 : 0.42 + Math.sin(ctx.clockElapsed * 0.35) * 0.04;
  ctx.glowHaloMat.opacity = active ? 0.24 + v * 0.22 : 0.22 + Math.sin(ctx.clockElapsed * 0.35) * 0.03;

  // ── Ring spawning (active only) ──
  if (active) {
    if (ctx.clockElapsed >= ctx.nextRingAt) {
      spawnRing(ctx);
      ctx.nextRingAt = ctx.clockElapsed + randRingInterval();
      ctx.lastRingSpawn = ctx.clockElapsed;
    } else if (
      v - ctx.prevVolume > 0.32 &&
      ctx.clockElapsed - ctx.lastRingSpawn > 0.4
    ) {
      spawnRing(ctx);
      ctx.lastRingSpawn = ctx.clockElapsed;
      ctx.nextRingAt = ctx.clockElapsed + randRingInterval();
    }
  }
  ctx.prevVolume = v;

  updateRings(ctx);

  ctx.renderer.render(ctx.scene, ctx.camera);
}

function handleResize(ctx) {
  const width = ctx.canvas.clientWidth || window.innerWidth || 300;
  const height = ctx.canvas.clientHeight || window.innerHeight || 300;
  ctx.renderer.setSize(width, height, false);
  ctx.camera.aspect = width / Math.max(height, 1);
  ctx.camera.updateProjectionMatrix();
  if (ctx.reducedMotion) renderStaticFrame(ctx);
}

function disposeAll(ctx) {
  cancelAnimationFrame(ctx.rafId);
  window.removeEventListener('resize', ctx.resizeListener);

  for (const ring of ctx.ringPool) disposeRing(ctx, ring);
  ctx.ringPool.length = 0;

  ctx.outerGeo.dispose();
  ctx.outerMat.dispose();
  ctx.innerGeo.dispose();
  ctx.innerMat.dispose();
  ctx.glowTexture.dispose();
  ctx.glowCoreMat.dispose();
  ctx.glowHaloMat.dispose();

  ctx.scene.clear();
  ctx.renderer.dispose();
}

const RileyOrb = {
  init(canvasEl) {
    try {
      if (!canvasEl) return false;

      // Tear down any previous instance defensively — this component gets
      // created/destroyed repeatedly as users navigate.
      if (instance) {
        try { RileyOrb.destroy(); } catch (_e) { /* ignore */ }
      }

      const reducedMotion = !!(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );

      const built = buildScene(canvasEl);
      if (!built.renderer.getContext()) return false;

      const ctx = {
        ...built,
        noise: new SimplexNoise3D(1337),
        clock: new THREE.Clock(),
        clockElapsed: 0,
        noiseTime: 0,
        active: false,
        reducedMotion,
        targetVolume: 0,
        displayVolume: 0,
        prevVolume: 0,
        nextRingAt: Infinity,
        lastRingSpawn: 0,
        rafId: null,
        resizeListener: null,
      };
      ctx.resizeListener = () => handleResize(ctx);
      window.addEventListener('resize', ctx.resizeListener);

      instance = ctx;

      if (reducedMotion) {
        // One static, pleasant frame. No rAF loop — updates happen only on
        // explicit setVolume/setActive calls, each re-rendering once.
        renderStaticFrame(ctx);
      } else {
        ctx.clock.start();
        animate(ctx);
      }

      return true;
    } catch (err) {
      console.warn('[RileyOrb] init failed, WebGL unavailable:', err);
      return false;
    }
  },

  setVolume(v) {
    if (!instance) return;
    const clamped = Math.max(0, Math.min(1, typeof v === 'number' ? v : 0));
    instance.targetVolume = clamped;
    if (instance.reducedMotion) {
      // Discrete, immediate adjustment — no tweening/animation loop.
      instance.displayVolume = clamped;
      renderStaticFrame(instance);
    }
  },

  setActive(isActive) {
    if (!instance) return;
    const active = !!isActive;
    const wasActive = instance.active;
    instance.active = active;

    if (active && !wasActive) {
      instance.nextRingAt = instance.clockElapsed + randRingInterval();
    }
    if (!active) {
      instance.nextRingAt = Infinity;
    }

    if (instance.reducedMotion) {
      renderStaticFrame(instance);
    }
  },

  destroy() {
    if (!instance) return;
    disposeAll(instance);
    instance = null;
  },
};

window.RileyOrb = RileyOrb;
export default RileyOrb;
