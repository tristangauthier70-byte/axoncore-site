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
 * render targets/passes.
 *
 * ── NOISE + DISPLACEMENT TECHNIQUE (GPU vertex shader) ─────────────────────
 * Displacement used to be computed on the CPU: a hand-rolled JS Simplex
 * noise sampled once per vertex per frame (~3200 verts total across both
 * spheres), then written back into the position BufferAttribute and
 * re-uploaded to the GPU every frame. That is a textbook main-thread
 * bottleneck — thousands of scalar noise evaluations in a single JS loop,
 * every animation frame, plus a full attribute re-upload.
 *
 * This version moves noise + displacement entirely into the vertex shader.
 * Each vertex's ORIGINAL (undisplaced) position attribute is left untouched
 * forever after geometry creation — it is never mutated or re-uploaded again.
 * The outward direction used for displacement is simply normalize(position)
 * computed live in-shader (equivalent to the old CPU-precomputed unit
 * direction vectors, since both geometries are centered at the origin).
 * Per-vertex work (one 3D simplex noise sample + a lerp along the direction
 * vector) now runs in parallel across thousands of GPU shader cores instead
 * of serially on the main thread. Per-frame JS cost is reduced to updating
 * a handful of uniforms (amplitude, frequency, time) — O(1), not O(vertices).
 *
 * The GLSL noise function below is a direct inline port of the classic
 * Ashima Arts / Stefan Gustavson 3D simplex noise ("webgl-noise", MIT-style/
 * public-domain-friendly license, ubiquitously embedded inline like this in
 * WebGL projects — no external dependency needed). It is a DIFFERENT
 * concrete noise implementation than the old hand-rolled CPU permutation
 * table (different lattice/permutation internals), so the exact lump
 * pattern will not pixel-match the previous version — but it is the same
 * class of coherent 3D simplex noise, tuned with the same amplitude/
 * frequency/time parameters, so the organic "lumpy sphere" character and
 * motion feel are preserved. See the report for what to specifically eyeball
 * in-browser.
 *
 * ── SHADERMATERIAL vs onBeforeCompile ───────────────────────────────────
 * ShaderMaterial was chosen over patching MeshBasicMaterial/PointsMaterial
 * via onBeforeCompile. onBeforeCompile string-patches Three.js's internal
 * generated shader source (chunk names, variable names like `transformed`,
 * `mvPosition`), which is an implicit, version-sensitive contract that can
 * silently break across Three.js releases. A small, explicit ShaderMaterial
 * with its own vertex/fragment source is easier to reason about, keeps the
 * noise/displacement math in one visible place, and only costs us having to
 * manually opt back into the few built-in behaviors we still want (fog,
 * output color-space conversion, and — for the inner Points — perspective
 * size attenuation), each pulled in explicitly below via Three's own
 * ShaderChunk `#include`s (`fog_pars_vertex`/`fog_vertex`,
 * `fog_pars_fragment`/`fog_fragment`, `colorspace_fragment`,
 * `tonemapping_fragment`, `common`). These `#include` directives are
 * resolved by Three's shader preprocessor for ANY ShaderMaterial, not just
 * built-in materials, so this is a supported, documented pattern.
 *
 * Tradeoff / gotcha specifically verified: `wireframe: true` on the outer
 * mesh's material. Wireframe rendering in Three.js is NOT implemented in
 * the shader at all — WebGLRenderer swaps in a wireframe index buffer and
 * draws with gl.LINES instead of gl.TRIANGLES whenever `material.wireframe`
 * is true, regardless of material type (MeshBasicMaterial, ShaderMaterial,
 * anything). So a custom ShaderMaterial with `wireframe: true` renders as a
 * wireframe exactly like the original MeshBasicMaterial did — confirmed by
 * reading Three.js's WebGLRenderer/WebGLGeometries source, since no browser
 * is available in this task to visually confirm it.
 *
 * ── RING IMPLEMENTATION ─────────────────────────────────────────────────
 * Each ripple is a THREE.TorusGeometry lying in the XY plane (facing the
 * camera by default, since the camera looks down -Z), given a small random
 * tilt for organic variety. On spawn it's added to a pool with a start
 * timestamp; every frame each pooled ring's scale grows and opacity fades
 * over ~1.5s (eased), and once its lifetime elapses its geometry/material
 * are disposed and it's removed from the scene and the pool — no leaks.
 * Rings spawn periodically (every ~1.5-3s while active) and additionally on
 * volume spikes (with a short cooldown so spikes can't spam rings). Rings
 * are unrelated to the noise displacement change above and are unchanged.
 */

import * as THREE from 'three';

// ───────────────────────────────────────────────────────────────────────
// Exact palette — do not introduce any other hues. Glow textures are pure
// white-to-transparent gradients; their visible color comes entirely from
// each material's `color`/`uColor`, which is always one of these three.
// ───────────────────────────────────────────────────────────────────────
const COLOR_PRIMARY = 0x6D4FD1; // outer wireframe stroke
const COLOR_ACCENT = 0x5A3FB8; // rings + inner sphere + glow tint
const COLOR_AMBIENT = 0xEDEBE4; // fog / ambient tint only

// ───────────────────────────────────────────────────────────────────────
// Inline GLSL 3D simplex noise — classic Ashima Arts / Stefan Gustavson
// "webgl-noise" implementation, MIT-style/public-domain-friendly and
// commonly embedded inline like this with no external dependency. Shared
// as a string fragment so both vertex shaders below can splice it in.
// ───────────────────────────────────────────────────────────────────────
const GLSL_SIMPLEX_NOISE_3D = `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

// ───────────────────────────────────────────────────────────────────────
// Outer wireframe icosahedron shaders. Displacement pushes each vertex
// in/out along normalize(position) (valid since the geometry is centered
// at the origin) by snoise(basePosition * frequency + time), mirroring the
// old CPU algorithm's math exactly — just evaluated on the GPU instead.
// ───────────────────────────────────────────────────────────────────────
const OUTER_VERTEX_SHADER = `
uniform float uAmplitude;
uniform float uFrequency;
uniform float uNoiseTime;

${GLSL_SIMPLEX_NOISE_3D}

#include <fog_pars_vertex>

void main() {
  vec3 dir = normalize(position);
  float n = snoise(vec3(
    position.x * uFrequency + uNoiseTime,
    position.y * uFrequency + uNoiseTime,
    position.z * uFrequency - uNoiseTime
  ));
  vec3 displaced = position + dir * n * uAmplitude;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const OUTER_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;

#include <fog_pars_fragment>

void main() {
  gl_FragColor = vec4(uColor, uOpacity);

  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────────────────────────────────────────────────────
// Inner dotted-sphere shaders. Same displacement technique as the outer
// mesh, plus manual perspective size-attenuation (Three's PointsMaterial
// does this internally via uniforms it sets itself for isPointsMaterial —
// a plain ShaderMaterial isn't recognized as such, so we replicate the
// exact formula Three.js uses: size *= pixelRatio, scale = height * 0.5,
// gl_PointSize = size * (scale / -mvPosition.z) under perspective).
// ───────────────────────────────────────────────────────────────────────
const INNER_VERTEX_SHADER = `
uniform float uAmplitude;
uniform float uFrequency;
uniform float uNoiseTime;
uniform float uSize;
uniform float uScale;

${GLSL_SIMPLEX_NOISE_3D}

#include <common>
#include <fog_pars_vertex>

void main() {
  vec3 dir = normalize(position);
  float n = snoise(vec3(
    position.x * uFrequency + uNoiseTime,
    position.y * uFrequency + uNoiseTime,
    position.z * uFrequency - uNoiseTime
  ));
  vec3 displaced = position + dir * n * uAmplitude;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  gl_PointSize = uSize;
  if (isPerspectiveMatrix(projectionMatrix)) {
    gl_PointSize *= (uScale / -mvPosition.z);
  }

  #include <fog_vertex>
}
`;

const INNER_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;

#include <fog_pars_fragment>

void main() {
  gl_FragColor = vec4(uColor, uOpacity);

  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

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

// Builds the outer wireframe mesh's ShaderMaterial. `wireframe: true` is a
// Material-level flag honored by WebGLRenderer independent of shader code
// (see file-header comment) — no special-casing needed here for it to work.
function createOuterMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: OUTER_VERTEX_SHADER,
    fragmentShader: OUTER_FRAGMENT_SHADER,
    wireframe: true,
    transparent: true,
    fog: true, // opts into Three's automatic per-frame fogColor/fogNear/fogFar uniform updates
    uniforms: {
      uColor: { value: new THREE.Color(COLOR_PRIMARY) },
      uOpacity: { value: 0.85 },
      uAmplitude: { value: 0.05 },
      uFrequency: { value: 0.9 },
      uNoiseTime: { value: 0 },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
    },
  });
}

function createInnerMaterial(pixelRatio, height) {
  return new THREE.ShaderMaterial({
    vertexShader: INNER_VERTEX_SHADER,
    fragmentShader: INNER_FRAGMENT_SHADER,
    transparent: true,
    fog: true,
    uniforms: {
      uColor: { value: new THREE.Color(COLOR_ACCENT) },
      uOpacity: { value: 0.9 },
      uAmplitude: { value: 0.03 },
      uFrequency: { value: 1.1 },
      uNoiseTime: { value: 0 },
      uSize: { value: 0.032 * pixelRatio },
      uScale: { value: height * 0.5 },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
    },
  });
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
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const width = canvas.clientWidth || window.innerWidth || 300;
  const height = canvas.clientHeight || window.innerHeight || 300;
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(COLOR_AMBIENT, 5.5, 11);

  const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 100);
  camera.position.set(0, 0, 6);

  // ── Outer wireframe icosahedron (organic, lumpy displacement via GPU shader) ──
  const outerGeo = new THREE.IcosahedronGeometry(1.6, 4); // moderate polycount (~2562 verts)
  const outerMat = createOuterMaterial();
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.frustumCulled = false; // displacement is small; avoid per-frame bounding recompute

  // ── Inner denser dotted sphere ──
  const innerGeo = new THREE.IcosahedronGeometry(0.72, 3); // denser relative to its size (~642 pts)
  const innerMat = createInnerMaterial(pixelRatio, height);
  const innerPoints = new THREE.Points(innerGeo, innerMat);
  innerPoints.frustumCulled = false;

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
    innerPoints,
    innerGeo,
    innerMat,
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

// Pushes current amplitude/frequency/time state into the two displacement
// shaders' uniforms. This is the ENTIRE per-frame "displacement update" now
// — O(1) uniform writes instead of an O(vertices) JS loop + noise sample.
function setDisplacementUniforms(ctx, outerAmplitude, outerNoiseTime, innerAmplitude, innerNoiseTime) {
  ctx.outerMat.uniforms.uAmplitude.value = outerAmplitude;
  ctx.outerMat.uniforms.uNoiseTime.value = outerNoiseTime;
  ctx.innerMat.uniforms.uAmplitude.value = innerAmplitude;
  ctx.innerMat.uniforms.uNoiseTime.value = innerNoiseTime;
}

// ── Static single-frame render used for reduced-motion mode ──
function renderStaticFrame(ctx) {
  const idleAmplitude = ctx.active ? 0.085 : 0.05;
  const noiseTime = 0.73; // fixed, pleasant snapshot — never advances
  setDisplacementUniforms(
    ctx,
    idleAmplitude, noiseTime,
    idleAmplitude * 0.6, noiseTime + 4.1
  );

  const glowScale = 3.0 * (1 + ctx.displayVolume * 0.5);
  ctx.glowCore.scale.set(glowScale, glowScale, 1);
  ctx.glowHalo.scale.set(glowScale * 1.7, glowScale * 1.7, 1);
  ctx.glowCoreMat.opacity = 0.5 + ctx.displayVolume * 0.35;
  ctx.glowHaloMat.opacity = 0.26 + ctx.displayVolume * 0.2;

  ctx.renderer.render(ctx.scene, ctx.camera);
}

function animate(ctx) {
  // Do not reschedule while scrolled off-screen — see the IntersectionObserver
  // wired up in init() below. Without this, once the orb was lazily started
  // (round-2 fix), its rAF chain ran forever regardless of whether the CTA
  // section was still in view: scroll back up to re-read the hero/capability
  // cards/demo/stats and the orb kept rendering a full WebGL scene
  // (antialiased wireframe + points + glow sprites) completely off-screen,
  // competing with Lenis/GSAP/cursor rAF loops the whole time. Same class of
  // bug as the light-rays canvas fixed in round 2, just not caught there
  // because that fix only gated the *first* start, not ongoing visibility.
  if (!ctx.running) return;
  ctx.rafId = requestAnimationFrame(() => animate(ctx));

  const delta = Math.min(ctx.clock.getDelta(), 0.1); // clamp to avoid huge jumps on tab-switch
  ctx.clockElapsed += delta;

  // Smooth (lerp) the live volume so raw setVolume() calls (10-20x/sec)
  // read as fluid, not stepped/laggy.
  const smoothing = 1 - Math.exp(-delta * 10);
  ctx.displayVolume += (ctx.targetVolume - ctx.displayVolume) * smoothing;

  const active = ctx.active;
  const v = ctx.displayVolume;

  // ── Displacement amplitude & noise speed (JS-side scalars only — the
  // actual per-vertex noise/displacement work happens in the vertex
  // shader now, driven by the uniforms these feed into below) ──
  const idleAmplitude = 0.05;
  const activeBaseAmplitude = 0.09; // elevated-but-calm motion during active silence
  const amplitude = active ? activeBaseAmplitude + v * 0.55 : idleAmplitude;

  const idleNoiseSpeed = 0.15;
  const activeNoiseSpeed = 0.28 + v * 0.7;
  const noiseSpeed = active ? activeNoiseSpeed : idleNoiseSpeed;
  ctx.noiseTime += delta * noiseSpeed;

  setDisplacementUniforms(
    ctx,
    amplitude, ctx.noiseTime,
    amplitude * 0.6, ctx.noiseTime * 1.15 + 4.1
  );

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

  // Points size-attenuation uniforms depend on renderer pixel ratio/height
  // (see createInnerMaterial's comment) — keep them in sync on resize.
  const pixelRatio = ctx.renderer.getPixelRatio();
  ctx.innerMat.uniforms.uSize.value = 0.032 * pixelRatio;
  ctx.innerMat.uniforms.uScale.value = height * 0.5;

  if (ctx.reducedMotion) renderStaticFrame(ctx);
}

function disposeAll(ctx) {
  ctx.running = false;
  cancelAnimationFrame(ctx.rafId);
  window.removeEventListener('resize', ctx.resizeListener);
  if (ctx.visibilityObserver) ctx.visibilityObserver.disconnect();

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
        running: false,
        visibilityObserver: null,
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
        ctx.running = true;
        animate(ctx);

        // Keep pausing/resuming for as long as this instance lives — the
        // caller (riley.js) only uses IntersectionObserver to decide WHEN to
        // call init() the first time; it never revisits visibility after
        // that. This observer owns the ongoing on-screen/off-screen state
        // for the life of the instance, same pattern as the light-rays
        // canvas in riley-page.js.
        if (window.IntersectionObserver) {
          ctx.visibilityObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                if (!ctx.running) {
                  ctx.running = true;
                  ctx.clock.getDelta(); // discard elapsed pause time — avoid a big delta jump
                  animate(ctx);
                }
              } else if (ctx.running) {
                ctx.running = false;
                cancelAnimationFrame(ctx.rafId);
              }
            });
          }, { threshold: 0 });
          ctx.visibilityObserver.observe(canvasEl);
        }
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
