import { AU, clamp, LY, PC } from './astro';

/**
 * The whole view is one scalar: L = log10(half-width in km).
 *
 * Scrolling moves L at a constant rate, so one notch of wheel is a constant
 * RATIO of distance — thousands of light years out at the galactic scale, a few
 * hundred metres at the ground. Detents sit at their true log positions, which
 * is why the ladder rungs are unevenly spaced: that spacing IS the data.
 *
 * `tag` is the provenance class the UI shows, because these eight rungs are not
 * equally trustworthy and the console should say so.
 */
export type RegimeTag = 'SCHEMATIC' | 'CATALOGUE' | 'MODELLED' | 'MEAN ELEMENTS' | 'PROPAGATED' | 'LIVE';

export const REG = ([
  { key: 'GALACTIC', tab: 'Galactic Plane',  hw: 30000 * LY,   tag: 'SCHEMATIC' },
  { key: 'BUBBLE',   tab: 'Local Bubble',    hw: 500 * LY,     tag: 'CATALOGUE' },
  { key: 'OORT',     tab: 'Oort Shell',      hw: 20000 * AU,   tag: 'MODELLED' },
  { key: 'OUTER',    tab: 'Outer System',    hw: 60 * AU,      tag: 'MEAN ELEMENTS' },
  { key: 'HELIO',    tab: 'Heliosphere',     hw: 1.9 * AU,     tag: 'LIVE' },
  { key: 'NEO',      tab: 'Encounter Radar', hw: 0.025 * AU,   tag: 'PROPAGATED' },
  { key: 'GEO',      tab: 'Geocentric Map',  hw: 62000,        tag: 'PROPAGATED' },
  { key: 'SURF',     tab: 'Surface Watch',   hw: 4200,         tag: 'LIVE' },
] as const satisfies readonly { key: string; tab: string; hw: number; tag: RegimeTag }[])
  .map(r => ({ ...r, L: Math.log10(r.hw) }));

export type Regime = (typeof REG)[number];
export const N_REG = REG.length;

export const LMAX = REG[0].L + 0.3;
export const LMIN = REG[N_REG - 1].L - 0.3;

/** Decades of travel per pixel of wheel. The entire non-linearity is this line. */
export const DEC_PER_PX = 0.0038;

/**
 * Crossfade weight for one regime. Falloff is the gap to the neighbour on
 * whichever side we are on, so weights always sum to at least 1 and unevenly
 * spaced detents never leave a dead band.
 */
export function alphaOf(i: number, L: number) {
  const d = L - REG[i].L;
  // Sitting exactly on the detent is full weight, and must be handled before
  // the branch below: at d === 0 the else-arm indexes REG[i + 1], which does
  // not exist for the last rung.
  if (d === 0) return 1;
  // The first and last rungs have nothing to crossfade to on their outer side,
  // so they hold full weight past their own detent. Without this, zooming in
  // beyond the surface rung faded the planet toward black for no reason.
  if (d > 0 && i === 0) return 1;
  if (d < 0 && i === N_REG - 1) return 1;
  const gap = d > 0 ? REG[i - 1].L - REG[i].L : REG[i].L - REG[i + 1].L;
  return clamp(1 - Math.abs(d) / gap, 0, 1);
}

export function dominant(L: number) {
  let best = 0, bestA = -1;
  for (let i = 0; i < N_REG; i++) {
    const a = alphaOf(i, L);
    if (a > bestA) { bestA = a; best = i; }
  }
  return best;
}

/** Fraction down the ladder rail; 0 is the widest view. */
export const railFrac = (L: number) => (LMAX - L) / (LMAX - LMIN);

/**
 * Adaptive scale readout. toPrecision is unusable here: it renders 30,000 as
 * "3.00e+4", and stripping its trailing zeros turns 500 into 5.
 */
const sig = (v: number) =>
  v >= 100 ? Math.round(v).toLocaleString('en-US')
    : v >= 10 ? v.toFixed(1).replace(/\.0$/, '')
      : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, '')
        : v.toFixed(3).replace(/0+$/, '');

export function fmtScale(km: number) {
  if (km >= 0.4 * LY) return `${sig(km / LY)} LY`;
  if (km >= 900 * AU) return `${Math.round(km / AU).toLocaleString('en-US')} AU`;
  if (km >= 0.004 * AU) return `${sig(km / AU)} AU`;
  if (km >= 1.4 * 384400) return `${sig(km / 384400)} LD`;
  return `${Math.round(km).toLocaleString('en-US')} KM`;
}

export { PC };
