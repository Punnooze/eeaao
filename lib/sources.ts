import { cdToMs } from './astro';
import { NotModifiedError, remember } from './cache';
import type {
  Flight, Neo, NeoApproach, Quake, SatGroup, SatTle, SatTotals, Snapshot, SpaceWeather,
} from './types';

/**
 * Cache windows. Two rules decide these: how fast the source actually changes,
 * and how polite we need to be. CelesTrak asks for infrequent bulk pulls, so
 * TLEs sit for three hours — harmless, because orbits are propagated in the
 * client between refetches. The big NOAA real-time files are only pulled for
 * the sparkline series; the headline numbers come from 59-byte summary
 * endpoints instead, so a fast cadence costs almost nothing.
 */
export const TTL = {
  swSummary: 300,
  swSeries: 3600,
  kp: 900,
  flare: 600,
  aurora: 1800,
  neo: 21600,
  sbdb: 604800,
  tle: 10800,
  seismic: 300,
  traffic: 60,
} as const;

const UA = 'four-regimes/0.1 (personal project; public data only)';

async function get(url: string, revalidate: number) {
  const r = await fetch(url, {
    next: { revalidate },
    headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*' },
  });
  if (!r.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} → ${r.status}`);
  return r;
}
const json = async <T>(url: string, revalidate: number) => (await get(url, revalidate)).json() as Promise<T>;

/** Feeds that need the disk-backed cache — see lib/cache.ts for why. */
const bigJson = <T>(url: string, ttl: number) =>
  remember<T>(url, ttl, async () => (await get(url, ttl)).json() as Promise<T>);
const bigText = (url: string, ttl: number) =>
  remember<string>(url, ttl, async () => {
    // revalidate rather than no-store: no-store would opt every calling route
    // out of static generation, and the disk cache already limits real traffic.
    const r = await fetch(url, { next: { revalidate: ttl }, headers: { 'user-agent': UA } });
    const body = await r.text();
    // CelesTrak answers a too-soon repeat pull with 403 and this exact phrase.
    // It means "you already have the current set", so keep the cached copy.
    if (!r.ok) {
      if (r.status === 403 && /has not updated/i.test(body)) throw new NotModifiedError(url);
      throw new Error(`${new URL(url).host} → ${r.status}`);
    }
    return body;
  });

/* ═══ space weather ══════════════════════════════════════════════ */
const SW = 'https://services.swpc.noaa.gov';

const flareClass = (v: number) => {
  for (const [lim, ch] of [[1e-4, 'X'], [1e-5, 'M'], [1e-6, 'C'], [1e-7, 'B']] as const) {
    if (v >= lim) return `${ch}${(v / lim).toFixed(1)}`;
  }
  return `A${(v / 1e-8).toFixed(1)}`;
};
const gScale = (kp: number) =>
  kp >= 8 ? 'G4 SEVERE' : kp >= 7 ? 'G3 STRONG' : kp >= 6 ? 'G2 MODERATE' : kp >= 5 ? 'G1 MINOR' : 'G0 QUIET';

type WindRow = {
  time_tag: string; source: string | null;
  proton_speed: number | null; proton_density: number | null; proton_temperature: number | null;
};
type KpRow = { time_tag: string; Kp: number };
type FlareRow = { current_class: string | null; max_class: string | null; time_tag: string };

export async function getSpaceWeather(): Promise<SpaceWeather> {
  const [speedS, magS, kpS, flareS, windS, aurora] = await Promise.allSettled([
    json<{ proton_speed: number; time_tag: string }[]>(`${SW}/products/summary/solar-wind-speed.json`, TTL.swSummary),
    json<{ bt: number; bz_gsm: number; time_tag: string }[]>(`${SW}/products/summary/solar-wind-mag-field.json`, TTL.swSummary),
    json<KpRow[]>(`${SW}/products/noaa-planetary-k-index.json`, TTL.kp),
    json<FlareRow[]>(`${SW}/json/goes/primary/xray-flares-latest.json`, TTL.flare),
    bigJson<WindRow[]>(`${SW}/json/rtsw/rtsw_wind_1m.json`, TTL.swSeries),
    json<{ coordinates: [number, number, number][] }>(`${SW}/json/ovation_aurora_latest.json`, TTL.aurora),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

  const speed = ok(speedS)?.[0];
  const mag = ok(magS)?.[0];
  const kpAll = ok(kpS) ?? [];
  const kp = kpAll[kpAll.length - 1];
  const flare = ok(flareS)?.[0];
  const wind = ok(windS)?.find(r => r.proton_speed != null && r.proton_density != null);
  const coords = ok(aurora)?.coordinates;

  if (!speed && !wind) throw new Error('no solar wind reading available');

  const peak = coords
    ? coords.reduce((a, c) => (c[1] > 40 && c[2] > a[2] ? c : a), [0, 60, -1] as [number, number, number])
    : ([0, 0, 0] as [number, number, number]);

  const vSeries: number[] = [];
  const rows = ok(windS) ?? [];
  for (let i = rows.length - 1; i >= 0; i -= 30) {
    const v = rows[i]?.proton_speed;
    if (v != null) vSeries.push(Math.round(v));
  }

  return {
    speed: +(speed?.proton_speed ?? wind?.proton_speed ?? 0),
    dens: +(wind?.proton_density ?? 0).toFixed(2),
    temp: Math.round(wind?.proton_temperature ?? 0),
    src: wind?.source ?? 'SWPC',
    swt: (speed?.time_tag ?? wind?.time_tag ?? '').replace('Z', ''),
    bt: +(mag?.bt ?? 0),
    bz: +(mag?.bz_gsm ?? 0),
    mgt: (mag?.time_tag ?? '').replace('Z', ''),
    kp: kp?.Kp ?? 0,
    kpts: kp?.time_tag ?? '',
    g: gScale(kp?.Kp ?? 0),
    xray: flare?.current_class ?? flare?.max_class ?? 'A0.0',
    xrt: flare?.time_tag ?? '',
    aurLat: +peak[1].toFixed(1),
    aurPow: +peak[2].toFixed(1),
    kpSeries: kpAll.map(r => r.Kp),
    vSeries: vSeries.slice(-60),
  };
}

/* ═══ near-earth objects ═════════════════════════════════════════ */
const JPL = 'https://ssd-api.jpl.nasa.gov';
const PLOT_LIMIT = 14;   // objects we fetch elements for and draw

type CadResponse = { count: string | number; fields: string[]; data: string[][] };
type SbdbResponse = {
  object?: { des?: string; orbit_class?: { code?: string } };
  orbit?: { epoch?: string; elements?: { name: string; value: string }[] };
};

export async function getNeo(): Promise<{ neo: Neo[]; neoTab: NeoApproach[]; neoTotal: number }> {
  const cad = await json<CadResponse>(
    `${JPL}/cad.api?dist-max=0.2&date-min=now&date-max=%2B120&sort=date`, TTL.neo);
  const idx = Object.fromEntries(cad.fields.map((f, i) => [f, i]));
  const rows = [...cad.data].sort((a, b) => +a[idx.dist] - +b[idx.dist]);

  const head = rows.slice(0, PLOT_LIMIT);
  const settled = await Promise.allSettled(head.map(r =>
    json<SbdbResponse>(`${JPL}/sbdb.api?sstr=${encodeURIComponent(r[idx.des])}&full-prec=true`, TTL.sbdb)));

  const neo: Neo[] = [];
  const plotted = new Set<string>();
  head.forEach((r, k) => {
    const s = settled[k];
    if (s.status !== 'fulfilled' || !s.value.orbit?.elements) return;
    const el = Object.fromEntries(s.value.orbit.elements.map(e => [e.name, +e.value]));
    if (!Number.isFinite(el.a) || !Number.isFinite(el.per)) return;
    const des = r[idx.des];
    plotted.add(des);
    neo.push({
      des, cd: r[idx.cd], cdMs: cdToMs(r[idx.cd]),
      dist: +(+r[idx.dist]).toFixed(6), v: +(+r[idx.v_rel]).toFixed(2), h: +(+r[idx.h]).toFixed(1),
      cls: s.value.object?.orbit_class?.code ?? '—',
      a: el.a, e: el.e, i: el.i, om: el.om, w: el.w, ma: el.ma,
      per: +el.per.toFixed(2), epoch: +(s.value.orbit.epoch ?? 0),
    });
  });

  const neoTab: NeoApproach[] = rows.slice(0, 44)
    .filter(r => !plotted.has(r[idx.des]))
    .slice(0, 26)
    .map(r => ({
      des: r[idx.des], cd: r[idx.cd],
      dist: +(+r[idx.dist]).toFixed(6), v: +(+r[idx.v_rel]).toFixed(2), h: +(+r[idx.h]).toFixed(1),
    }));

  return { neo, neoTab, neoTotal: +cad.count };
}

/* ═══ satellites ═════════════════════════════════════════════════ */
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
/** group → [CelesTrak group, sample stride, cap]. Sampling keeps the client
 *  payload small; the totals reported to the UI are the real counts. */
const GROUPS: [SatGroup, string, number, number][] = [
  ['ISS', 'stations', 1, 8],
  ['GPS', 'gps-ops', 1, 40],
  ['GEO', 'geo', 9, 44],
  ['STL', 'starlink', 62, 96],
  ['OWB', 'oneweb', 22, 32],
];

function parseTles(raw: string, grp: SatGroup, stride: number, cap: number) {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
  const out: SatTle[] = [];
  let total = 0;
  for (let k = 0; k + 2 < lines.length + 1; k += 3) {
    const [name, l1, l2] = [lines[k], lines[k + 1], lines[k + 2]];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;
    total++;
    if (total % stride !== 1 && stride > 1) continue;
    if (out.length >= cap) continue;
    const yy = +l1.slice(18, 20), doy = +l1.slice(20, 32);
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const t: SatTle = {
      name: name.slice(0, 24).trim(), grp,
      epochMs: Date.UTC(year, 0, 1) + (doy - 1) * 86400000,
      inc: +l2.slice(8, 16), raan: +l2.slice(17, 25),
      ecc: +`0.${l2.slice(26, 33).trim()}`,
      argp: +l2.slice(34, 42), ma: +l2.slice(43, 51), nrev: +l2.slice(52, 63),
    };
    if ([t.inc, t.raan, t.ecc, t.argp, t.ma, t.nrev].every(Number.isFinite) && t.nrev > 0) out.push(t);
  }
  return { sats: out, total };
}

export async function getSatellites(): Promise<{ sat: SatTle[]; satTotals: SatTotals; satMissing: string[] }> {
  const results = await Promise.allSettled(GROUPS.map(([, g]) =>
    bigText(`${CELESTRAK}?GROUP=${g}&FORMAT=tle`, TTL.tle)));
  const sat: SatTle[] = [];
  const satTotals = { ISS: 0, GPS: 0, GEO: 0, STL: 0, OWB: 0 } as SatTotals;
  const missing: string[] = [];
  results.forEach((r, k) => {
    const [grp, name, stride, cap] = GROUPS[k];
    if (r.status !== 'fulfilled') { missing.push(name); return; }
    const { sats, total } = parseTles(r.value, grp, stride, cap);
    if (!total) { missing.push(name); return; }
    sat.push(...sats);
    satTotals[grp] = total;
  });
  if (!sat.length) throw new Error('celestrak returned no usable elements');
  return { sat, satTotals, satMissing: missing };
}

/* ═══ seismic ════════════════════════════════════════════════════ */
type UsgsFeed = {
  metadata: { title: string };
  features: {
    properties: { mag: number | null; place: string | null; time: number };
    geometry: { coordinates: [number, number, number] };
  }[];
};

export async function getSeismic(): Promise<{ eq: Quake[]; eqTotal: number; eqTitle: string }> {
  const f = await json<UsgsFeed>(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', TTL.seismic);
  const eq: Quake[] = f.features
    .filter(x => x.properties.mag != null)
    .map(x => ({
      lat: +x.geometry.coordinates[1].toFixed(3),
      lon: +x.geometry.coordinates[0].toFixed(3),
      dep: +x.geometry.coordinates[2].toFixed(1),
      mag: +(x.properties.mag as number).toFixed(1),
      place: x.properties.place ?? '—',
      time: x.properties.time,
    }))
    .sort((a, b) => b.time - a.time);
  return { eq: eq.slice(0, 70), eqTotal: eq.length, eqTitle: f.metadata.title };
}

/* ═══ air traffic ════════════════════════════════════════════════ */
export const OBSERVER = { lat: 12.97, lon: 77.59, name: 'BLR', radiusNm: 250 };

type AdsbAc = {
  lat?: number; lon?: number; track?: number; calc_track?: number;
  alt_baro?: number | 'ground'; flight?: string; r?: string; t?: string; gs?: number;
};

export async function getTraffic(): Promise<{ fl: Flight[]; flTotal: number }> {
  const d = await json<{ ac?: AdsbAc[] }>(
    `https://api.adsb.lol/v2/point/${OBSERVER.lat}/${OBSERVER.lon}/${OBSERVER.radiusNm}`, TTL.traffic);
  const fl: Flight[] = (d.ac ?? [])
    .filter(a => a.lat != null && a.lon != null)
    .map(a => ({
      lat: +a.lat!.toFixed(3), lon: +a.lon!.toFixed(3),
      trk: Math.round(a.track ?? a.calc_track ?? 0),
      alt: a.alt_baro === 'ground' ? 0 : Math.round(a.alt_baro ?? 0),
      flight: (a.flight ?? a.r ?? '——').trim(),
      type: a.t ?? '—',
      gs: Math.round(a.gs ?? 0),
    }))
    .sort((a, b) => b.alt - a.alt);
  return { fl: fl.slice(0, 64), flTotal: fl.length };
}

/* ═══ assembled payload ══════════════════════════════════════════ */
const EMPTY_SW: SpaceWeather = {
  speed: 0, dens: 0, temp: 0, src: 'NO SIGNAL', swt: '', bt: 0, bz: 0, mgt: '',
  kp: 0, kpts: '', g: 'NO DATA', xray: 'A0.0', xrt: '', aurLat: 0, aurPow: 0,
  kpSeries: [], vSeries: [],
};

/**
 * One feed failing must not blank the console — each section degrades on its
 * own and says so, the way an instrument shows a dead channel rather than a
 * dead panel.
 */
export async function getSnapshot(): Promise<Snapshot> {
  const [sw, neo, sat, eq, fl] = await Promise.allSettled([
    getSpaceWeather(), getNeo(), getSatellites(), getSeismic(), getTraffic(),
  ]);
  const degraded: string[] = [];
  const note = (name: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') degraded.push(`${name}: ${String(r.reason?.message ?? r.reason)}`);
  };
  note('SPACE WEATHER', sw); note('NEO', neo); note('SATELLITES', sat);
  note('SEISMIC', eq); note('TRAFFIC', fl);
  if (sat.status === 'fulfilled' && sat.value.satMissing.length) {
    degraded.push(`ELEMENT SETS STALE: ${sat.value.satMissing.join(', ')}`);
  }

  return {
    t: Date.now(),
    sw: sw.status === 'fulfilled' ? sw.value : EMPTY_SW,
    ...(neo.status === 'fulfilled' ? neo.value : { neo: [], neoTab: [], neoTotal: 0 }),
    ...(sat.status === 'fulfilled' ? sat.value
      : { sat: [], satTotals: { ISS: 0, GPS: 0, GEO: 0, STL: 0, OWB: 0 }, satMissing: [] }),
    ...(eq.status === 'fulfilled' ? eq.value : { eq: [], eqTotal: 0, eqTitle: 'NO DATA' }),
    ...(fl.status === 'fulfilled' ? fl.value : { fl: [], flTotal: 0 }),
    degraded,
  };
}
