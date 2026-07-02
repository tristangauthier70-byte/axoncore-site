---
name: Axon Core AI
description: AI voice/chat front-desk agency for Singapore SMEs — restrained, intelligent, confident
colors:
  void-black: "#08080A"
  surface-low: "#0F0F13"
  surface-mid: "#17171C"
  surface-high: "#1E1E24"
  paper-white: "#FFFFFF"
  static-grey: "#9A9AA6"
  hairline: "rgba(255,255,255,0.08)"
  signal-violet: "#A78BFA"
  signal-violet-deep: "#8B7CF6"
  signal-violet-glow: "rgba(167,139,250,0.35)"
  graph-ink: "#1E2433"
  graph-line: "rgba(148,163,184,0.14)"
typography:
  display:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "clamp(2.75rem, 6vw, 5.25rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "clamp(1.75rem, 3.2vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  pill: "999px"
spacing:
  section-y: "120px"
  section-y-mobile: "80px"
  gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal-violet}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
  button-primary-hover:
    backgroundColor: "{colors.signal-violet-deep}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
  card-surface:
    backgroundColor: "{colors.surface-low}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.lg}"
    padding: "40px"
---

# Design System: Axon Core AI

## 1. Overview

**Creative North Star: "The Quiet Signal"**

Axon Core sells trust, not spectacle: an SME owner in Singapore is deciding whether to let an AI answer their phones and handle their customers' money-generating calls for the next 36 months. The system reads as a restrained, near-black canvas where confidence comes from typographic discipline and generous space, not decoration. Riley, the AI voice agent, is present as a felt intelligence rather than a stated one: a quiet, dark node-graph motif — nodes and connecting lines in deep blue-grey, occasionally lit at a junction in the brand's single violet accent — evokes a mind quietly listening and connecting, without ever being labelled "neural network" or "AI brain" on the page.

This system explicitly rejects the site's own previous default: a page-wide purple wash, colored border lines separating every section, and a purple glow sweeping in on every scroll trigger. It also rejects generic SaaS-landing-page scaffolding — gradient text, side-stripe accent borders, identical icon-card grids, a tiny uppercase eyebrow above every section, glassmorphism used as decoration rather than function.

**Key Characteristics:**
- Void-black base, near-monochrome — color is earned, not default
- One accent (signal violet) used on primary actions and select headline words only — never a page-wide wash
- Depth via tonal layering (surface-low → surface-high), not drop shadows
- The node-graph motif is the system's one recurring signature, appearing sparingly (hero, empty-feeling sections, section transitions) — never as wallpaper
- Serif display (Cormorant Garamond) paired with a clean sans body (Inter) — the contrast carries elegance without needing color to do it

## 2. Colors

Near-monochrome with a single rare accent; the palette does the opposite of what the old system did, which used color as connective tissue between every section.

### Primary
- **Signal Violet** (#A78BFA): The brand's one accent color. Reserved for primary CTA buttons, and selected words within a headline (never a whole headline, never a whole section). Target: roughly 5-10% of any given viewport, matching "The One Voice Rule" below.
- **Signal Violet Deep** (#8B7CF6): Hover/active state for violet-filled elements only.

### Neutral
- **Void Black** (#08080A): Page background. Cooler and darker than the old `#080612` — the previous value carried a visible purple tint even at rest; this one reads as true near-black.
- **Surface Low** (#0F0F13): First tonal step up — section-alt backgrounds, resting card surfaces.
- **Surface Mid** (#17171C): Second tonal step — nested or hovered surfaces.
- **Surface High** (#1E1E24): Third tonal step — the most "raised" element on a page (e.g. an active input, a featured pricing card).
- **Paper White** (#FFFFFF): Primary text, headlines.
- **Static Grey** (#9A9AA6): Secondary/muted text. Verify against Surface Low/Mid backgrounds at ≥4.5:1 before using at body-text sizes; drop to a lighter grey rather than dimming further if a contrast check fails.
- **Hairline** (rgba(255,255,255,0.08)): The only permitted divider treatment — see the No-Color-Dividers Rule below.

### Signature: The Quiet Signal Graph
- **Graph Ink** (#1E2433): Dark blue-grey — the node-graph motif's base stroke/fill color. Never pure black (would disappear) and never violet-tinted (would compete with the accent).
- **Graph Line** (rgba(148,163,184,0.14)): Low-opacity slate connecting lines between nodes. A node may brighten to Signal Violet at a connection point as a rare emphasis moment (e.g. on scroll-trigger, or hover) — this is the *only* place violet and the graph motif mix.

### Named Rules
**The One Voice Rule.** Signal Violet appears on ≤10% of any given viewport. Its rarity is what makes it read as confident rather than eager. If more than one element on screen is violet-filled, remove one.

**The No-Color-Dividers Rule.** Sections are separated by whitespace (`spacing.section-y`) and, where a divider is truly needed (e.g. before a footer), a single Hairline rule — never a colored border, never a repeated glow sweep on every section boundary. This directly replaces the old system's `--ax-border: rgba(167,139,250,0.2)` reused as `border-top`/`border-bottom` on component headers throughout the page.

## 3. Typography

**Display Font:** Cormorant Garamond (with Georgia, serif fallback)
**Body Font:** Inter (with -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif fallback)

**Character:** An elegant serif display against a clean, technical sans body — the contrast itself signals "considered," so color doesn't have to. Carried forward unchanged from the existing system; it was already doing its job.

### Hierarchy
- **Display** (400, clamp(2.75rem, 6vw, 5.25rem), line-height 1.05): Hero headline only. `text-wrap: balance`.
- **Headline** (400, clamp(1.75rem, 3.2vw, 2.75rem), line-height 1.15): Section headlines. `text-wrap: balance`.
- **Body** (400, 1.0625rem, line-height 1.65): Paragraph copy. Cap at 65-75ch.
- **Label** (500, 0.8125rem, letter-spacing 0.04em): Buttons, nav items, tags. Not to be used as a per-section uppercase eyebrow — see Don'ts.

### Named Rules
**The Restraint Ceiling Rule.** Display heading never exceeds `clamp()` max of 5.5rem (~88px) and letter-spacing never goes tighter than -0.04em. The brand is confident, not loud.

## 4. Elevation

Flat with tonal layering — no drop shadows anywhere in the system. Depth is conveyed entirely by stepping through Void Black → Surface Low → Surface Mid → Surface High. This matches the reference sites studied for this redesign (Revone, Polyblock, Para all use tonal cards, not shadows) and reads as more premium-dark than a shadow-lifted card would against a near-black page.

### Named Rules
**The Tonal Depth Rule.** An element earns a lighter surface tone by being logically "closer" to the user (hovered, active, featured) — never by an arbitrary shadow. If something needs to visually lift, step it one tone lighter, don't add `box-shadow`.

## 5. Components

### Buttons
- **Shape:** Fully rounded, pill-shaped (999px radius) — soft and tactile per the confirmed component direction.
- **Primary:** Signal Violet background (#A78BFA), Void Black text, 14px 32px padding. Used once per section maximum — this is the rare accent moment.
- **Hover / Focus:** Background steps to Signal Violet Deep (#8B7CF6); add a gentle lift (`translateY(-2px)`) and a soft outer glow using Signal Violet Glow (rgba(167,139,250,0.35)) — tactile, not sharp. Focus-visible gets the same treatment plus a 2px Paper White outline offset 2px for keyboard users.
- **Ghost/Secondary:** Transparent background, Paper White text, Hairline border. Hover fades in a Surface Low background tint — no color shift, keeps the "ghost" honest.

### Cards / Containers
- **Corner Style:** 20px radius (lg) — soft, matches the tactile direction.
- **Background:** Surface Low at rest; steps to Surface Mid on hover for interactive cards (e.g. pricing cards, industry cards).
- **Shadow Strategy:** None — see Elevation. Depth via tone step only.
- **Border:** None by default. A Hairline border is permitted only where a card needs definition against an identically-toned neighbor (rare).
- **Internal Padding:** 40px desktop, 24px mobile.

### Inputs / Fields
- **Style:** Surface Low background, Hairline border, 12px radius (md).
- **Focus:** Border steps to Signal Violet at 40% opacity plus a soft violet glow — the one place an input is allowed to feel "alive."

### Navigation
- Sticky/pinned header (all three reference sites do this) — translucent Void Black at ~80% opacity with backdrop-blur, Hairline bottom border only after scroll starts (`ax-header--scrolled` state already exists in `main.js`, keep it). Label-weight nav items in Paper White, Static Grey when inactive.

### The Quiet Signal Graph (signature component)
A low-density node-and-line graph, rendered on canvas or SVG, in Graph Ink / Graph Line colors. Used in exactly three places: (1) behind the hero as a very subtle, slow-drifting background layer — not a focal 3D hero prop like Polyblock's, more ambient, (2) as the content for the previously-empty ROI-stat section, styled as a "live" widget (nodes pulse/connect as if representing live call activity, echoing Para's live-dashboard credibility trick but rendered in the brand's own visual language rather than a literal dashboard mockup), (3) as a rare full-bleed transition moment between two major sections (used once on the page, not repeated as a per-section device). Reduced-motion users get a static frame of the graph, no drift/pulse.

## 6. Do's and Don'ts

### Do:
- **Do** separate sections with whitespace (`spacing.section-y` = 120px desktop / 80px mobile) as the default, only.
- **Do** keep Signal Violet to ≤10% of any viewport — The One Voice Rule.
- **Do** use tonal layering (Surface Low/Mid/High) for all depth — The Tonal Depth Rule.
- **Do** give every animation a `prefers-reduced-motion` alternative, including the Quiet Signal Graph.
- **Do** verify Static Grey body text hits ≥4.5:1 contrast against whatever surface it sits on before shipping.

### Don't:
- **Don't** reuse a colored border variable as a section-to-section divider — this was the single biggest complaint that started this redesign. No `border-top`/`border-bottom` in Signal Violet or any tint of it, anywhere, except the rare intentional Hairline.
- **Don't** let a purple (or any color) radial-gradient "sweep" fire on every section as it scrolls into view. That was the old system's default and is explicitly retired.
- **Don't** fill an empty-feeling section with more small icons/copy. Fill it with one considered thing (a Quiet Signal Graph moment, a live-feeling widget, a single strong visual).
- **Don't** use gradient text, side-stripe colored borders, glassmorphism as decoration, identical icon-card grids repeated section after section, a tiny uppercase eyebrow above every section, or numbered 01/02/03 scaffolding without a real sequence behind it.
- **Don't** add drop shadows for lift — step the tonal surface instead.
- **Don't** let the Quiet Signal Graph become a second accent color system — it stays in the Graph Ink/Graph Line family, violet only at rare emphasis points.
