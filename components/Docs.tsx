import { AU, BOUNDS, diamM, isoZ, LD, PLANETS, planElements, tMinus, type SatState } from '@/lib/astro';
import { STARS } from '@/lib/stars';
import type { Snapshot } from '@/lib/types';
import {
  PlateBubble, PlateEncounter, PlateGalactic, PlateGeo, PlateHelio, PlateOort, PlateOuter, PlateSurface,
} from './Plates';
import { Bars, Histo, Note, Panel, Rows, Spark, type Row } from './Ui';

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);

function Provenance({ data }: { data: Snapshot }) {
  const items: Row[] = [
    ['Solar wind · Kp · X-ray', 'NOAA SWPC', 'series-a'],
    ['Close approaches', 'JPL SSD/CNEOS cad.api', 'series-a'],
    ['Orbital elements', 'JPL SBDB', 'series-a'],
    ['Satellite elements', 'CelesTrak GP', 'series-a'],
    ['Seismic', 'USGS M4.5+ week', 'series-a'],
    ['Air traffic', 'adsb.lol · 250 nm', 'series-a'],
    ['Star positions', 'HYG v4.1 parallax', 'series-a'],
    ['Coastlines', 'Natural Earth 110 m', 'series-a'],
  ];
  return (
    <Panel tab="Provenance">
      <Rows items={items} />
      <Note>
        ASSEMBLED <b className="text-live">{isoZ(data.t)}</b>. ORBITS ARE{' '}
        <b className="text-live">PROPAGATED</b> FROM PUBLISHED EPOCHS, SO SATELLITES AND ASTEROIDS
        ARE WHERE THEY ARE NOW, NOT WHERE THEY WERE FETCHED. SPACE-WEATHER, SEISMIC AND TRAFFIC
        READINGS ARE POINT-IN-TIME. SATELLITES USE MEAN ELEMENTS PLUS J2 NODAL DRIFT, NOT FULL
        SGP4. PLANETS USE JPL&rsquo;S APPROXIMATE KEPLERIAN ELEMENTS. THE GALACTIC AND OORT REGIMES ARE MODELS.
      </Note>
      {data.degraded.length > 0 && (
        <p className="mt-2 font-data text-[9.5px] leading-relaxed text-hazard">
          DEGRADED CHANNELS · {data.degraded.join(' · ').toUpperCase()}
        </p>
      )}
    </Panel>
  );
}

function SpaceWeather({ sw, full }: { sw: Snapshot['sw']; full?: boolean }) {
  return (
    <Panel tab="Space Weather">
      <Rows
        items={[
          ['Solar wind speed', `${sw.speed.toFixed(0)} KM/S`, 'live'],
          ['Proton density', `${sw.dens.toFixed(2)} P/CM³`],
          ['Bt · Bz (GSM)', `${sw.bt.toFixed(1)} · ${sw.bz.toFixed(1)} NT`, sw.bz < 0 ? 'hazard' : undefined],
          ['Kp index', `${sw.kp.toFixed(2)} · ${sw.g}`, sw.kp >= 5 ? 'hazard' : 'live'],
          ['X-ray flux', sw.xray],
          ['Aurora oval', `${sw.aurLat.toFixed(1)}°N`],
        ]}
      />
      {full && <Spark vals={sw.vSeries} fill="color-mix(in srgb, var(--color-live) 10%, transparent)" />}
      <Note>SOURCE {sw.src} · {sw.swt.replace('T', ' ')}Z</Note>
    </Panel>
  );
}

export default function Docs({
  dom, data, sats, simT,
}: { dom: number; data: Snapshot; sats: SatState[]; simT: number }) {
  const sw = data.sw;

  if (dom === 0) {
    return (
      <div className="docs">
        <Panel tab="Galactic Position">
          <Rows
            items={[
              ['Galactocentric radius', '26,700 LY', 'live'],
              ['Orbital period', '≈ 230 MYR'],
              ['Orbital speed', '230 KM/S'],
              ['Height above plane', '≈ 65 LY'],
              ['Arm', 'ORION SPUR', 'series-a'],
              ['Stellar population', '≈ 100–400 BILLION'],
            ]}
          />
          <Note>
            THE SUN COMPLETES ONE GALACTIC ORBIT ROUGHLY EVERY 230 MILLION YEARS. IT HAS MADE ABOUT
            TWENTY SINCE IT FORMED.
          </Note>
        </Panel>
        <Panel tab="Light Travel">
          <Rows
            items={[
              ['To the Moon', '1.28 S', 'live'],
              ['To the Sun', '8.32 MIN'],
              ['To the heliopause', '17.0 HR'],
              ['To the nearest star', '4.25 YR', 'caution'],
              ['Across the Local Bubble', '≈ 300 YR'],
              ['To the galactic centre', '26,700 YR', 'hazard'],
            ]}
          />
          <Note>EVERY RUNG OF THE LADDER IS ALSO A DELAY. NOTHING HERE IS SEEN AS IT IS NOW.</Note>
        </Panel>
        <Panel tab="Plate 1 · Galactic Plane"><PlateGalactic /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 1) {
    const dists = STARS.map(s => Math.hypot(s[0], s[1], s[2]) * 3.26156);
    const nearest = STARS
      .map((s, i) => ({ s, d: Math.hypot(s[0], s[1], s[2]) * 3.26156 }))
      .sort((a, b) => a.d - b.d)[0];
    const brightest = STARS.reduce((a, b) => (b[3] < a[3] ? b : a), STARS[0]);
    return (
      <div className="docs">
        <Panel tab="Neighbourhood">
          <Rows
            items={[
              ['Stars plotted', String(STARS.length), 'live'],
              ['Named', String(STARS.filter(s => s[5]).length)],
              ['Nearest', `${nearest.s[5] || '—'} · ${nearest.d.toFixed(2)} LY`, 'caution'],
              ['Brightest', `${brightest[5] || '—'} · MAG ${brightest[3].toFixed(2)}`],
              ['Median distance', `${med(dists).toFixed(0)} LY`],
              ['Selection rule', 'MAG < 5.0 OR WITHIN 65 LY'],
            ]}
          />
          <Note>
            POSITIONS ARE THE CATALOGUE&rsquo;S CARTESIAN X/Y/Z FROM MEASURED PARALLAX. THIS IS A
            VOLUME, NOT A SKY DOME &mdash; DRAG AND THE NEAR STARS SHIFT AGAINST THE FAR ONES.
          </Note>
        </Panel>
        <Panel tab="Distance Distribution">
          <Histo
            vals={dists}
            edges={[0, 25, 50, 100, 200, 400, 560]}
            label="DISTANCE · LIGHT YEARS"
            color="var(--color-series-a)"
            fmt={n => String(n)}
          />
        </Panel>
        <Panel tab="Plate 2 · Local Bubble"><PlateBubble /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 2) {
    return (
      <div className="docs">
        <Panel tab="Shell Model">
          <Rows
            items={[
              ['Inner boundary', `${n0(BOUNDS.oortInner)} AU`, 'live'],
              ['Outer boundary', `${n0(BOUNDS.oortOuter)} AU`],
              ['Outer boundary', '1.58 LY', 'caution'],
              ['Objects observed', 'NONE DIRECTLY', 'hazard'],
              ['Evidence', 'LONG-PERIOD COMET ORBITS'],
              ['Estimated bodies', '≈ 10¹² · > 1 KM'],
            ]}
          />
          <Note>
            THE SHELL IS AN INFERENCE FROM WHERE LONG-PERIOD COMETS COME FROM. THE POINT CLOUD IS A
            UNIFORM SAMPLE FOR SCALE, NOT A CATALOGUE.
          </Note>
        </Panel>
        <Panel tab="Crossing Times">
          <Rows
            items={[
              ['Voyager 1 distance', '≈ 170 AU · 2026', 'live'],
              ['Voyager 1 speed', '17.0 KM/S'],
              ['To inner Oort', '≈ 300 YR', 'caution'],
              ['To outer Oort', '≈ 30,000 YR', 'hazard'],
              ['Solar wind to heliopause', `${(BOUNDS.heliopause * AU / (sw.speed || 400) / 86400).toFixed(0)} D`],
            ]}
          />
          <Note>
            THE FASTEST OBJECT WE HAVE EVER LAUNCHED WILL SPEND THREE CENTURIES REACHING THE INNER
            EDGE OF THIS PANEL.
          </Note>
        </Panel>
        <Panel tab="Plate 3 · Oort Shell"><PlateOort /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 3) {
    return (
      <div className="docs">
        <Panel tab="Outer Planets">
          <Rows
            items={PLANETS.slice(4).map(p => {
              const el = planElements(p, simT);
              return [p.n, `${el.a.toFixed(3)} AU · e ${el.e.toFixed(3)} · ${el.periodYr.toFixed(1)} YR`] as Row;
            })}
          />
          <Note>
            JPL APPROXIMATE POSITIONS OF THE PLANETS &mdash; KEPLERIAN ELEMENTS AT J2000 WITH
            PER-CENTURY RATES, GOOD TO ARCMINUTES ACROSS 1800&ndash;2050. ORBITS ARE DRAWN AS TRUE
            ELLIPSES, SO ECCENTRICITY IS VISIBLE.
          </Note>
        </Panel>
        <Panel tab="Heliosphere Boundary">
          <Rows
            items={[
              ['Kuiper belt', `${BOUNDS.kuiperInner}–${BOUNDS.kuiperOuter} AU`, 'live'],
              ['Termination shock', `${BOUNDS.terminationShock} AU · V1 2004`, 'series-a'],
              ['Heliopause', `${BOUNDS.heliopause} AU · V1 2012`, 'series-a'],
              ['Light time to heliopause', '17.0 HR'],
              ['Wind transit', `${(BOUNDS.heliopause * AU / (sw.speed || 400) / 86400).toFixed(0)} D AT ${sw.speed.toFixed(0)} KM/S`, 'caution'],
            ]}
          />
          <Note>
            BOTH BOUNDARIES ARE MEASURED SPACECRAFT CROSSINGS, NOT MODELS &mdash; VOYAGER 1 FLEW
            THROUGH THEM AND THE PLASMA INSTRUMENTS RECORDED IT.
          </Note>
        </Panel>
        <Panel tab="Plate 4 · Outer System"><PlateOuter /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 4) {
    return (
      <div className="docs">
        <SpaceWeather sw={sw} full />
        <Panel tab="Geomagnetic Activity">
          <Rows
            items={[
              ['Latest Kp', sw.kp.toFixed(2), sw.kp >= 5 ? 'hazard' : 'live'],
              ['Storm scale', sw.g, sw.kp >= 5 ? 'hazard' : undefined],
              ['Window', '8 D · 3 H CADENCE'],
              ['Peak in window', (Math.max(0, ...sw.kpSeries)).toFixed(2), 'hazard'],
            ]}
          />
          <Bars vals={sw.kpSeries} />
          <Note>KP 0–9 · G1 STORM THRESHOLD AT KP 5 · NOAA PLANETARY INDEX</Note>
        </Panel>
        <Panel tab="Inner System">
          <Rows
            items={[
              ['Bodies plotted', `4 PLANETS · ${data.neo.length} NEO`],
              ['Tracked approaches', `${n0(data.neoTotal)} · 120 D`, 'hazard'],
              ['Orbit source', 'JPL SBDB ELEMENTS'],
              ['Solar wind transit', `${(AU / (sw.speed || 400) / 86400).toFixed(1)} D · SUN TO EARTH`, 'live'],
            ]}
          />
          <Note>
            ASTEROID ELLIPSES ARE REAL KEPLERIAN ORBITS FROM PUBLISHED ELEMENTS. THE PARTICLE STREAM
            TRACKS THE LIVE WIND SPEED AND FIELD DIRECTION.
          </Note>
        </Panel>
        <Panel tab="Plate 5 · Heliosphere"><PlateHelio sw={sw} /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 5) {
    const near = data.neo[0];
    return (
      <div className="docs">
        <Panel tab="Nearest Encounter">
          {near ? (
            <>
              <p className="t-data mb-[6px] text-hazard">{near.des} · {near.cls}</p>
              <p className="mb-[6px]">
                <span className="t-label">Time to approach</span>
                <b className="ml-2 font-data text-[11px] text-hazard">{tMinus(near.cdMs, simT)}</b>
              </p>
              <Rows
                items={[
                  ['Closest approach', near.cd, 'live'],
                  ['Miss distance', `${((near.dist * AU) / LD).toFixed(3)} LD`, 'hazard'],
                  ['Miss distance', `${n0(near.dist * AU)} KM`],
                  ['Relative velocity', `${near.v.toFixed(2)} KM/S`],
                  ['Absolute mag H', near.h.toFixed(1)],
                  ['Est. diameter', `${diamM(near.h).toFixed(0)} M`],
                ]}
              />
            </>
          ) : <Note>NO ELEMENTS AVAILABLE</Note>}
        </Panel>
        <Panel tab="Encounter Window">
          <Rows
            items={[
              ['Approaches tracked', n0(data.neoTotal), 'hazard'],
              ['Window', '120 D · DIST < 0.2 AU'],
              ['Plotted with elements', String(data.neo.length), 'live'],
              ['Listed without', String(data.neoTab.length)],
              ['Inside 1 LD', String(data.neo.filter(o => o.dist * AU < LD).length)],
              ['Ring spacing', '1 LD · 384,400 KM'],
            ]}
          />
          <Histo
            vals={data.neo.map(o => (o.dist * AU) / LD)}
            edges={[0, 2, 4, 6, 8, 10]}
            label="MISS DISTANCE · LUNAR DISTANCES"
          />
        </Panel>
        <SpaceWeather sw={sw} />
        <Panel tab="Plate 6 · Encounter"><PlateEncounter data={data} /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  if (dom === 6) {
    const t = data.satTotals;
    const alts = sats.map(s => s.alt);
    const all = t.ISS + t.GPS + t.GEO + t.STL + t.OWB;
    return (
      <div className="docs">
        <Panel tab="Constellation Key">
          <Rows
            items={[
              ['◆ ISS · stations', `${t.ISS} TRACKED`, 'live'],
              ['● GPS / GNSS', `${t.GPS} TRACKED`, 'series-a'],
              ['● Geostationary', `${n0(t.GEO)} TRACKED`],
              ['● Starlink', `${n0(t.STL)} TRACKED`],
              ['● OneWeb', `${n0(t.OWB)} TRACKED`],
              ['Propagated here', `${sats.length} SAMPLE`, 'live'],
            ]}
          />
          <Note>
            A {sats.length}-OBJECT SAMPLE IS PROPAGATED LIVE. THE TOTALS ARE THE REAL CELESTRAK
            COUNTS ACROSS THESE FIVE GROUPS &mdash; {n0(all)} OBJECTS, NOT THE WHOLE CATALOGUE.
          </Note>
        </Panel>
        <Panel tab="Orbit Regimes">
          <Histo
            vals={alts}
            edges={[0, 600, 1200, 20000, 36000, 42000]}
            label="MEAN ALTITUDE · KM"
            color="var(--color-series-b)"
            fmt={n => (n >= 1000 ? `${n / 1000}k` : String(n))}
          />
          <Rows
            items={[
              ['Lowest', `${n0(Math.min(...alts, 0))} KM`, 'live'],
              ['Highest', `${n0(Math.max(...alts, 0))} KM`],
              ['GEO radius', '42,164 KM'],
              ['Fastest period', `${Math.min(...sats.map(s => s.per), 999).toFixed(1)} MIN`],
            ]}
          />
        </Panel>
        <SpaceWeather sw={sw} />
        <Panel tab="Plate 7 · Geocentric"><PlateGeo sats={sats} /></Panel>
        <Provenance data={data} />
      </div>
    );
  }

  const mags = data.eq.map(e => e.mag);
  const deps = data.eq.map(e => e.dep);
  const big = data.eq.reduce((a, b) => (b.mag > a.mag ? b : a), data.eq[0]);
  return (
    <div className="docs">
      <Panel tab="Seismic Watch">
        <Rows
          items={[
            ['Events in window', `${data.eqTotal} · M4.5+ · 7 D`, 'hazard'],
            ['Plotted', String(data.eq.length)],
            ['Largest', big ? `M ${big.mag.toFixed(1)}` : '—', 'hazard'],
            ['Largest region', big ? (big.place.length > 26 ? `${big.place.slice(0, 26)}…` : big.place) : '—'],
            ['Median depth', `${med(deps).toFixed(0)} KM`],
            ['Deepest', `${Math.max(0, ...deps).toFixed(0)} KM`],
          ]}
        />
        <Histo vals={mags} edges={[4.5, 5, 5.5, 6, 6.5, 8]} label="MAGNITUDE DISTRIBUTION" fmt={n => n.toFixed(1)} />
      </Panel>
      <Panel tab="International Traffic">
        <Rows
          items={[
            ['Corridors sampled', `${data.flHubs} × 250 NM`, 'series-a'],
            ['Aircraft seen', String(data.flSeen)],
            ['At cruise', `${data.flTotal} · FL280+ · 350 KT+`],
            ['Crossing confirmed', String(data.flIntl), 'hazard'],
            ['Plotted', String(data.fl.length)],
            ['Highest', `FL${String(Math.round(Math.max(0, ...data.fl.map(f => f.alt)) / 100)).padStart(3, '0')}`, 'series-a'],
            ['Fastest', `${Math.max(0, ...data.fl.map(f => f.gs))} KT`],
          ]}
        />
        <Note>
          NO FREE FEED CARRIES EVERY AIRCRAFT ON EARTH &mdash; OPENSKY&rsquo;S GLOBAL ENDPOINT IS
          UNREACHABLE AND ADSB.LOL SERVES 250 NM CIRCLES ONLY. SO THIS SAMPLES {data.flHubs} MAJOR
          CORRIDORS AND DEDUPLICATES BY ICAO HEX. &ldquo;CROSSING CONFIRMED&rdquo; MEANS ADSBDB
          RESOLVED THE CALLSIGN AND THE TWO AIRPORT COUNTRIES DIFFER &mdash; NOT A GUESS FROM RANGE.
          ROUTES RESOLVE PROGRESSIVELY AND CACHE FOR A WEEK.
        </Note>
        <Histo
          vals={data.fl.map(f => f.alt / 100)}
          edges={[0, 100, 250, 350, 400, 450]}
          label="FLIGHT LEVEL"
          color="var(--color-series-a)"
        />
      </Panel>
      <SpaceWeather sw={sw} />
      <Panel tab="Plate 8 · Surface"><PlateSurface data={data} /></Panel>
      <Provenance data={data} />
    </div>
  );
}
