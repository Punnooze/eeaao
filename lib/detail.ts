import { AU, diamM, isoZ, LD, PC, planElements, tMinus, type SatState } from './astro';
import type { Snapshot, System } from './types';
import { LANDMARKS, type Sel } from './draw';
import { PLANETS } from './astro';
import { STARS } from './stars';

export type Tone = 'live' | 'hazard' | 'caution' | 'series-a';
export type DetailRow = [string, string, Tone?];
export type Detail = {
  title: string;
  /** What kind of thing this is, so a readout is never just numbers. */
  kind: string;
  tone: Tone;
  rows: DetailRow[];
  jumpMs?: number;
};

/**
 * Rough spectral class from the catalogue's B−V colour index. Standard
 * main-sequence boundaries — enough to say "red dwarf" rather than "star",
 * which is the difference between a number and a fact.
 */
function spectralClass(ci: number) {
  if (ci < -0.05) return 'B-TYPE STAR · BLUE';
  if (ci < 0.30) return 'A-TYPE STAR · BLUE-WHITE';
  if (ci < 0.58) return 'F-TYPE STAR · WHITE';
  if (ci < 0.81) return 'G-TYPE STAR · SUN-LIKE';
  if (ci < 1.40) return 'K-TYPE STAR · ORANGE';
  return 'M-TYPE STAR · RED DWARF';
}

const SAT_KIND: Record<string, string> = {
  ISS: 'CREWED SPACE STATION',
  GPS: 'NAVIGATION SATELLITE',
  GEO: 'GEOSTATIONARY SATELLITE',
  STL: 'COMMS SATELLITE · STARLINK',
  OWB: 'COMMS SATELLITE · ONEWEB',
};

/** One selected object, rendered identically in the tooltip and the side log. */
export function detailOf(
  sel: Sel, d: Snapshot, sats: SatState[], simT: number, focus?: System | null,
): Detail | null {
  if (!sel) return null;

  if (sel.kind === 'landmark') {
    const lm = sel.id ? LANDMARKS[sel.id] : undefined;
    if (!lm) return null;
    return {
      title: lm.name, kind: 'STRUCTURE · NOT AN OBJECT', tone: 'caution',
      rows: lm.rows.map(([k, v], i) => [k, v, i === 0 ? 'live' : undefined] as DetailRow),
    };
  }

  if (sel.kind === 'system') {
    const sy = d.sys[sel.i];
    if (!sy) return null;
    const lum = sy.srad != null && sy.teff != null
      ? Math.pow(sy.srad, 2) * Math.pow(sy.teff / 5772, 4) : null;
    const rows: DetailRow[] = [
      ['Distance', `${(sy.dist * 3.26156).toFixed(2)} LY`, 'live'],
      ['Distance', `${sy.dist.toFixed(3)} PC`],
      ['Light travel', `${(sy.dist * 3.26156).toFixed(2)} YR`, 'caution'],
      ['Spectral type', sy.spect],
      ['Effective temp', sy.teff != null ? `${Math.round(sy.teff)} K` : 'UNKNOWN'],
      ['Radius', sy.srad != null ? `${sy.srad.toFixed(3)} R☉` : 'UNKNOWN'],
      ['Mass', sy.smass != null ? `${sy.smass.toFixed(3)} M☉` : 'UNKNOWN'],
      ['Luminosity', lum != null ? `${lum.toExponential(2)} L☉` : 'UNKNOWN'],
      ['Known planets', String(sy.planets.length), 'hazard'],
    ];
    for (const pl of sy.planets) {
      const short = pl.name.replace(sy.host, '').trim() || pl.name;
      const bits = [
        pl.a != null ? `${pl.a < 0.1 ? pl.a.toFixed(4) : pl.a.toFixed(3)} AU` : null,
        pl.period != null ? `${pl.period < 100 ? pl.period.toFixed(2) : Math.round(pl.period)} D` : null,
        pl.rade != null ? `${pl.rade.toFixed(2)} R⊕` : null,
      ].filter(Boolean).join(' · ');
      rows.push([short, bits || 'PARAMETERS UNPUBLISHED', 'series-a']);
    }
    return {
      title: sy.host,
      kind: `PLANETARY SYSTEM · ${sy.planets.length} PLANET${sy.planets.length === 1 ? '' : 'S'}`,
      tone: 'caution', rows,
    };
  }

  if (sel.kind === 'planetX') {
    const pl = focus?.planets[sel.i];
    if (!pl || !focus) return null;
    const rows: DetailRow[] = [
      ['Host', `${focus.host} · ${focus.spect}`, 'live'],
      ['System distance', `${(focus.dist * 3.26156).toFixed(2)} LY`],
      ['Semi-major axis', pl.a != null
        ? `${pl.a < 0.1 ? pl.a.toFixed(5) : pl.a.toFixed(4)} AU` : 'UNPUBLISHED', 'caution'],
      ['Orbital period', pl.period != null
        ? `${pl.period < 100 ? pl.period.toFixed(3) : Math.round(pl.period)} D` : 'UNPUBLISHED'],
      ['Radius', pl.rade != null ? `${pl.rade.toFixed(2)} R⊕` : 'UNPUBLISHED'],
      ['Mass', pl.masse != null ? `${pl.masse.toFixed(2)} M⊕` : 'UNPUBLISHED'],
      ['Equilibrium temp', pl.eqt != null ? `${Math.round(pl.eqt)} K` : 'UNPUBLISHED'],
      ['Discovered', pl.year != null ? `${pl.year} · ${pl.method.toUpperCase()}` : pl.method.toUpperCase()],
    ];
    if (pl.a != null) {
      rows.push(['Distance from star',
        `${Math.round(pl.a * AU).toLocaleString('en-US')} KM`]);
    }
    return { title: pl.name, kind: 'EXOPLANET · CONFIRMED', tone: 'series-a', rows };
  }

  if (sel.kind === 'tno') {
    const o = d.tno[sel.i];
    if (!o) return null;
    const periodYr = Math.pow(o.a, 1.5);
    return {
      title: o.name,
      kind: `TRANS-NEPTUNIAN OBJECT · ${o.cls}`,
      tone: 'series-a',
      rows: [
        ['Semi-major axis', `${o.a.toFixed(2)} AU`, 'live'],
        ['Perihelion', `${(o.a * (1 - o.e)).toFixed(2)} AU`],
        ['Aphelion', `${(o.a * (1 + o.e)).toFixed(2)} AU`],
        ['Eccentricity', o.e.toFixed(4)],
        ['Inclination', `${o.i.toFixed(2)}°`],
        ['Period', `${periodYr.toFixed(0)} YR`, 'caution'],
        ['Absolute mag H', o.h.toFixed(2)],
        ['Est. diameter', `${(diamM(o.h) / 1000).toFixed(0)} KM`],
        ['Class', o.cls],
      ],
    };
  }

  if (sel.kind === 'neo') {
    const o = d.neo[sel.i];
    if (!o) return null;
    return {
      title: `${o.des} · ${tMinus(o.cdMs, simT)}`,
      kind: `NEAR-EARTH ASTEROID · CLASS ${o.cls}`,
      tone: 'hazard',
      jumpMs: o.cdMs,
      rows: [
        ['Closest approach', o.cd, 'live'],
        ['Miss distance', `${((o.dist * AU) / LD).toFixed(3)} LD`, 'hazard'],
        ['Miss distance', `${Math.round(o.dist * AU).toLocaleString('en-US')} KM`],
        ['Relative velocity', `${o.v.toFixed(2)} KM/S`],
        ['Absolute mag H', o.h.toFixed(1)],
        ['Est. diameter', `${diamM(o.h).toFixed(0)} M`],
        ['Semi-major axis', `${o.a.toFixed(4)} AU`],
        ['Eccentricity', o.e.toFixed(4)],
        ['Inclination', `${o.i.toFixed(2)}°`],
        ['Period', `${o.per.toFixed(1)} D`],
      ],
    };
  }

  if (sel.kind === 'sat') {
    const s = sats[sel.i];
    if (!s) return null;
    return {
      title: s.name,
      kind: SAT_KIND[s.grp] ?? 'SATELLITE',
      tone: 'live',
      rows: [
        ['Mean altitude', `${Math.round(s.alt).toLocaleString('en-US')} KM`, 'live'],
        ['Semi-major axis', `${Math.round(s.a).toLocaleString('en-US')} KM`],
        ['Inclination', `${s.inc.toFixed(3)}°`],
        ['Eccentricity', s.ecc.toFixed(5)],
        ['Period', `${s.per.toFixed(1)} MIN`],
        ['Node drift', `${(s.dRaanDeg * 86400).toFixed(3)}°/D`],
        ['Element epoch', isoZ(s.epochMs)],
      ],
    };
  }

  if (sel.kind === 'quake') {
    const e = d.eq[sel.i];
    if (!e) return null;
    return {
      title: `M${e.mag.toFixed(1)} · ${e.place}`,
      kind: e.dep < 70 ? 'EARTHQUAKE · SHALLOW FOCUS' : 'EARTHQUAKE · DEEP FOCUS',
      tone: 'hazard',
      rows: [
        ['Magnitude', `M ${e.mag.toFixed(1)}`, 'hazard'],
        ['Depth', `${e.dep.toFixed(1)} KM`],
        ['Latitude', `${e.lat.toFixed(3)}°`],
        ['Longitude', `${e.lon.toFixed(3)}°`],
        ['Origin time', isoZ(e.time), 'live'],
      ],
    };
  }

  if (sel.kind === 'flight') {
    const f = d.fl[sel.i];
    if (!f) return null;
    const rows: DetailRow[] = [
      ['Flight level', `FL${String(Math.round(f.alt / 100)).padStart(3, '0')}`, 'series-a'],
    ];
    if (f.orig && f.dest) {
      rows.push([
        'Route',
        `${f.orig} → ${f.dest}`,
        f.intl ? 'hazard' : 'live',
      ]);
      rows.push(['Crossing', f.intl ? `${f.origCountry} → ${f.destCountry}` : 'DOMESTIC']);
    } else {
      rows.push(['Route', 'UNRESOLVED', 'caution']);
    }
    if (f.airline) rows.push(['Operator', f.airline.toUpperCase().slice(0, 22)]);
    rows.push(
      ['Altitude', `${f.alt.toLocaleString('en-US')} FT`],
      ['Ground speed', `${f.gs} KT`],
      ['Track', `${String(f.trk).padStart(3, '0')}°`],
      ['Position', `${f.lat.toFixed(2)}° ${f.lon.toFixed(2)}°`],
      ['ICAO hex', f.hex.toUpperCase()],
    );
    return {
      title: `${f.flight} · ${f.type}`,
      kind: f.intl === true ? 'AIRCRAFT · INTERNATIONAL'
        : f.intl === false ? 'AIRCRAFT · DOMESTIC' : 'AIRCRAFT · ROUTE UNRESOLVED',
      tone: 'series-a', rows,
    };
  }

  if (sel.kind === 'star') {
    const s = STARS[sel.i];
    if (!s) return null;
    const pc = Math.hypot(s[0], s[1], s[2]);
    return {
      title: s[5] || `HYG ${sel.i}`,
      kind: spectralClass(s[4]),
      tone: 'live',
      rows: [
        ['Distance', `${(pc * 3.26156).toFixed(2)} LY`, 'live'],
        ['Distance', `${pc.toFixed(2)} PC`],
        ['Distance', `${Math.round((pc * PC) / AU).toLocaleString('en-US')} AU`],
        ['Apparent mag', s[3].toFixed(2)],
        ['Colour index B−V', s[4].toFixed(2)],
        ['Light travel', `${(pc * 3.26156).toFixed(2)} YR`, 'caution'],
      ],
    };
  }

  const p = PLANETS[sel.i];
  if (!p) return null;
  const el = planElements(p, simT);
  return {
    title: p.n,
    kind: sel.i < 4 ? 'PLANET · INNER SYSTEM' : 'PLANET · OUTER SYSTEM',
    tone: 'caution',
    rows: [
      ['Semi-major axis', `${el.a.toFixed(5)} AU`, 'live'],
      ['Semi-major axis', `${Math.round(el.a * AU).toLocaleString('en-US')} KM`],
      ['Eccentricity', el.e.toFixed(5)],
      ['Perihelion', `${(el.a * (1 - el.e)).toFixed(4)} AU`],
      ['Aphelion', `${(el.a * (1 + el.e)).toFixed(4)} AU`],
      ['Inclination', `${el.I.toFixed(4)}°`],
      ['Period', `${el.periodYr.toFixed(3)} YR`],
      ['Mean anomaly now', `${el.M.toFixed(2)}°`, 'caution'],
      ['Light time from sun', `${((el.a * AU) / 299792.458 / 60).toFixed(1)} MIN`],
    ],
  };
}
