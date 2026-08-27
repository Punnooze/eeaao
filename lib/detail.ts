import { AU, diamM, isoZ, LD, PC, tMinus, type SatState } from './astro';
import type { Snapshot } from './types';
import type { Sel } from './draw';
import { PLANETS } from './astro';
import { STARS } from './stars';

export type DetailRow = [string, string, ('live' | 'hazard' | 'caution' | 'series-a')?];
export type Detail = { title: string; rows: DetailRow[]; jumpMs?: number };

/** One selected object, rendered identically in the tooltip and the side log. */
export function detailOf(sel: Sel, d: Snapshot, sats: SatState[], simT: number): Detail | null {
  if (!sel) return null;

  if (sel.kind === 'neo') {
    const o = d.neo[sel.i];
    if (!o) return null;
    return {
      title: `${o.des} · ${o.cls} · ${tMinus(o.cdMs, simT)}`,
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
      title: `${s.name} · ${s.grp}`,
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
    return {
      title: `${f.flight} · ${f.type}`,
      rows: [
        ['Flight level', `FL${String(Math.round(f.alt / 100)).padStart(3, '0')}`, 'series-a'],
        ['Altitude', `${f.alt.toLocaleString('en-US')} FT`],
        ['Ground speed', `${f.gs} KT`],
        ['Track', `${String(f.trk).padStart(3, '0')}°`],
        ['Latitude', `${f.lat.toFixed(3)}°`],
        ['Longitude', `${f.lon.toFixed(3)}°`],
      ],
    };
  }

  if (sel.kind === 'star') {
    const s = STARS[sel.i];
    if (!s) return null;
    const pc = Math.hypot(s[0], s[1], s[2]);
    return {
      title: s[5] || `HYG ${sel.i}`,
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
  return {
    title: p.n,
    rows: [
      ['Semi-major axis', `${p.a.toFixed(5)} AU`, 'live'],
      ['Semi-major axis', `${Math.round(p.a * AU).toLocaleString('en-US')} KM`],
      ['Mean motion', `${p.dL.toFixed(6)}°/D`],
      ['Period', `${(360 / p.dL / 365.25).toFixed(2)} YR`],
      ['Light time from sun', `${((p.a * AU) / 299792.458 / 60).toFixed(1)} MIN`, 'caution'],
    ],
  };
}
