import {
  AU, BOUNDS, INNER, LD, LY, PC, PLANETS, RE, RAD, basis, clamp, diamM, dot, earthAU,
  ecl2eq, geoVec, gmst, kepler, neoPos, norm, planElements, planOrbit, planPos, satPos, sunDir,
  type SatState, type Vec,
} from './astro';
import { alphaOf, REG } from './regimes';
import { jd } from './astro';
import { STARS } from './stars';
import type { SatGroup, Snapshot, System } from './types';

/** Mirrors the @theme tokens in globals.css — canvas cannot read them cheaply. */
export const C = {
  void: '#05060a',
  chrome: '#ff7a1a',
  chromeDim: '#a34a12',
  hazard: '#ff3b1f',
  live: '#35ff9e',
  liveDim: '#12a866',
  caution: '#ffbe2e',
  seriesA: '#2be8d0',
  seriesB: '#4a6cff',
  bone: '#e6e4dc',
} as const;

export type MarkKind = 'star' | 'neo' | 'sat' | 'quake' | 'flight' | 'planet' | 'tno' | 'landmark'
  | 'system' | 'planetX';
export type Mark = { kind: MarkKind; i: number; x: number; y: number; id?: string };
export type Sel = { kind: MarkKind; i: number; id?: string } | null;

/**
 * Structures are objects too. Without these the big features — Sgr A*, the
 * heliopause, the Kuiper belt, the GEO belt — were the only things on screen
 * you could not click, which made the rule "click anything" a lie.
 */
export type Landmark = { id: string; name: string; rows: [string, string][] };
export const LANDMARKS: Record<string, Landmark> = {
  sgra: { id: 'sgra', name: 'Sgr A* · Galactic Centre', rows: [
    ['Distance', '26,700 LY'], ['Light travel', '26,700 YR'],
    ['Mass', '4.15 × 10⁶ M☉'], ['Schwarzschild radius', '12.7 × 10⁶ KM'],
    ['Type', 'SUPERMASSIVE BLACK HOLE'], ['Imaged', 'EHT · 2022'],
  ] },
  bubble: { id: 'bubble', name: 'Local Bubble', rows: [
    ['Radius', '≈ 150 LY'], ['Diameter', '≈ 300 LY'],
    ['Contents', 'HOT, LOW-DENSITY GAS'], ['Density', '≈ 0.05 ATOMS/CM³'],
    ['Carved by', 'SUPERNOVAE · 10–20 MYR AGO'],
  ] },
  oort: { id: 'oort', name: 'Oort Shell', rows: [
    ['Inner boundary', '2,000 AU'], ['Outer boundary', '100,000 AU'],
    ['Outer boundary', '1.58 LY'], ['Bodies estimated', '≈ 10¹² > 1 KM'],
    ['Directly observed', 'NONE'], ['Evidence', 'LONG-PERIOD COMET ORBITS'],
  ] },
  heliopause: { id: 'heliopause', name: 'Heliopause', rows: [
    ['Distance', '123 AU'], ['Crossed by', 'VOYAGER 1 · 2012-AUG'],
    ['Light travel', '17.0 HR'], ['Marks', 'END OF SOLAR WIND DOMINANCE'],
    ['Beyond', 'INTERSTELLAR MEDIUM'],
  ] },
  shock: { id: 'shock', name: 'Termination Shock', rows: [
    ['Distance', '94 AU'], ['Crossed by', 'VOYAGER 1 · 2004-DEC'],
    ['Effect', 'SOLAR WIND DROPS BELOW SOUND SPEED'],
  ] },
  kuiper: { id: 'kuiper', name: 'Kuiper Belt', rows: [
    ['Inner edge', '30 AU'], ['Outer edge', '50 AU'],
    ['Known objects', '> 3,000 CATALOGUED'], ['Largest', 'PLUTO · ERIS'],
    ['Composition', 'ICE, ROCK, FROZEN VOLATILES'],
  ] },
  geobelt: { id: 'geobelt', name: 'Geostationary Belt', rows: [
    ['Radius', '42,164 KM'], ['Altitude', '35,786 KM'],
    ['Period', '23 H 56 M 4 S'], ['Why', 'PERIOD MATCHES EARTH ROTATION'],
  ] },
  magnetopause: { id: 'magnetopause', name: 'Magnetopause', rows: [
    ['Standoff', '≈ 10 RE SUNWARD'], ['Set by', 'SOLAR WIND DYNAMIC PRESSURE'],
    ['Compresses', 'DURING GEOMAGNETIC STORMS'],
  ] },
};

export type View = {
  W: number; H: number;
  L: number;
  camLat: number; camLon: number;
  simT: number;
  data: Snapshot;
  sats: SatState[];
  sel: Sel;
  reduced: boolean;
  /** Projection centre this frame, heliocentric equatorial km. */
  anchor: Vec;
  /** Free pan, in screen radii. Kept in screen units so it survives zoom. */
  pan: { x: number; y: number };
  observer: { lat: number; lon: number; label: string; live: boolean };
  /** When set, the inner rungs draw this star's system instead of ours. */
  focus: System | null;
};

const TAU = Math.PI * 2;

/* ═══ galactic → equatorial rotation ══════════════════════════════
   Built once from the IAU pole so the galactic disc sits at the right
   inclination against the real star positions it crossfades with. */
const uv = (raDeg: number, decDeg: number): Vec => {
  const ra = raDeg * RAD, dec = decDeg * RAD;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};
const GAL_X = uv(266.40499, -28.93617);   // toward the galactic centre
const GAL_Z = uv(192.85948, 27.12825);    // north galactic pole
const GAL_Y: Vec = [
  GAL_Z[1] * GAL_X[2] - GAL_Z[2] * GAL_X[1],
  GAL_Z[2] * GAL_X[0] - GAL_Z[0] * GAL_X[2],
  GAL_Z[0] * GAL_X[1] - GAL_Z[1] * GAL_X[0],
];
const galToEq = (p: Vec): Vec => [
  GAL_X[0] * p[0] + GAL_Y[0] * p[1] + GAL_Z[0] * p[2],
  GAL_X[1] * p[0] + GAL_Y[1] * p[1] + GAL_Z[1] * p[2],
  GAL_X[2] * p[0] + GAL_Y[2] * p[1] + GAL_Z[2] * p[2],
];

/* ═══ the moving anchor ═══════════════════════════════════════════
   A fixed centre is wrong at every scale but one. Zooming the galaxy
   means zooming its centre; zooming the solar system means zooming the
   sun; zooming further means zooming Earth. So the projection centre
   migrates down a chain — Sgr A* → Sol → Earth — interpolated against L
   itself, which makes the pan happen as you scroll rather than as a
   separate animation.

   Each handoff finishes before the regimes that assume the next anchor
   start contributing to the crossfade: Sol is fully centred by the Local
   Bubble detent, Earth by the Heliosphere detent. That is what keeps the
   geocentric renderers, which are Earth-centred by construction, from
   disagreeing with the heliocentric ones mid-blend. */
/** Our galactocentric distance. The one measured number in the galactic view. */
const GC_LY = 26700;
const GC_KM: Vec = galToEq([GC_LY * LY, 0, 0]);

const smoothstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerp3 = (a: Vec, b: Vec, t: number): Vec =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** L band over which each handoff completes. */
const GC_TO_SOL: [number, number] = [17.75, 15.90];
const SOL_TO_EARTH: [number, number] = [10.00, 8.40];
const bandT = (L: number, [hi, lo]: [number, number]) => smoothstep((hi - L) / (hi - lo));

export function anchorAt(L: number, simT: number, focus?: System | null): Vec {
  const toSol = lerp3(GC_KM, [0, 0, 0], bandT(L, GC_TO_SOL));
  if (focus) {
    // Descending into another star: the chain terminates there instead of at
    // Earth, so the same scroll gesture converges on the focused system.
    const f: Vec = [focus.x * PC, focus.y * PC, focus.z * PC];
    return lerp3(toSol, f, bandT(L, GC_TO_SOL));
  }
  const e = ecl2eq(earthAU(simT));
  const earthKm: Vec = [e[0] * AU, e[1] * AU, e[2] * AU];
  return lerp3(toSol, earthKm, bandT(L, SOL_TO_EARTH));
}

/** What the view is currently centred on, for the readout. */
export function anchorLabel(L: number, focus?: System | null) {
  if (focus) return bandT(L, GC_TO_SOL) > 0.5 ? focus.host.toUpperCase() : 'SGR A*';
  const a = bandT(L, GC_TO_SOL), b = bandT(L, SOL_TO_EARTH);
  if (b > 0.5) return b > 0.98 ? 'EARTH' : 'SOL → EARTH';
  if (a > 0.5) return a > 0.98 ? 'SOL' : 'SGR A* → SOL';
  return 'SGR A*';
}

type Proj = (p: Vec) => [number, number, number];

/**
 * Space frames get a fixed orientation bias. Without it the default camera —
 * which is Bangalore's own lat/lon, because the geocentric regimes need it —
 * happens to look almost straight down the galactic-centre axis, so the disc
 * and the planet orbits both collapse to near edge-on. The bias splits the
 * difference between the ecliptic and galactic poles, leaving both planes
 * legibly tilted. Dragging still moves from here.
 */
const SPACE_TILT = 33, SPACE_SPIN = 153;

function frame(v: View, unitKm: number, opts: { ecliptic?: boolean; galactic?: boolean } = {}): Proj {
  const b = basis(v.camLat * 0.55 + SPACE_TILT, v.camLon + SPACE_SPIN);
  const R = Math.min(v.W, v.H) * 0.46;
  const ppk = R / Math.pow(10, v.L);
  const cx = v.W * 0.5 + v.pan.x * R, cy = v.H * 0.52 + v.pan.y * R;
  const [ax, ay, az] = v.anchor;
  return (p: Vec) => {
    const q: Vec = opts.galactic ? galToEq(p) : opts.ecliptic ? ecl2eq(p) : p;
    const d: Vec = [q[0] * unitKm - ax, q[1] * unitKm - ay, q[2] * unitKm - az];
    return [cx + dot(d, b.r) * ppk, cy - dot(d, b.u) * ppk, dot(d, b.v)];
  };
}

/**
 * Earth-fixed equatorial frame: the planet holds still and the satellites
 * move. Earth is placed by the anchor rather than nailed to the middle of
 * the canvas, so while the centre is still migrating from the sun the
 * planet drifts inward instead of jumping.
 */
function geoFrame(v: View) {
  const g = gmst(v.simT);
  const b = basis(v.camLat, v.camLon + g);
  const R = Math.min(v.W, v.H) * 0.46;
  const ppk = R / Math.pow(10, v.L);
  const e = ecl2eq(earthAU(v.simT));
  const d: Vec = [e[0] * AU - v.anchor[0], e[1] * AU - v.anchor[1], e[2] * AU - v.anchor[2]];
  const cx = v.W * 0.5 + v.pan.x * R + dot(d, b.r) * ppk;
  const cy = v.H * 0.52 + v.pan.y * R - dot(d, b.u) * ppk;
  return {
    g, cx, cy, ppk,
    P: ((p: Vec) => [cx + dot(p, b.r) * ppk, cy - dot(p, b.u) * ppk, dot(p, b.v)]) as Proj,
  };
}

/* ═══ primitives ══════════════════════════════════════════════════ */
let g!: CanvasRenderingContext2D;

function lbl(t: string, x: number, y: number, color: string, size = 9) {
  g.font = `${size}px "JetBrains Mono",monospace`;
  g.lineWidth = 2.6;
  g.strokeStyle = 'rgba(5,6,10,.85)';
  g.strokeText(t, x, y);
  g.fillStyle = color;
  g.fillText(t, x, y);
}
const mix = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
function diamond(x: number, y: number, s: number) {
  g.beginPath();
  g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y);
  g.closePath();
}
function crosshair(x: number, y: number, r: number, color: string) {
  g.strokeStyle = color; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x - r, y); g.lineTo(x - r * 0.3, y);
  g.moveTo(x + r * 0.3, y); g.lineTo(x + r, y);
  g.moveTo(x, y - r); g.lineTo(x, y - r * 0.3);
  g.moveTo(x, y + r * 0.3); g.lineTo(x, y + r);
  g.stroke();
}
/** Ring at a real distance, labelled in its own units. */
function ring(cx: number, cy: number, rPx: number, text: string, color: string, dashed = true) {
  if (rPx < 8 || rPx > 6000) return;
  g.beginPath(); g.arc(cx, cy, rPx, 0, TAU);
  g.strokeStyle = color; g.lineWidth = 1;
  g.setLineDash(dashed ? [2, 5] : []);
  g.stroke(); g.setLineDash([]);
  lbl(text, cx + rPx * 0.7, cy - rPx * 0.7, color, 8.5);
}
/**
 * A system, drawn as a system: the host star with one orbit ellipse around it.
 * That is the universal pictogram for "this star has planets", and it needs no
 * legend. Category is carried by colour, not by adding another shape to a
 * field that is already full of shapes.
 */
function systemGlyph(x: number, y: number, r: number, color: string, weight = 1) {
  g.strokeStyle = color;
  g.lineWidth = weight;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.42, -0.5, 0, TAU);
  g.stroke();
}

/** Seeded irregular polygon — an asteroid, drawn not photographed. */
function rock(x: number, y: number, s: number, seed: number) {
  let z = (seed * 2654435761) % 2147483647;
  const r = () => (z = (z * 48271) % 2147483647) / 2147483647;
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const th = (k / 8) * TAU, rr = s * (0.62 + r() * 0.5);
    const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr;
    k ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}
/**
 * A glyph per constellation type. Identical squares made a GPS bird, a
 * geostationary relay and a Starlink panel look like the same object, which
 * they are not — the shapes now say what kind of spacecraft it is.
 */
function satGlyph(x: number, y: number, grp: SatGroup, s: number, color: string) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 1;
  switch (grp) {
    case 'ISS':                                  // pressurised modules + trusses
      g.fillRect(x - s * 1.5, y - s * 0.35, s * 3, s * 0.7);
      g.fillRect(x - s * 0.35, y - s * 1.3, s * 0.7, s * 2.6);
      g.fillRect(x - s * 2.2, y - s * 0.9, s * 0.5, s * 1.8);
      g.fillRect(x + s * 1.7, y - s * 0.9, s * 0.5, s * 1.8);
      break;
    case 'GPS': {                                // hexagonal bus
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const th = (k / 6) * TAU + Math.PI / 6;
        const px = x + Math.cos(th) * s, py = y + Math.sin(th) * s;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      break;
    }
    case 'GEO':                                  // body with a parabolic dish
      g.fillRect(x - s * 0.7, y - s * 0.7, s * 1.4, s * 1.4);
      g.beginPath();
      g.arc(x, y + s * 1.1, s * 0.95, Math.PI, TAU);
      g.stroke();
      break;
    case 'STL':                                  // one flat panel, edge on
      g.fillRect(x - s * 1.6, y - s * 0.3, s * 3.2, s * 0.6);
      break;
    default:                                     // OneWeb: small boxed bus
      g.fillRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
      g.fillStyle = C.void;
      g.fillRect(x - s * 0.25, y - s * 0.25, s * 0.5, s * 0.5);
  }
}

/**
 * Aircraft silhouette: fuselage, swept wings, tailplane. The previous chevron
 * was a triangle, which at this size read as a mouse cursor rather than a
 * plane. Drawn nose-up; the caller rotates it onto the real track.
 */
function planeGlyph(s: number) {
  g.beginPath();
  g.moveTo(0, -1.9 * s);                       // nose
  g.lineTo(0.34 * s, -0.9 * s);
  g.lineTo(0.34 * s, -0.15 * s);
  g.lineTo(1.85 * s, 0.75 * s);                // wing leading edge
  g.lineTo(1.85 * s, 1.1 * s);
  g.lineTo(0.34 * s, 0.72 * s);
  g.lineTo(0.34 * s, 1.25 * s);
  g.lineTo(0.86 * s, 1.68 * s);                // tailplane
  g.lineTo(0.86 * s, 1.92 * s);
  g.lineTo(0, 1.62 * s);
  g.lineTo(-0.86 * s, 1.92 * s);
  g.lineTo(-0.86 * s, 1.68 * s);
  g.lineTo(-0.34 * s, 1.25 * s);
  g.lineTo(-0.34 * s, 0.72 * s);
  g.lineTo(-1.85 * s, 1.1 * s);
  g.lineTo(-1.85 * s, 0.75 * s);
  g.lineTo(-0.34 * s, -0.15 * s);
  g.lineTo(-0.34 * s, -0.9 * s);
  g.closePath();
}

/** Great-circle path between two ground points, clipped at the horizon. */
function greatCircle(F: ReturnType<typeof geoFrame>, aLat: number, aLon: number,
  bLat: number, bLon: number, radius: number, steps = 48) {
  const A = norm(geoVec(aLat, aLon, 1, 0));
  const B = norm(geoVec(bLat, bLon, 1, 0));
  const omega = Math.acos(clamp(dot(A, B), -1, 1));
  if (omega < 1e-4) return;
  const so = Math.sin(omega);
  g.beginPath();
  let pen = false;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const w1 = Math.sin((1 - t) * omega) / so, w2 = Math.sin(t * omega) / so;
    const dir: Vec = [A[0] * w1 + B[0] * w2, A[1] * w1 + B[1] * w2, A[2] * w1 + B[2] * w2];
    // rebuild in the rotating frame so the arc turns with the planet
    const lat = Math.asin(clamp(dir[2], -1, 1)) / RAD;
    const lon = Math.atan2(dir[1], dir[0]) / RAD;
    const q = F.P(geoVec(lat, lon, radius, F.g));
    if (q[2] > 0) { pen ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); pen = true; } else pen = false;
  }
  g.stroke();
}

/** B−V colour index → an approximate stellar colour. */
function starColor(ci: number) {
  if (ci < 0.0) return '#a9c6ff';
  if (ci < 0.3) return '#cfe0ff';
  if (ci < 0.6) return '#f6f4ea';
  if (ci < 0.9) return '#ffe9b0';
  if (ci < 1.4) return '#ffc078';
  return '#ff9a6a';
}

/**
 * The background starfield used to be 300 random pixels at fixed screen
 * positions — decorative, unexplainable, and it did not move with the camera,
 * which is exactly wrong for a sky. This draws the real HYG catalogue instead.
 *
 * From the Oort shell inward, every catalogued star is at least 200,000 AU
 * away, so at these scales they are effectively at infinity: their screen
 * position depends only on direction, never on where you have panned or zoomed
 * to. That is what a real sky does, and it means the dots are genuinely those
 * stars — orbit the camera and the constellations turn with it.
 */
function starSphere(v: View, a: number) {
  if (a <= 0.01) return;
  const b = basis(v.camLat * 0.55 + SPACE_TILT, v.camLon + SPACE_SPIN);
  const R = Math.min(v.W, v.H) * 0.46;
  // Infinity should not shift with pan, but a fixed sky read as a broken drag;
  // a slight parallax gives the gesture feedback without moving constellations much.
  const cx = v.W * 0.5 + v.pan.x * R * 0.12, cy = v.H * 0.52 + v.pan.y * R * 0.12;
  const spread = R * 1.45;
  g.globalAlpha = a;
  for (const st of STARS) {
    const d = norm([st[0], st[1], st[2]]);
    if (dot(d, b.v) <= 0) continue;               // behind the camera
    const x = cx + dot(d, b.r) * spread;
    const y = cy - dot(d, b.u) * spread;
    const size = clamp(2.4 - st[3] * 0.3, 0.6, 2.6);
    g.fillStyle = starColor(st[4]);
    if (size <= 1) g.fillRect(x, y, 1, 1);
    else { g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill(); }
    if (st[5] && st[3] < 1.0) lbl(st[5], x + size + 4, y + 3, mix(C.bone, 0.4), 8);
  }
  g.globalAlpha = 1;
}

/* ═══ 0 · galactic plane ══════════════════════════════════════════
   Schematic. Arm geometry is a four-armed logarithmic spiral at a 12°
   pitch — the shape of the Milky Way as usually modelled, not a survey.
   The one hard fact here is our own position: 26,700 ly from the centre,
   in the Orion Spur. */
const ARMS = (() => {
  let z = 424242;
  const rnd = () => (z = (z * 48271) % 2147483647) / 2147483647;
  const pts: [number, number, number, number][] = [];   // x, y, z (ly), brightness
  // Logarithmic spiral in its standard form, r = r0·e^(θ·tan p) with a 12°
  // pitch. Two full turns are needed to reach the outer disc — a shorter
  // sweep leaves the arms inside our own orbit, which is plainly wrong since
  // the Sun sits 26,700 ly out.
  const k = Math.tan(12 * RAD);
  for (let arm = 0; arm < 4; arm++) {
    const phase = (arm / 4) * TAU;
    for (let i = 0; i < 560; i++) {
      const th = 0.4 + (i / 560) * 12.2;
      const r = Math.min(2600 * Math.exp(k * th), 48000);
      const spread = 700 + r * 0.09;
      const a = th + phase + (rnd() - 0.5) * 0.16;
      pts.push([
        GC_LY - Math.cos(a) * r + (rnd() - 0.5) * spread,
        Math.sin(a) * r + (rnd() - 0.5) * spread,
        (rnd() - 0.5) * (600 + r * 0.02),
        0.22 + rnd() * 0.5,
      ]);
    }
  }
  for (let i = 0; i < 600; i++) {          // central bulge
    const a = rnd() * TAU, r = Math.pow(rnd(), 0.6) * 4500;
    pts.push([GC_LY - Math.cos(a) * r, Math.sin(a) * r, (rnd() - 0.5) * 2400, 0.3 + rnd() * 0.6]);
  }
  return pts;
})();

function drawGalactic(v: View, a: number, marks: Mark[]) {
  const P = frame(v, LY, { galactic: true });
  const cx = v.W * 0.5, cy = v.H * 0.52;
  g.globalAlpha = a;

  for (const [x, y, z, b] of ARMS) {
    const p = P([x, y, z]);
    g.fillStyle = mix(C.bone, b * 0.5);
    g.fillRect(p[0], p[1], 1.3, 1.3);
  }
  const gc = P([GC_LY, 0, 0]);
  marks.push({ kind: 'landmark', i: 0, id: 'sgra', x: gc[0], y: gc[1] });
  const gr = g.createRadialGradient(gc[0], gc[1], 0, gc[0], gc[1], 26);
  gr.addColorStop(0, mix(C.caution, 0.95));
  gr.addColorStop(0.4, mix(C.chrome, 0.35));
  gr.addColorStop(1, mix(C.chrome, 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(gc[0], gc[1], 26, 0, TAU); g.fill();
  lbl('SGR A* · GALACTIC CENTRE', gc[0] + 16, gc[1] + 3, mix(C.caution, 0.85));

  // galactocentric radius rings, drawn about the centre
  const ppl = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L) * LY;
  [10000, 20000, 30000].forEach(r =>
    ring(gc[0], gc[1], r * ppl, `${(r / 1000).toFixed(0)} KLY`, mix(C.chrome, 0.16)));

  const sol = P([0, 0, 0]);
  lbl('ORION SPUR', sol[0] + 14, sol[1] - 16, mix(C.seriesA, 0.8));
  crosshair(sol[0], sol[1], 11, C.live);
  lbl('YOU ARE HERE', sol[0] + 15, sol[1] + 4, C.live, 9.5);
  lbl(`${GC_LY.toLocaleString('en-US')} LY TO CENTRE`, sol[0] + 15, sol[1] + 15, mix(C.live, 0.6), 8.5);
  g.globalAlpha = 1;
}

/* ═══ 1 · local bubble ════════════════════════════════════════════
   Real stars, real parallax distances, equatorial cartesian — a volume,
   not a sky dome. Drag actually moves you through it. */
function drawBubble(v: View, a: number, marks: Mark[]) {
  const P = frame(v, PC);
  const [cx, cy] = P([0, 0, 0]);
  const ppl = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L) * LY;
  g.globalAlpha = a;

  ring(cx, cy, 150 * ppl, 'LOCAL BUBBLE ≈ 300 LY', mix(C.seriesA, 0.3));
  marks.push({ kind: 'landmark', i: 0, id: 'bubble', x: cx + 150 * ppl * 0.7, y: cy - 150 * ppl * 0.7 });
  [50, 100, 200, 400].forEach(r => ring(cx, cy, r * ppl, `${r} LY`, mix(C.chrome, 0.14)));

  STARS.forEach((s, i) => {
    const p = P([s[0], s[1], s[2]]);
    const isSel = v.sel?.kind === 'star' && v.sel.i === i;
    const size = clamp(3.6 - s[3] * 0.42, 0.7, 4.4) * (isSel ? 1.9 : 1);
    g.fillStyle = isSel ? C.caution : starColor(s[4]);
    g.beginPath(); g.arc(p[0], p[1], size, 0, TAU); g.fill();
    if (size > 2.4) {
      g.globalAlpha = a * 0.28;
      g.beginPath(); g.arc(p[0], p[1], size * 2.6, 0, TAU); g.fill();
      g.globalAlpha = a;
    }
    if (isSel || (s[5] && s[3] < 1.3)) lbl(s[5] || '—', p[0] + size + 5, p[1] + 3,
      isSel ? C.caution : mix(C.bone, 0.62));
    marks.push({ kind: 'star', i, x: p[0], y: p[1] });
  });

  // Stars with known planets get a ring. Faded by the rung's own weight: all
  // 328 systems sit inside 31 pc, so at galactic scale their rings collapse
  // onto one point and read as a solid green blob.
  // Colour carries the category everywhere: a host star is drawn caution-yellow
  // rather than its spectral colour, so "has planets" is legible at any density.
  // The orbit ellipse is added only for the nearest few, plus whatever is
  // selected — 328 rings at once was unreadable clutter.
  const sysA = a * Math.pow(alphaOf(1, v.L), 1.5);
  // Density gate. Almost every known exoplanet host is a nearby dwarf, so all
  // 328 of them sit inside 31 pc — drawn at once from 500 ly out they merge
  // into a single orange mass and bury the real star field. Reveal more as the
  // view narrows and they actually separate.
  const spanLy = Math.pow(10, v.L) / LY;
  const shown = Math.round(clamp(40 * (500 / spanLy), 14, v.data.sys.length));
  if (sysA > 0.12) v.data.sys.slice(0, shown).forEach((sy, i) => {
    g.globalAlpha = sysA;
    const p = P([sy.x, sy.y, sy.z]);
    const isSel = v.sel?.kind === 'system' && v.sel.i === i;
    const focused = v.focus?.host === sy.host;
    const hot = isSel || focused;

    // the host star itself, in the category colour
    g.beginPath();
    g.arc(p[0], p[1], hot ? 4 : 1.9, 0, TAU);
    g.fillStyle = hot ? C.caution : mix(C.caution, 0.85);
    g.fill();

    if (hot || i < 12) systemGlyph(p[0], p[1], hot ? 11 : 7,
      hot ? C.caution : mix(C.caution, 0.3), hot ? 1.4 : 1);

    // Label only once the neighbours have room. The nearest hosts are all
    // within a few light years of Sol, so from 500 ly out their names landed
    // on top of each other and on the "you are here" marker.
    if (hot || (sy.dist < 8 && spanLy < 90)) {
      lbl(`${sy.host} · ${sy.planets.length}p`, p[0] + 13, p[1] + 3,
        hot ? C.caution : mix(C.caution, 0.75), 8.5);
    }
    marks.push({ kind: 'system', i, x: p[0], y: p[1] });
  });
  g.globalAlpha = a;

  crosshair(cx, cy, 10, C.live);
  lbl('SOL · YOU ARE HERE', cx + 14, cy + 4, C.live, 9.5);
  g.globalAlpha = 1;
}

/* ═══ a focused foreign system ════════════════════════════════════
   Orbits are drawn as circles because the archive publishes a semi-major
   axis for almost everything and an eccentricity for almost nothing. The
   habitable zone is the standard flux approximation from the star's own
   radius and temperature, and is labelled as approximate. */
function teffColor(teff: number | null) {
  if (teff == null) return '#ffd9a0';
  if (teff > 10000) return '#a9c6ff';
  if (teff > 7500) return '#cfe0ff';
  if (teff > 6000) return '#f6f4ea';
  if (teff > 5000) return '#ffe9b0';
  if (teff > 3700) return '#ffc078';
  return '#ff9a6a';
}

function drawSystem(v: View, a: number, marks: Mark[]) {
  const sy = v.focus;
  if (!sy) return;
  // Plot relative to the focused star, not the Sun: `frame` subtracts the
  // anchor, which is now this star, so every point is offset by the star's own
  // equatorial position. Without this the whole system landed at the Sun's
  // origin — 268,000 AU off-anchor for Proxima, i.e. nowhere on screen.
  const proj = frame(v, AU);
  const s0: Vec = [sy.x * PC / AU, sy.y * PC / AU, sy.z * PC / AU];
  const P = (p: Vec) => proj([s0[0] + p[0], s0[1] + p[1], s0[2] + p[2]]);
  const ppa = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L) * AU;
  const [cx, cy] = P([0, 0, 0]);
  g.globalAlpha = a;

  // habitable zone
  const lum = sy.srad != null && sy.teff != null
    ? Math.pow(sy.srad, 2) * Math.pow(sy.teff / 5772, 4) : null;
  if (lum && lum > 0) {
    const hzi = Math.sqrt(lum / 1.1) * ppa, hzo = Math.sqrt(lum / 0.53) * ppa;
    if (hzo > 6 && hzi < Math.max(v.W, v.H)) {
      g.beginPath();
      g.arc(cx, cy, (hzi + hzo) / 2, 0, TAU);
      g.strokeStyle = mix(C.live, 0.13);
      g.lineWidth = Math.max(1, hzo - hzi);
      g.stroke();
      lbl('HABITABLE ZONE ≈', cx + hzo * 0.7, cy - hzo * 0.7, mix(C.live, 0.6), 8.5);
    }
  }

  // distance rings, chosen to bracket the planets actually present
  const outer = Math.max(0.1, ...sy.planets.map(p => p.a ?? 0));
  [outer / 4, outer / 2, outer].forEach(r =>
    ring(cx, cy, r * ppa, `${r < 0.1 ? r.toFixed(3) : r.toFixed(2)} AU`, mix(C.chrome, 0.16)));

  sy.planets.forEach((pl, i) => {
    if (pl.a == null) return;
    const r = pl.a * ppa;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU);
    g.strokeStyle = mix(C.seriesA, 0.4); g.lineWidth = 1; g.stroke();
    // phase from the period so the planets actually move with mission time
    const th = pl.period ? (v.simT / 86400000 / pl.period) * TAU : i;
    const px = cx + Math.cos(th) * r, py = cy + Math.sin(th) * r;
    const isSel = v.sel?.kind === 'planetX' && v.sel.i === i;
    const size = clamp(1.6 + (pl.rade ?? 1) * 0.55, 2, 7) * (isSel ? 1.5 : 1);
    g.beginPath(); g.arc(px, py, size, 0, TAU);
    g.fillStyle = isSel ? C.caution : C.seriesA; g.fill();
    lbl(pl.name.replace(sy.host, '').trim() || pl.name, px + size + 5, py + 3,
      isSel ? C.caution : mix(C.seriesA, 0.9), 9);
    marks.push({ kind: 'planetX', i, x: px, y: py });
  });

  // the star
  const rr = clamp(10 + (sy.srad ?? 1) * 12, 8, 34);
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.3, teffColor(sy.teff));
  gr.addColorStop(1, mix(C.chrome, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
  lbl(`${sy.host} · ${sy.spect}`, cx + rr * 0.8, cy + rr * 0.8, C.caution, 9.5);
  lbl(`${(sy.dist * 3.26156).toFixed(2)} LY FROM SOL`, cx + rr * 0.8, cy + rr * 0.8 + 11,
    mix(C.caution, 0.6), 8.5);
  marks.push({ kind: 'system', i: v.data.sys.findIndex(x => x.host === sy.host), x: cx, y: cy });
  g.globalAlpha = 1;
}

/* ═══ 2 · oort shell ══════════════════════════════════════════════
   Hypothetical: no Oort object has ever been directly observed. Drawn as
   a modelled shell and labelled as one. */
const OORT = (() => {
  let z = 90210;
  const rnd = () => (z = (z * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: 900 }, () => {
    const u = rnd() * TAU, w = Math.acos(2 * rnd() - 1);
    const r = BOUNDS.oortInner + Math.pow(rnd(), 0.45) * 28000;
    return [r * Math.sin(w) * Math.cos(u), r * Math.sin(w) * Math.sin(u), r * Math.cos(w)] as Vec;
  });
})();

function drawOort(v: View, a: number, marks: Mark[]) {
  const P = frame(v, AU, { ecliptic: true });
  const [cx, cy] = P([0, 0, 0]);
  const ppa = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L) * AU;
  g.globalAlpha = a;

  for (const p of OORT) {
    const q = P(p);
    g.fillStyle = mix(C.bone, 0.3);
    g.fillRect(q[0], q[1], 1.2, 1.2);
  }
  ring(cx, cy, BOUNDS.oortInner * ppa, `INNER SHELL ${BOUNDS.oortInner.toLocaleString('en-US')} AU`, mix(C.chrome, 0.3));
  marks.push({ kind: 'landmark', i: 0, id: 'oort',
    x: cx + BOUNDS.oortInner * ppa * 0.7, y: cy - BOUNDS.oortInner * ppa * 0.7 });
  [5000, 10000, 20000].forEach(r =>
    ring(cx, cy, r * ppa, `${r.toLocaleString('en-US')} AU`, mix(C.chrome, 0.13)));
  ring(cx, cy, BOUNDS.heliopause * ppa, 'HELIOPAUSE', mix(C.seriesA, 0.4), false);

  // Bearing to the nearest star — but only while it is genuinely off screen.
  // At the stellar rung Proxima is a real, selectable object a few pixels away,
  // so an arrow pointing at its own distance was the same thing drawn twice.
  const bearingA = a * (1 - alphaOf(1, v.L));
  const prox = STARS.reduce((best, s) => {
    const d = Math.hypot(s[0], s[1], s[2]);
    return d < best.d ? { d, s } : best;
  }, { d: Infinity, s: STARS[0] });
  if (bearingA > 0.06) {
    g.globalAlpha = bearingA;
    const pp = P([prox.s[0] * PC / AU, prox.s[1] * PC / AU, prox.s[2] * PC / AU]);
    const ang = Math.atan2(pp[1] - cy, pp[0] - cx);
    const rEdge = Math.min(v.W, v.H) * 0.42;
    const ex = cx + Math.cos(ang) * rEdge, ey = cy + Math.sin(ang) * rEdge;
    g.strokeStyle = mix(C.seriesA, 0.5); g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
    g.textAlign = ex > cx ? 'right' : 'left';
    lbl(`${prox.s[5] || 'NEAREST STAR'} · ${Math.round(prox.d * PC / AU).toLocaleString('en-US')} AU`,
      ex + (ex > cx ? -6 : 6), ey, mix(C.seriesA, 0.85), 8.5);
    g.textAlign = 'left';
    g.globalAlpha = a;
  }

  crosshair(cx, cy, 9, C.live);
  lbl('SOLAR SYSTEM', cx + 13, cy + 4, C.live, 9);
  g.globalAlpha = 1;
}

/* ═══ 3 · outer system ════════════════════════════════════════════ */
function drawOuter(v: View, a: number, marks: Mark[]) {
  const P = frame(v, AU, { ecliptic: true });
  const [cx, cy] = P([0, 0, 0]);
  const ppa = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L) * AU;
  g.globalAlpha = a;

  // Kuiper belt: a faint density band for context, then the real bodies on top
  g.fillStyle = mix(C.chromeDim, 0.4);
  let z = 5150;
  const rnd = () => (z = (z * 48271) % 2147483647) / 2147483647;
  for (let k = 0; k < 520; k++) {
    const th = rnd() * TAU;
    const r = BOUNDS.kuiperInner + rnd() * (BOUNDS.kuiperOuter - BOUNDS.kuiperInner);
    const p = P([Math.cos(th) * r, Math.sin(th) * r, (rnd() - 0.5) * 6]);
    g.fillRect(p[0], p[1], 1.1, 1.1);
  }
  const kb = P([BOUNDS.kuiperOuter * 0.7, BOUNDS.kuiperOuter * 0.7, 0]);
  marks.push({ kind: 'landmark', i: 0, id: 'kuiper', x: kb[0], y: kb[1] });

  v.data.tno.forEach((o, i) => {
    const isSel = v.sel?.kind === 'tno' && v.sel.i === i;
    const p = P(kepler(o.a, o.e, o.i, o.om, o.w,
      o.ma * RAD + (TAU / (365.25 * Math.pow(o.a, 1.5))) * (jd(v.simT) - o.epoch)));
    rock(p[0], p[1], isSel ? 4.5 : clamp(5 - o.h * 0.45, 1.6, 3.4), i + 3);
    g.fillStyle = isSel ? C.caution : mix(C.seriesA, 0.85);
    g.fill();
    if (isSel || o.h < 2) {
      lbl(o.name.replace(/^\d+\s*/, '').replace(/\s*\(.*\)$/, ''),
        p[0] + 6, p[1] + 3, isSel ? C.caution : mix(C.seriesA, 0.8), 8.5);
    }
    marks.push({ kind: 'tno', i, x: p[0], y: p[1] });
  });
  ring(cx, cy, BOUNDS.terminationShock * ppa, `TERMINATION SHOCK ${BOUNDS.terminationShock} AU`, mix(C.seriesA, 0.28));
  ring(cx, cy, BOUNDS.heliopause * ppa, `HELIOPAUSE ${BOUNDS.heliopause} AU · V1 2012`, mix(C.seriesA, 0.42));
  marks.push(
    { kind: 'landmark', i: 0, id: 'shock',
      x: cx + BOUNDS.terminationShock * ppa * 0.7, y: cy - BOUNDS.terminationShock * ppa * 0.7 },
    { kind: 'landmark', i: 0, id: 'heliopause',
      x: cx + BOUNDS.heliopause * ppa * 0.7, y: cy - BOUNDS.heliopause * ppa * 0.7 },
  );

  PLANETS.forEach((pl, i) => {
    if (i < INNER) return;
    g.beginPath();
    planOrbit(pl, v.simT).forEach((q, k) => {
      const p = P(q);
      k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    });
    g.strokeStyle = mix(C.chrome, 0.34); g.lineWidth = 1; g.stroke();
    const p = P(planPos(pl, v.simT));
    const isSel = v.sel?.kind === 'planet' && v.sel.i === i;
    g.beginPath(); g.arc(p[0], p[1], isSel ? 5 : 3.2, 0, TAU);
    g.fillStyle = isSel ? C.caution : C.bone; g.fill();
    lbl(pl.n, p[0] + 7, p[1] + 3, isSel ? C.caution : mix(C.bone, 0.62));
    marks.push({ kind: 'planet', i, x: p[0], y: p[1] });
  });

  // inner system collapses to a point at this scale
  const s = P([0, 0, 0]);
  const gr = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], 16);
  gr.addColorStop(0, 'rgba(255,255,245,1)');
  gr.addColorStop(0.35, mix(C.caution, 0.7));
  gr.addColorStop(1, mix(C.chrome, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(s[0], s[1], 16, 0, TAU); g.fill();
  lbl('INNER SYSTEM', s[0] + 13, s[1] + 3, mix(C.caution, 0.85));
  g.globalAlpha = 1;
}

/* ═══ 4 · heliosphere ═════════════════════════════════════════════ */
function drawHelio(v: View, a: number, marks: Mark[]) {
  const P = frame(v, AU, { ecliptic: true });
  const sw = v.data.sw;
  g.globalAlpha = a;

  // solar wind: streak field on a Parker spiral, speed and density live
  const ph = (v.simT / 1000) % 1e6;
  const nP = v.reduced ? 120 : 340;
  const vs = (sw.speed || 400) / 400;
  const hot = sw.bz < 0;
  const dens = Math.min(1, (sw.dens || 3) / 7);
  g.lineWidth = 1;
  for (let k = 0; k < nP; k++) {
    const th = k * 137.508 * RAD;
    const rr = (ph * vs * 0.03 + k * 0.211) % 2.1;
    const alpha = (0.2 + dens * 0.55) * (1 - rr / 2.1);
    const a0 = th - rr * 0.62, a1 = th - (rr + 0.05) * 0.62;
    const p0 = P([Math.cos(a0) * rr, Math.sin(a0) * rr, 0]);
    const p1 = P([Math.cos(a1) * (rr + 0.05), Math.sin(a1) * (rr + 0.05), 0]);
    g.strokeStyle = mix(hot ? C.hazard : C.seriesA, alpha);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
  }

  v.data.neo.forEach((o, i) => {
    const isSel = v.sel?.kind === 'neo' && v.sel.i === i;
    g.beginPath();
    for (let k = 0; k <= 90; k++) {
      const p = P(kepler(o.a, o.e, o.i, o.om, o.w, (k / 90) * TAU));
      k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    }
    g.strokeStyle = isSel ? mix(C.caution, 0.95) : mix(C.hazard, 0.16 + (i % 5) * 0.05);
    g.lineWidth = isSel ? 1.4 : 0.8; g.stroke();
    const p = P(neoPos(o, v.simT));
    rock(p[0], p[1], isSel ? 4 : 2.6, i + 11);
    g.fillStyle = isSel ? C.caution : C.hazard; g.fill();
    marks.push({ kind: 'neo', i, x: p[0], y: p[1] });
  });

  PLANETS.forEach((pl, i) => {
    if (i >= INNER) return;
    g.beginPath();
    planOrbit(pl, v.simT, 72).forEach((q, k) => {
      const p = P(q);
      k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    });
    g.strokeStyle = mix(C.chrome, 0.34); g.lineWidth = 1; g.stroke();
    const p = P(planPos(pl, v.simT));
    g.beginPath(); g.arc(p[0], p[1], i === 2 ? 3.1 : 2.3, 0, TAU);
    g.fillStyle = i === 2 ? C.seriesA : C.bone; g.fill();
    lbl(pl.n, p[0] + 6, p[1] + 3, i === 2 ? mix(C.seriesA, 0.9) : mix(C.bone, 0.6));
    marks.push({ kind: 'planet', i, x: p[0], y: p[1] });
  });

  const xc = (sw.xray || 'A0')[0] as 'A' | 'B' | 'C' | 'M' | 'X';
  const mag = ({ A: 0.2, B: 0.4, C: 0.6, M: 0.85, X: 1.2 } as const)[xc] ?? 0.4;
  const s = P([0, 0, 0]);
  const rr = 16 + 26 * mag;
  const gr = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], rr);
  gr.addColorStop(0, 'rgba(255,255,245,1)');
  gr.addColorStop(0.22, mix(C.caution, 0.9));
  gr.addColorStop(0.55, mix(C.chrome, 0.35));
  gr.addColorStop(1, mix(C.hazard, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(s[0], s[1], rr, 0, TAU); g.fill();
  lbl('SUN', s[0] + rr * 0.78, s[1] + rr * 0.78, mix(C.caution, 0.85));
  const ep = P(earthAU(v.simT));
  crosshair(ep[0], ep[1], 9, mix(C.live, 0.6));
  g.globalAlpha = 1;
}

/* ═══ Earth, shared by the three geocentric regimes ══════════════ */
function drawEarth(F: ReturnType<typeof geoFrame>, v: View, a: number, detail: boolean) {
  const { cx, cy, ppk } = F;
  const R = Math.max(RE * ppk, 4.5);
  const tiny = RE * ppk < 9;
  const sd = sunDir(v.simT);
  const sp = F.P([sd[0] * RE * 1.6, sd[1] * RE * 1.6, sd[2] * RE * 1.6]);
  g.globalAlpha = a;

  const gr = g.createRadialGradient(sp[0], sp[1], R * 0.15, cx, cy, R * 1.9);
  gr.addColorStop(0, '#12212e');
  gr.addColorStop(0.45, '#0a1017');
  gr.addColorStop(1, '#04060a');
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fillStyle = gr; g.fill();
  g.strokeStyle = mix(C.chrome, 0.62); g.lineWidth = 1; g.stroke();

  if (tiny) {
    lbl('EARTH', cx + R + 6, cy + 3, mix(C.seriesA, 0.9));
    g.globalAlpha = 1;
    return;
  }

  g.strokeStyle = mix(C.live, detail ? 0.5 : 0.34);
  g.lineWidth = detail ? 0.9 : 0.7;
  for (const poly of LAND_REF.value) {
    g.beginPath();
    let pen = false;
    for (const [lo, la] of poly) {
      const p = F.P(geoVec(la, lo, RE, F.g));
      if (p[2] > 0) { pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; } else pen = false;
    }
    g.stroke();
  }

  g.strokeStyle = mix(C.chrome, 0.14); g.lineWidth = 0.7;
  for (let la = -60; la <= 60; la += 30) {
    g.beginPath(); let pen = false;
    for (let lo = -180; lo <= 180; lo += 6) {
      const p = F.P(geoVec(la, lo, RE, F.g));
      if (p[2] > 0) { pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; } else pen = false;
    }
    g.stroke();
  }
  for (let lo = 0; lo < 360; lo += 30) {
    g.beginPath(); let pen = false;
    for (let la = -90; la <= 90; la += 5) {
      const p = F.P(geoVec(la, lo, RE, F.g));
      if (p[2] > 0) { pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; } else pen = false;
    }
    g.stroke();
  }

  // aurora oval: space weather made visible at every geocentric scale
  const al = v.data.sw.aurLat;
  if (al > 20) {
    for (const lat of [al, -al]) {
      g.beginPath(); let pen = false;
      for (let lo = -180; lo <= 180; lo += 5) {
        const p = F.P(geoVec(lat, lo, RE * 1.02, F.g));
        if (p[2] > 0) { pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; } else pen = false;
      }
      g.strokeStyle = mix(C.live, 0.16 + v.data.sw.aurPow / 160);
      g.lineWidth = 2.2; g.stroke();
    }
  }
  g.globalAlpha = 1;
}

/* ═══ 5 · encounter radar ═════════════════════════════════════════ */
function drawEncounter(v: View, a: number, marks: Mark[]) {
  const F = geoFrame(v);
  drawEarth(F, v, a, false);
  const { cx, cy, ppk } = F;
  g.globalAlpha = a;

  for (let n = 1; n <= 6; n++) {
    const r = LD * n * ppk;
    if (r > Math.max(v.W, v.H)) break;
    ring(cx, cy, r, `${n} LD`, n === 1 ? mix(C.caution, 0.34) : mix(C.chrome, 0.13), n !== 1);
  }

  const e = ecl2eq(earthAU(v.simT));
  v.data.neo.forEach((o, i) => {
    const p = ecl2eq(neoPos(o, v.simT));
    const rel: Vec = [(p[0] - e[0]) * AU, (p[1] - e[1]) * AU, (p[2] - e[2]) * AU];
    let [x, y] = F.P(rel);
    const isSel = v.sel?.kind === 'neo' && v.sel.i === i;
    const nowLD = Math.hypot(rel[0], rel[1], rel[2]) / LD;
    const pad = 18;
    const off = x < pad || x > v.W - pad || y < pad || y > v.H - pad;
    if (off) {                       // clamp to the edge on its true bearing
      const dx = x - cx, dy = y - cy;
      const t = Math.min((v.W / 2 - pad) / Math.abs(dx || 1e-6), (v.H / 2 - pad) / Math.abs(dy || 1e-6));
      x = cx + dx * t; y = cy + dy * t;
    }
    const s = (off ? 3.6 : clamp(12 - o.h * 0.32, 3, 8)) * (isSel ? 1.5 : 1);
    diamond(x, y, s);
    g.fillStyle = isSel ? C.caution : o.dist < 0.01 ? C.hazard : C.caution;
    g.globalAlpha = a * (off ? 0.5 : 0.92);
    g.fill();
    if (isSel || (!off && o.dist < 0.02)) {
      const right = x > v.W * 0.82;
      g.textAlign = right ? 'right' : 'left';
      lbl(off ? `${o.des} · ${nowLD.toFixed(1)} LD` : o.des, x + (right ? -s - 6 : s + 5), y + 3,
        isSel ? C.caution : mix(C.hazard, 0.95));
      g.textAlign = 'left';
    }
    g.globalAlpha = a;
    marks.push({ kind: 'neo', i, x, y });
  });
  g.globalAlpha = 1;
}

/* ═══ 6 · geocentric map ══════════════════════════════════════════ */
const GRPC = { ISS: C.live, GPS: C.seriesA, GEO: C.caution, STL: C.seriesB, OWB: C.chromeDim } as const;

function drawGeo(v: View, a: number, marks: Mark[]) {
  const F = geoFrame(v);
  drawEarth(F, v, a, false);
  const { cx, cy, ppk } = F;
  const sw = v.data.sw;
  g.globalAlpha = a;

  ring(cx, cy, 42164 * ppk, 'GEO BELT 42,164 KM', mix(C.caution, 0.22));
  marks.push({ kind: 'landmark', i: 0, id: 'geobelt', x: cx + 42164 * ppk * 0.7, y: cy - 42164 * ppk * 0.7 });

  // magnetopause standoff, compressed by the live wind pressure
  const pdyn = 1.6726e-6 * (sw.dens || 3) * (sw.speed || 400) ** 2;
  const rmp = 10.5 * Math.pow(2.1 / Math.max(pdyn, 0.2), 1 / 6) * RE * ppk;
  const sd = sunDir(v.simT);
  const sp = F.P([sd[0] * RE, sd[1] * RE, sd[2] * RE]);
  const ang = Math.atan2(sp[1] - cy, sp[0] - cx);
  g.beginPath(); g.arc(cx, cy, rmp, ang - 1.15, ang + 1.15);
  g.strokeStyle = sw.bz < 0 ? mix(C.hazard, 0.4) : mix(C.seriesA, 0.34);
  g.lineWidth = 1.3; g.stroke();
  lbl(`MAGNETOPAUSE ${(rmp / ppk / RE).toFixed(1)} RE`,
    cx + Math.cos(ang) * rmp * 0.7, cy + Math.sin(ang) * rmp * 0.7,
    sw.bz < 0 ? mix(C.hazard, 0.8) : mix(C.seriesA, 0.75), 8.5);
  marks.push({ kind: 'landmark', i: 0, id: 'magnetopause',
    x: cx + Math.cos(ang) * rmp * 0.7, y: cy + Math.sin(ang) * rmp * 0.7 });

  drawSats(F, v, a, marks, 1);
  g.globalAlpha = 1;
}

/**
 * Satellites are drawn at every geocentric rung, not just the orbital one:
 * a Starlink sits 550 km up, which is well inside a 7,600 km surface view, so
 * leaving them out made the sky above the planet look empty when it is not.
 */
function drawSats(
  F: ReturnType<typeof geoFrame>, v: View, a: number, marks: Mark[],
  scale: number, hideOccluded = false,
) {
  const { cx, cy, ppk } = F;
  v.sats.forEach((s, i) => {
    const p = F.P(satPos(s, v.simT));
    const behind = p[2] < 0 && Math.hypot(p[0] - cx, p[1] - cy) < RE * ppk;
    // Close to the ground, a ghost behind the planet reads as noise, not depth.
    if (behind && hideOccluded) return;
    const isSel = v.sel?.kind === 'sat' && v.sel.i === i;
    g.globalAlpha = a * (behind ? 0.14 : 1);
    const col = isSel ? C.caution : GRPC[s.grp];
    satGlyph(p[0], p[1], s.grp, (s.grp === 'ISS' ? 2.4 : isSel ? 2.6 : 1.7) * scale, col);
    if (isSel) {
      g.strokeStyle = C.caution; g.lineWidth = 1;
      g.beginPath(); g.arc(p[0], p[1], 9, 0, TAU); g.stroke();
    }
    if (isSel || s.name === 'ISS (ZARYA)') {
      lbl(s.name, p[0] + 7, p[1] + 3, isSel ? C.caution : C.live);
    }
    marks.push({ kind: 'sat', i, x: p[0], y: p[1] });
  });
  g.globalAlpha = a;
}

/* ═══ 7 · surface watch ═══════════════════════════════════════════ */
function drawSurface(v: View, a: number, marks: Mark[]) {
  const F = geoFrame(v);
  drawEarth(F, v, a, true);
  drawSats(F, v, a, marks, 1.25, true);
  g.globalAlpha = a;
  const ph = (v.simT / 1500) % 1;

  v.data.eq.forEach((e, i) => {
    const p = F.P(geoVec(e.lat, e.lon, RE * 1.004, F.g));
    if (p[2] <= 0) return;
    const isSel = v.sel?.kind === 'quake' && v.sel.i === i;
    const base = (e.mag - 4) * 5 + 5;
    const t = (ph + i * 0.13) % 1;
    g.beginPath(); g.arc(p[0], p[1], base * (0.25 + t * 1.1), 0, TAU);
    g.strokeStyle = mix(C.hazard, (1 - t) * 0.75 * a); g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.arc(p[0], p[1], isSel ? 4 : 2.4, 0, TAU);
    g.fillStyle = isSel ? C.caution : e.dep < 70 ? C.hazard : C.caution; g.fill();
    if (isSel) lbl(`M${e.mag.toFixed(1)} · ${e.dep.toFixed(0)} KM`, p[0] + 7, p[1] - 5, C.caution, 9.5);
    marks.push({ kind: 'quake', i, x: p[0], y: p[1] });
  });

  // Route arcs first, so the aircraft sit on top of their own great circles.
  // This is what makes the traffic read as a network rather than loose specks.
  v.data.fl.forEach((f, i) => {
    if (f.origLat == null || f.destLat == null) return;
    const isSel = v.sel?.kind === 'flight' && v.sel.i === i;
    g.strokeStyle = isSel ? mix(C.caution, 0.95) : mix(C.seriesA, f.intl ? 0.42 : 0.18);
    g.lineWidth = isSel ? 1.6 : 0.8;
    greatCircle(F, f.origLat, f.origLon!, f.destLat, f.destLon!, RE * 1.01);
    if (isSel) {
      for (const [la, lo, tag] of [
        [f.origLat, f.origLon!, f.orig!], [f.destLat, f.destLon!, f.dest!],
      ] as [number, number, string][]) {
        const q = F.P(geoVec(la, lo, RE * 1.01, F.g));
        if (q[2] <= 0) continue;
        g.fillStyle = C.caution;
        g.beginPath(); g.arc(q[0], q[1], 3, 0, TAU); g.fill();
        lbl(tag, q[0] + 6, q[1] + 3, C.caution, 9);
      }
    }
  });

  v.data.fl.forEach((f, i) => {
    const p = F.P(geoVec(f.lat, f.lon, RE * (1 + (f.alt * 0.0003048) / RE), F.g));
    if (p[2] <= 0) return;
    const isSel = v.sel?.kind === 'flight' && v.sel.i === i;
    const n1 = F.P(geoVec(f.lat + 0.4, f.lon, RE, F.g));
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(Math.atan2(n1[1] - p[1], n1[0] - p[0]) + Math.PI / 2 + f.trk * RAD);
    planeGlyph(isSel ? 3.4 : 2.6);
    g.fillStyle = isSel ? C.caution : f.intl ? C.seriesA : mix(C.seriesA, 0.45);
    g.globalAlpha = a * (isSel ? 1 : 0.9);
    g.fill();
    g.restore();
    if (isSel) {
      lbl(`${f.flight} · FL${String(Math.round(f.alt / 100)).padStart(3, '0')}`,
        p[0] + 7, p[1] - 5, C.caution, 9.5);
    }
    marks.push({ kind: 'flight', i, x: p[0], y: p[1] });
  });

  const ob = v.observer;
  const bl = F.P(geoVec(ob.lat, ob.lon, RE * 1.002, F.g));
  if (bl[2] > 0) {
    g.globalAlpha = a;
    crosshair(bl[0], bl[1], 7, C.live);
    g.strokeStyle = mix(C.live, 0.5); g.lineWidth = 1;
    g.beginPath(); g.arc(bl[0], bl[1], 11, 0, TAU); g.stroke();
    const ns = ob.lat >= 0 ? 'N' : 'S', ew = ob.lon >= 0 ? 'E' : 'W';
    lbl(`${ob.label} ${Math.abs(ob.lat).toFixed(2)}${ns} ${Math.abs(ob.lon).toFixed(2)}${ew}`,
      bl[0] + 13, bl[1] + 4, mix(C.live, 0.95));
    lbl(ob.live ? 'YOU ARE HERE' : 'OBSERVER · DEFAULT', bl[0] + 13, bl[1] + 15, mix(C.live, 0.6), 8.5);
  }
  g.globalAlpha = 1;
}

/* ═══ frame ═══════════════════════════════════════════════════════ */
/** Coastlines are injected so the renderer stays free of a 37 KB import
 *  when a caller only needs the outer regimes. */
export const LAND_REF: { value: [number, number][][] } = { value: [] };

const DRAW = [
  (v: View, a: number, m: Mark[]) => drawGalactic(v, a, m),
  (v: View, a: number, m: Mark[]) => drawBubble(v, a, m),
  (v: View, a: number, m: Mark[]) => (v.focus ? drawSystem(v, a, m) : drawOort(v, a, m)),
  (v: View, a: number, m: Mark[]) => (v.focus ? drawSystem(v, a, m) : drawOuter(v, a, m)),
  (v: View, a: number, m: Mark[]) => (v.focus ? drawSystem(v, a, m) : drawHelio(v, a, m)),
  (v: View, a: number, m: Mark[]) => (v.focus ? drawSystem(v, a, m) : drawEncounter(v, a, m)),
  // The last two rungs are Earth's own surface and orbit; there is no honest
  // equivalent for a star we have never visited, so they stay empty when focused.
  (v: View, a: number, m: Mark[]) => (v.focus ? undefined : drawGeo(v, a, m)),
  (v: View, a: number, m: Mark[]) => (v.focus ? undefined : drawSurface(v, a, m)),
] as const;

export function drawFrame(ctx: CanvasRenderingContext2D, v: View): Mark[] {
  g = ctx;
  g.clearRect(0, 0, v.W, v.H);
  g.textAlign = 'left';
  const marks: Mark[] = [];
  // Real sky — but never while the Local Bubble is drawing, because that rung
  // renders the same catalogue as a 3-D volume. Both at once meant every star
  // appeared twice: one copy panning with the camera, one pinned at infinity,
  // which is exactly the "dots that don't move" artefact.
  const sky = clamp(alphaOf(2, v.L) + alphaOf(3, v.L) + alphaOf(4, v.L)
    + alphaOf(5, v.L) * 0.8 + alphaOf(6, v.L) * 0.4 + alphaOf(7, v.L) * 0.25, 0, 1);
  starSphere(v, sky * (1 - alphaOf(1, v.L)) * 0.85);
  for (let i = 0; i < REG.length; i++) {
    const a = alphaOf(i, v.L);
    if (a > 0.012) DRAW[i](v, a, marks);
  }
  return marks;
}
