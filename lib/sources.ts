import { cdToMs } from './astro';
import { NotModifiedError, recall, remember } from './cache';
import type {
  Flight, Neo, NeoApproach, Quake, SatGroup, SatTle, SatTotals, Snapshot, SpaceWeather, System, Tno, Exoplanet,
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
  traffic: 180,
  route: 604800,      // a scheduled route does not change week to week
  tno: 604800,
  systems: 604800,
} as const;

const UA = 'four-regimes/0.1 (personal project; public data only)';

/**
 * Bounded-concurrency map with a small stagger. adsb.lol drops most of a
 * fifteen-way parallel burst — the first attempt got 3 of 15 corridors back —
 * so requests go out a few at a time. Cached hubs resolve instantly, which
 * makes this cheap once warm.
 */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; }
      catch (reason) { out[i] = { status: 'rejected', reason }; }
      await new Promise(r => setTimeout(r, 700));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

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

/* ═══ trans-neptunian objects ════════════════════════════════════
   The Kuiper belt used to be a random point cloud, which meant the dots
   were unclickable on principle — they were not anything. These are real
   bodies with published elements, so they can be selected and read. */
export async function getTnos(): Promise<Tno[]> {
  const fields = 'full_name,a,e,i,om,w,ma,epoch,H,class';
  const cdata = encodeURIComponent(JSON.stringify({ AND: ['H|LT|7'] }));
  const d = await bigJson<{ fields: string[]; data: string[][] }>(
    `${JPL}/sbdb_query.api?fields=${fields}&sb-class=TNO&sb-cdata=${cdata}&limit=90`, TTL.tno);
  const idx = Object.fromEntries(d.fields.map((f, i) => [f, i]));
  const num = (v: string) => Number(v);
  return d.data
    .map(r => ({
      name: r[idx.full_name].trim().replace(/\s+/g, ' '),
      a: num(r[idx.a]), e: num(r[idx.e]), i: num(r[idx.i]),
      om: num(r[idx.om]), w: num(r[idx.w]), ma: num(r[idx.ma]),
      epoch: num(r[idx.epoch]), h: num(r[idx.H]), cls: r[idx.class] ?? 'TNO',
    }))
    .filter(o => [o.a, o.e, o.i, o.om, o.w, o.ma, o.epoch].every(Number.isFinite) && o.a > 20)
    .sort((x, y) => x.a - y.a)
    .slice(0, 70);
}

/* ═══ planetary systems ══════════════════════════════════════════
   NASA's Exoplanet Archive, keyless. CSV rather than JSON: the JSON
   serialiser on their TAP endpoint took 90 s and truncated, while the same
   query as CSV returns in under four seconds.

   Positions come from the archive's own ra/dec/distance rather than by
   name-matching against HYG, which would be fuzzy and would fail exactly on
   the interesting cases (Proxima Cen vs Proxima Centauri, GJ vs Gliese).
*/
const EXO = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const EXO_MAX_PC = 31;

function csv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (!lines.length) return [];
  const cell = (line: string) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = cell(lines[0]);
  return lines.slice(1).map(l => Object.fromEntries(cell(l).map((v, i) => [head[i], v])));
}

export async function getSystems(): Promise<System[]> {
  const cols = 'hostname,pl_name,sy_dist,sy_pnum,ra,dec,pl_orbsmax,pl_orbper,pl_rade,'
    + 'pl_bmasse,pl_eqt,st_spectype,st_teff,st_rad,st_mass,discoverymethod,disc_year';
  const q = `select+${cols}+from+pscomppars+where+sy_dist+<+${EXO_MAX_PC}`;
  const raw = await remember<string>(`exo:${EXO_MAX_PC}`, TTL.systems, async () => {
    const r = await fetch(`${EXO}?query=${q}&format=csv`, {
      next: { revalidate: TTL.systems }, headers: { 'user-agent': UA },
    });
    if (!r.ok) throw new Error(`exoplanet archive → ${r.status}`);
    return r.text();
  });

  const num = (v: string | undefined) => {
    const n = Number(v);
    return v && v.trim() && Number.isFinite(n) ? n : null;
  };
  const byHost = new Map<string, System>();
  for (const row of csv(raw)) {
    const host = row.hostname?.trim();
    const dist = num(row.sy_dist);
    const ra = num(row.ra), dec = num(row.dec);
    if (!host || dist == null || ra == null || dec == null) continue;

    let sys = byHost.get(host);
    if (!sys) {
      const la = dec * Math.PI / 180, lo = ra * Math.PI / 180;
      sys = {
        host, dist, ra, dec,
        x: +(dist * Math.cos(la) * Math.cos(lo)).toFixed(4),
        y: +(dist * Math.cos(la) * Math.sin(lo)).toFixed(4),
        z: +(dist * Math.sin(la)).toFixed(4),
        spect: row.st_spectype?.trim() || '—',
        teff: num(row.st_teff), srad: num(row.st_rad), smass: num(row.st_mass),
        planets: [],
      };
      byHost.set(host, sys);
    }
    const pl: Exoplanet = {
      name: (row.pl_name || '').trim(),
      a: num(row.pl_orbsmax), period: num(row.pl_orbper),
      rade: num(row.pl_rade), masse: num(row.pl_bmasse), eqt: num(row.pl_eqt),
      method: row.discoverymethod?.trim() || '—', year: num(row.disc_year),
    };
    if (pl.name) sys.planets.push(pl);
  }
  for (const s of byHost.values()) {
    s.planets.sort((a, b) => (a.a ?? 9e9) - (b.a ?? 9e9));
  }
  return [...byHost.values()].sort((a, b) => a.dist - b.dist);
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

/* ═══ air traffic ════════════════════════════════════════════════
   There is no free feed of every aircraft on Earth. OpenSky's global
   /states/all is unreachable from here and adsb.lol's /v2/all answers 503,
   so the honest approach is to sample: 250 nm circles over the busiest
   international corridors, deduplicated by ICAO hex. That covers where
   long-haul traffic actually is, and the UI says "sampled", not "all".

   "International" is then a real determination, not a guess — adsbdb maps
   callsign to origin and destination airports with country codes, so a
   crossing is confirmed when the two countries differ. Routes are cached
   for a week because a scheduled route does not move.
*/
const HUBS: [string, number, number][] = [
  ['LHR', 51.47, -0.46], ['CDG', 49.01, 2.55], ['FRA', 50.03, 8.56],
  ['IST', 41.28, 28.75], ['DXB', 25.25, 55.36], ['DEL', 28.56, 77.10],
  ['BLR', 12.97, 77.59], ['SIN', 1.36, 103.99], ['HKG', 22.31, 113.91],
  ['NRT', 35.77, 140.39], ['SYD', -33.94, 151.18], ['LAX', 33.94, -118.41],
  ['JFK', 40.64, -73.78], ['GRU', -23.43, -46.47], ['JNB', -26.14, 28.25],
];

/** Cruise filter: a long-haul aircraft in the air, not a circuit or a taxi. */
const CRUISE_FT = 28000;
const CRUISE_KT = 350;
/** NEW route lookups per refresh. Cached routes are applied for free. */
const ENRICH_PER_CALL = 40;

type AdsbAc = {
  hex?: string; lat?: number; lon?: number; track?: number; calc_track?: number;
  alt_baro?: number | 'ground'; flight?: string; r?: string; t?: string; gs?: number;
};

type RouteInfo = {
  orig?: string; dest?: string;
  origCountry?: string; destCountry?: string;
  origLat?: number; origLon?: number; destLat?: number; destLon?: number;
  airline?: string;
};

async function lookupRoute(callsign: string): Promise<RouteInfo | null> {
  return remember<RouteInfo | null>(`route:${callsign}`, TTL.route, async () => {
    const r = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
      next: { revalidate: TTL.route }, headers: { 'user-agent': UA },
    });
    if (r.status === 404) return null;              // unknown callsign is a fact, cache it
    if (!r.ok) throw new Error(`adsbdb → ${r.status}`);
    const j = await r.json() as {
      response?: { flightroute?: {
        origin?: { iata_code?: string; country_iso_name?: string; latitude?: number; longitude?: number };
        destination?: { iata_code?: string; country_iso_name?: string; latitude?: number; longitude?: number };
        airline?: { name?: string };
      } };
    };
    const fr = j.response?.flightroute;
    if (!fr?.origin || !fr?.destination) return null;
    return {
      orig: fr.origin.iata_code, dest: fr.destination.iata_code,
      origCountry: fr.origin.country_iso_name, destCountry: fr.destination.country_iso_name,
      origLat: fr.origin.latitude, origLon: fr.origin.longitude,
      destLat: fr.destination.latitude, destLon: fr.destination.longitude,
      airline: fr.airline?.name,
    };
  });
}

export async function getTraffic(): Promise<{
  fl: Flight[]; flTotal: number; flIntl: number; flSeen: number; flHubs: number;
}> {
  // adsb.lol answers 429 above roughly one request per second, so corridors go
  // out two at a time with a stagger, and each one lands in the disk cache.
  // A rate-limited corridor then serves its last good copy instead of vanishing.
  const circles = await pool(HUBS, 2, ([, lat, lon]) =>
    bigJson<{ ac?: AdsbAc[] }>(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`, TTL.traffic));

  const byHex = new Map<string, Flight>();
  let seen = 0;
  let hubs = 0;
  for (const c of circles) {
    if (c.status !== 'fulfilled') continue;
    hubs++;
    for (const a of c.value.ac ?? []) {
      if (a.lat == null || a.lon == null || !a.hex) continue;
      seen++;
      const alt = a.alt_baro === 'ground' ? 0 : Math.round(a.alt_baro ?? 0);
      const gs = Math.round(a.gs ?? 0);
      if (alt < CRUISE_FT || gs < CRUISE_KT) continue;      // cruise only
      const flight = (a.flight ?? a.r ?? '').trim();
      if (!flight) continue;
      byHex.set(a.hex, {
        hex: a.hex,
        lat: +a.lat.toFixed(3), lon: +a.lon.toFixed(3),
        trk: Math.round(a.track ?? a.calc_track ?? 0),
        alt, gs, flight, type: a.t ?? '—',
      });
    }
  }

  const all = [...byHex.values()].sort((x, y) => y.alt - x.alt);

  const apply = (f: Flight, r: RouteInfo | null) => {
    if (!r) return;
    Object.assign(f, r);
    if (r.origCountry && r.destCountry) f.intl = r.origCountry !== r.destCountry;
  };

  // Pass 1: everything already cached, applied for free. Without this the
  // budget below was the only thing that ever set a route, so a week of
  // accumulated lookups was thrown away on every refresh.
  await Promise.all(all.map(async f => apply(f, await recall<RouteInfo | null>(`route:${f.flight}`, TTL.route))));

  // Pass 2: spend the request budget only on callsigns nothing knows yet.
  const pending = all.filter(f => f.orig === undefined).slice(0, ENRICH_PER_CALL);
  await pool(pending, 4, async f => apply(f, await lookupRoute(f.flight).catch(() => null)));

  // Confirmed crossings first — they are the ones we can actually stand behind.
  all.sort((x, y) => Number(y.intl ?? false) - Number(x.intl ?? false) || y.alt - x.alt);
  return {
    fl: all.slice(0, 700),   // the globe can carry it; sparse looked broken
    flTotal: all.length,
    flIntl: all.filter(f => f.intl).length,
    flSeen: seen,
    flHubs: hubs,
  };
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
  const [sw, neo, sat, eq, fl, tno] = await Promise.allSettled([
    getSpaceWeather(), getNeo(), getSatellites(), getSeismic(), getTraffic(), getTnos(),
  ]);
  const sys = await getSystems().catch(() => [] as System[]);
  const degraded: string[] = [];
  const note = (name: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') degraded.push(`${name}: ${String(r.reason?.message ?? r.reason)}`);
  };
  note('SPACE WEATHER', sw); note('NEO', neo); note('SATELLITES', sat);
  note('SEISMIC', eq); note('TRAFFIC', fl); note('TNO', tno);
  if (!sys.length) degraded.push('SYSTEMS: exoplanet archive unavailable');
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
    ...(fl.status === 'fulfilled' ? fl.value
      : { fl: [], flTotal: 0, flIntl: 0, flSeen: 0, flHubs: 0 }),
    tno: tno.status === 'fulfilled' ? tno.value : [],
    sys,
    degraded,
  };
}
