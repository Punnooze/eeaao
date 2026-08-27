import type { Neo, SatTle } from './types';

export const RAD = Math.PI / 180;
export const AU = 149597870.7;      // km
export const RE = 6378.137;         // km, equatorial
export const LD = 384400;           // km, lunar distance
export const PC = 3.0856776e13;     // km, parsec
export const LY = 9.4607305e12;     // km, light year
export const MU_E = 398600.4418;    // km³/s²
export const MU_S = 2.959122082855911e-4; // AU³/day²
export const J2 = 0.00108263;
export const OBL = 23.4392911 * RAD;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export type Vec = [number, number, number];
export const cross = (a: Vec, b: Vec): Vec =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec): Vec => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};

/* ── time ─────────────────────────────────────────────────────── */
export const jd = (ms: number) => ms / 86400000 + 2440587.5;

export const gmst = (ms: number) => {
  const d = jd(ms) - 2451545.0, T = d / 36525;
  return (((280.46061837 + 360.98564736629 * d + 3.87933e-4 * T * T) % 360) + 360) % 360;
};

const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export const isoZ = (ms: number) => {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${MON[d.getUTCMonth()]}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
};

export const tMinus = (targetMs: number, nowMs: number) => {
  let d = targetMs - nowMs;
  const sg = d < 0 ? 'T+' : 'T−';
  d = Math.abs(d);
  const dy = Math.floor(d / 86400000), hr = Math.floor(d / 3600000) % 24, mi = Math.floor(d / 60000) % 60;
  return dy
    ? `${sg} ${dy}D ${String(hr).padStart(2, '0')}H`
    : `${sg} ${String(hr).padStart(2, '0')}H ${String(mi).padStart(2, '0')}M`;
};

const CDM: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
/** JPL calendar date → epoch ms. "2026-Oct-31 02:35" */
export const cdToMs = (cd: string) => {
  const [d, t] = cd.split(' ');
  const [y, mo, da] = d.split('-');
  const [hh, mm] = (t ?? '00:00').split(':');
  return Date.UTC(+y, CDM[mo] ?? 0, +da, +hh, +mm);
};

/* ── two-body ─────────────────────────────────────────────────── */
/** Classical elements → position in the same length unit as `a`. M in radians. */
export function kepler(a: number, e: number, iDeg: number, omDeg: number, wDeg: number, M: number): Vec {
  let E = M;
  for (let k = 0; k < 7; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = Math.cos(E) - e, yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const nu = Math.atan2(yv, xv), r = a * (1 - e * Math.cos(E));
  const i = iDeg * RAD, om = omDeg * RAD, u = wDeg * RAD + nu;
  const cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(i), si = Math.sin(i);
  return [
    r * (Math.cos(om) * cu - Math.sin(om) * su * ci),
    r * (Math.sin(om) * cu + Math.cos(om) * su * ci),
    r * (su * si),
  ];
}

export const ecl2eq = (v: Vec): Vec =>
  [v[0], v[1] * Math.cos(OBL) - v[2] * Math.sin(OBL), v[1] * Math.sin(OBL) + v[2] * Math.cos(OBL)];

/* ── satellites ───────────────────────────────────────────────── */
export type SatState = SatTle & {
  n: number;          // rad/s
  a: number;          // km
  alt: number;        // km, mean
  per: number;        // minutes
  dRaanDeg: number;   // deg/s, J2 nodal regression
};

/**
 * TLE mean elements plus J2 nodal regression. Deliberately not SGP4: no drag,
 * no short-period terms. Good to tens of km, which is sub-pixel at every
 * regime this app draws.
 */
export function deriveSat(t: SatTle): SatState {
  const n = (t.nrev * 2 * Math.PI) / 86400;
  const a = Math.cbrt(MU_E / (n * n));
  const p = a * (1 - t.ecc * t.ecc);
  const dRaanDeg = -1.5 * n * J2 * (RE / p) ** 2 * Math.cos(t.inc * RAD) * (180 / Math.PI);
  return { ...t, n, a, alt: a - RE, per: 1440 / t.nrev, dRaanDeg };
}

export const satPos = (s: SatState, tMs: number): Vec => {
  const dt = (tMs - s.epochMs) / 1000;
  return kepler(s.a, s.ecc, s.inc, s.raan + s.dRaanDeg * dt, s.argp, s.ma * RAD + s.n * dt);
};

/* ── asteroids ────────────────────────────────────────────────── */
export const neoMeanMotion = (o: Neo) => (2 * Math.PI) / o.per;   // rad/day
export const neoPos = (o: Neo, tMs: number): Vec =>
  kepler(o.a, o.e, o.i, o.om, o.w, o.ma * RAD + neoMeanMotion(o) * (jd(tMs) - o.epoch));

/* ── planets ────────────────────────────────────────────────────
   JPL's "Approximate Positions of the Planets": Keplerian elements at
   J2000 plus per-century rates, good to arcminutes over 1800–2050.
   Replaces the circular mean-longitude fudge that was here before, so
   real eccentricity now shows — Mars visibly off-centre, Neptune's
   orbit no longer a perfect ring.
   Columns: a(AU), e, I(deg), L(deg), longPeri(deg), longNode(deg),
   each with its rate per Julian century. */
type PlanElem = readonly [number, number];
export type Planet = {
  n: string;
  a: PlanElem; e: PlanElem; I: PlanElem; L: PlanElem; peri: PlanElem; node: PlanElem;
};

export const PLANETS: Planet[] = [
  { n: 'MERCURY',
    a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749],
    L: [252.25032350, 149472.67411175], peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
  { n: 'VENUS',
    a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890],
    L: [181.97909950, 58517.81538729], peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
  { n: 'EARTH',
    a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0, 0] },
  { n: 'MARS',
    a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
  { n: 'JUPITER',
    a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775], peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
  { n: 'SATURN',
    a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201], peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] },
  { n: 'URANUS',
    a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939],
    L: [313.23810451, 428.48202785], peri: [170.95427630, 0.40805281], node: [74.01692503, 0.04240589] },
  { n: 'NEPTUNE',
    a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372],
    L: [-55.12002969, 218.45945325], peri: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664] },
];

const wrap180 = (d: number) => { const x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

/** Elements of a planet at an instant, plus the derived argument and anomaly. */
export function planElements(p: Planet, tMs: number) {
  const T = (jd(tMs) - 2451545.0) / 36525;
  const at = (v: PlanElem) => v[0] + v[1] * T;
  const a = at(p.a), e = at(p.e), I = at(p.I);
  const node = at(p.node);
  const w = at(p.peri) - node;                 // argument of perihelion
  const M = wrap180(at(p.L) - at(p.peri));     // mean anomaly
  return { a, e, I, node, w, M, periodYr: Math.pow(a, 1.5) };
}

export const planPos = (p: Planet, tMs: number): Vec => {
  const el = planElements(p, tMs);
  return kepler(el.a, el.e, el.I, el.node, el.w, el.M * RAD);
};

/** One full orbit as a point list, at the epoch's elements. */
export function planOrbit(p: Planet, tMs: number, steps = 96): Vec[] {
  const el = planElements(p, tMs);
  return Array.from({ length: steps + 1 }, (_, k) =>
    kepler(el.a, el.e, el.I, el.node, el.w, (k / steps) * Math.PI * 2));
}

/** Measured and modelled boundaries of the solar system, in AU. */
export const BOUNDS = {
  kuiperInner: 30,
  kuiperOuter: 50,
  terminationShock: 94,   // Voyager 1 crossing, 2004
  heliopause: 123,        // Voyager 1 crossing, 2012-AUG
  oortInner: 2000,
  oortOuter: 100000,
} as const;

export const earthAU = (tMs: number) => planPos(PLANETS[2], tMs);
export const INNER = 4;   // planets 0..3 are the inner system
export const sunDir = (tMs: number): Vec => {
  const e = ecl2eq(earthAU(tMs));
  return norm([-e[0], -e[1], -e[2]]);
};

/* ── camera ───────────────────────────────────────────────────── */
export type Basis = { v: Vec; r: Vec; u: Vec };
export function basis(latDeg: number, lonDeg: number): Basis {
  const la = latDeg * RAD, lo = lonDeg * RAD;
  const v: Vec = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let r = cross([0, 0, 1], v);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-7) r = [1, 0, 0];
  r = norm(r);
  return { v, r, u: cross(v, r) };
}

/** Geographic lat/lon at radius r → ECI, given GMST in degrees. */
export const geoVec = (lat: number, lon: number, rKm: number, g: number): Vec => {
  const la = lat * RAD, lo = (lon + g) * RAD;
  return [rKm * Math.cos(la) * Math.cos(lo), rKm * Math.cos(la) * Math.sin(lo), rKm * Math.sin(la)];
};

/* ── formatting ───────────────────────────────────────────────── */
export const fmtDist = (km: number) =>
  km >= 0.004 * AU
    ? (km / AU).toPrecision(3).replace(/0+$/, '').replace(/\.$/, '') + ' AU'
    : km >= 1.4 * LD
      ? (km / LD).toFixed(1) + ' LD'
      : km >= 1000
        ? Math.round(km).toLocaleString('en-US') + ' KM'
        : km.toFixed(0) + ' KM';

/** Diameter estimate from absolute magnitude at the usual 0.15 albedo. */
export const diamM = (h: number) => (1329 / Math.sqrt(0.15)) * Math.pow(10, -0.2 * h) * 1000;
