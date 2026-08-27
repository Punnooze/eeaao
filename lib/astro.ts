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
   Circular orbits from mean longitudes at J2000. Good to about a degree,
   which is a pixel or two at every scale drawn here. Labelled MEAN ELEMENTS
   in the provenance panel rather than passed off as an ephemeris. */
export const PLANETS = [
  { n: 'MERCURY', a: 0.38710,  L0: 252.25084, dL: 4.09233445 },
  { n: 'VENUS',   a: 0.72333,  L0: 181.97973, dL: 1.60213034 },
  { n: 'EARTH',   a: 1.00000,  L0: 100.46435, dL: 0.98560912 },
  { n: 'MARS',    a: 1.52368,  L0: 355.45332, dL: 0.52403304 },
  { n: 'JUPITER', a: 5.20260,  L0: 34.40438,  dL: 0.08308676 },
  { n: 'SATURN',  a: 9.55491,  L0: 49.94432,  dL: 0.03344414 },
  { n: 'URANUS',  a: 19.21845, L0: 313.23218, dL: 0.01172834 },
  { n: 'NEPTUNE', a: 30.11039, L0: 304.88003, dL: 0.00598103 },
] as const;

/** Measured and modelled boundaries of the solar system, in AU. */
export const BOUNDS = {
  kuiperInner: 30,
  kuiperOuter: 50,
  terminationShock: 94,   // Voyager 1 crossing, 2004
  heliopause: 123,        // Voyager 1 crossing, 2012-AUG
  oortInner: 2000,
  oortOuter: 100000,
} as const;

export const planPos = (p: (typeof PLANETS)[number], tMs: number): Vec => {
  const th = (p.L0 + p.dL * (jd(tMs) - 2451545.0)) * RAD;
  return [p.a * Math.cos(th), p.a * Math.sin(th), 0];
};
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
