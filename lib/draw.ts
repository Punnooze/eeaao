import {
  AU, BOUNDS, INNER, LD, LY, PC, PLANETS, RE, RAD, basis, clamp, diamM, dot, earthAU,
  ecl2eq, geoVec, gmst, kepler, neoPos, norm, planPos, satPos, sunDir,
  type SatState, type Vec,
} from './astro';
import { alphaOf, REG } from './regimes';
import { STARS } from './stars';
import type { Snapshot } from './types';

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

export type MarkKind = 'star' | 'neo' | 'sat' | 'quake' | 'flight' | 'planet';
export type Mark = { kind: MarkKind; i: number; x: number; y: number };
export type Sel = { kind: MarkKind; i: number } | null;

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

export function anchorAt(L: number, simT: number): Vec {
  const e = ecl2eq(earthAU(simT));
  const earthKm: Vec = [e[0] * AU, e[1] * AU, e[2] * AU];
  const toSol = lerp3(GC_KM, [0, 0, 0], bandT(L, GC_TO_SOL));
  return lerp3(toSol, earthKm, bandT(L, SOL_TO_EARTH));
}

/** What the view is currently centred on, for the readout. */
export function anchorLabel(L: number) {
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
  const ppk = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L);
  const cx = v.W * 0.5, cy = v.H * 0.52;
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
  const ppk = Math.min(v.W, v.H) * 0.46 / Math.pow(10, v.L);
  const e = ecl2eq(earthAU(v.simT));
  const d: Vec = [e[0] * AU - v.anchor[0], e[1] * AU - v.anchor[1], e[2] * AU - v.anchor[2]];
  const cx = v.W * 0.5 + dot(d, b.r) * ppk;
  const cy = v.H * 0.52 - dot(d, b.u) * ppk;
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
/** B−V colour index → an approximate stellar colour. */
function starColor(ci: number) {
  if (ci < 0.0) return '#a9c6ff';
  if (ci < 0.3) return '#cfe0ff';
  if (ci < 0.6) return '#f6f4ea';
  if (ci < 0.9) return '#ffe9b0';
  if (ci < 1.4) return '#ffc078';
  return '#ff9a6a';
}

const stars2d = Array.from({ length: 300 }, (_, i) => {
  let s = 9301 * i + 49297;
  const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return [r(), r(), 0.1 + r() * 0.4] as const;
});
function backdrop(v: View, a: number) {
  if (a <= 0.01) return;
  g.globalAlpha = a;
  for (const [x, y, b] of stars2d) {
    g.fillStyle = mix(C.bone, b);
    g.fillRect((x * v.W) | 0, (y * v.H) | 0, 1, 1);
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

  crosshair(cx, cy, 10, C.live);
  lbl('SOL · YOU ARE HERE', cx + 14, cy + 4, C.live, 9.5);
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

function drawOort(v: View, a: number) {
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
  [5000, 10000, 20000].forEach(r =>
    ring(cx, cy, r * ppa, `${r.toLocaleString('en-US')} AU`, mix(C.chrome, 0.13)));
  ring(cx, cy, BOUNDS.heliopause * ppa, 'HELIOPAUSE', mix(C.seriesA, 0.4), false);

  // bearing to the nearest star, with its real distance
  const prox = STARS.reduce((best, s) => {
    const d = Math.hypot(s[0], s[1], s[2]);
    return d < best.d ? { d, s } : best;
  }, { d: Infinity, s: STARS[0] });
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

  // Kuiper belt band
  g.fillStyle = mix(C.chromeDim, 0.5);
  let z = 5150;
  const rnd = () => (z = (z * 48271) % 2147483647) / 2147483647;
  for (let k = 0; k < 700; k++) {
    const th = rnd() * TAU;
    const r = BOUNDS.kuiperInner + rnd() * (BOUNDS.kuiperOuter - BOUNDS.kuiperInner);
    const p = P([Math.cos(th) * r, Math.sin(th) * r, (rnd() - 0.5) * 6]);
    g.fillRect(p[0], p[1], 1.2, 1.2);
  }
  ring(cx, cy, BOUNDS.terminationShock * ppa, `TERMINATION SHOCK ${BOUNDS.terminationShock} AU`, mix(C.seriesA, 0.28));
  ring(cx, cy, BOUNDS.heliopause * ppa, `HELIOPAUSE ${BOUNDS.heliopause} AU · V1 2012`, mix(C.seriesA, 0.42));

  PLANETS.forEach((pl, i) => {
    if (i < INNER) return;
    g.beginPath();
    for (let k = 0; k <= 96; k++) {
      const th = (k / 96) * TAU;
      const p = P([pl.a * Math.cos(th), pl.a * Math.sin(th), 0]);
      k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    }
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
    for (let k = 0; k <= 72; k++) {
      const th = (k / 72) * TAU;
      const p = P([pl.a * Math.cos(th), pl.a * Math.sin(th), 0]);
      k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    }
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

  v.sats.forEach((s, i) => {
    const p = F.P(satPos(s, v.simT));
    const behind = p[2] < 0 && Math.hypot(p[0] - cx, p[1] - cy) < RE * ppk;
    const isSel = v.sel?.kind === 'sat' && v.sel.i === i;
    g.globalAlpha = a * (behind ? 0.16 : 1);
    g.fillStyle = isSel ? C.caution : GRPC[s.grp];
    if (s.grp === 'ISS') {
      g.fillRect(p[0] - 3.2, p[1] - 1, 6.4, 2);
      g.fillRect(p[0] - 1, p[1] - 2.6, 2, 5.2);
    } else {
      const w = isSel ? 4 : 2.4;
      g.fillRect(p[0] - w / 2, p[1] - w / 2, w, w);
      if (isSel) {
        g.strokeStyle = C.caution; g.lineWidth = 1;
        g.beginPath(); g.arc(p[0], p[1], 7, 0, TAU); g.stroke();
      }
    }
    if (isSel || s.name === 'ISS (ZARYA)') {
      lbl(s.name, p[0] + 7, p[1] + 3, isSel ? C.caution : C.live);
    }
    marks.push({ kind: 'sat', i, x: p[0], y: p[1] });
  });
  g.globalAlpha = 1;
}

/* ═══ 7 · surface watch ═══════════════════════════════════════════ */
export const OBSERVER = { lat: 12.97, lon: 77.59, name: 'BLR' };

function drawSurface(v: View, a: number, marks: Mark[]) {
  const F = geoFrame(v);
  drawEarth(F, v, a, true);
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

  v.data.fl.forEach((f, i) => {
    const p = F.P(geoVec(f.lat, f.lon, RE * (1 + (f.alt * 0.0003048) / RE), F.g));
    if (p[2] <= 0) return;
    const isSel = v.sel?.kind === 'flight' && v.sel.i === i;
    const n1 = F.P(geoVec(f.lat + 0.4, f.lon, RE, F.g));
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(Math.atan2(n1[1] - p[1], n1[0] - p[0]) + Math.PI / 2 + f.trk * RAD);
    g.beginPath();
    g.moveTo(0, -4.4); g.lineTo(3, 3.4); g.lineTo(0, 1.6); g.lineTo(-3, 3.4);
    g.closePath();
    g.fillStyle = isSel ? C.caution : C.seriesA;
    g.globalAlpha = a * (isSel ? 1 : 0.85);
    g.fill();
    g.restore();
    if (isSel) {
      lbl(`${f.flight} · FL${String(Math.round(f.alt / 100)).padStart(3, '0')}`,
        p[0] + 7, p[1] - 5, C.caution, 9.5);
    }
    marks.push({ kind: 'flight', i, x: p[0], y: p[1] });
  });

  const bl = F.P(geoVec(OBSERVER.lat, OBSERVER.lon, RE * 1.002, F.g));
  if (bl[2] > 0) {
    g.globalAlpha = a;
    crosshair(bl[0], bl[1], 6, C.live);
    lbl(`${OBSERVER.name} ${OBSERVER.lat}N ${OBSERVER.lon}E`, bl[0] + 9, bl[1] + 11, mix(C.live, 0.9));
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
  (v: View, a: number) => drawOort(v, a),
  (v: View, a: number, m: Mark[]) => drawOuter(v, a, m),
  (v: View, a: number, m: Mark[]) => drawHelio(v, a, m),
  (v: View, a: number, m: Mark[]) => drawEncounter(v, a, m),
  (v: View, a: number, m: Mark[]) => drawGeo(v, a, m),
  (v: View, a: number, m: Mark[]) => drawSurface(v, a, m),
] as const;

export function drawFrame(ctx: CanvasRenderingContext2D, v: View): Mark[] {
  g = ctx;
  g.clearRect(0, 0, v.W, v.H);
  g.textAlign = 'left';
  const marks: Mark[] = [];
  // 2-D field only where a real star volume is not already carrying the sky
  backdrop(v, clamp(alphaOf(2, v.L) + alphaOf(3, v.L) + alphaOf(4, v.L) * 0.9
    + alphaOf(5, v.L) * 0.7 + alphaOf(6, v.L) * 0.35, 0, 1) * 0.9);
  for (let i = 0; i < REG.length; i++) {
    const a = alphaOf(i, v.L);
    if (a > 0.012) DRAW[i](v, a, marks);
  }
  return marks;
}
