import { AU, BOUNDS, LD, LY, PC, PLANETS, type SatState } from '@/lib/astro';
import { STARS } from '@/lib/stars';
import type { Snapshot } from '@/lib/types';
import { Note } from './Ui';

/**
 * Line-drawn technical figures, one per regime. Vector, never photographs —
 * this design language has no photorealism in it, and every figure carries the
 * live numbers from the panel beside it rather than illustrating in general.
 */

const AM = 'color-mix(in srgb, var(--color-chrome) 75%, transparent)';
const AD = 'color-mix(in srgb, var(--color-chrome) 34%, transparent)';
const GR = 'var(--color-live)';
const RD = 'var(--color-hazard)';
const YE = 'var(--color-caution)';
const CY = 'var(--color-series-a)';
const BN = 'color-mix(in srgb, var(--color-bone) 55%, transparent)';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg className="plate" viewBox="0 0 250 132" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">
    {children}
  </svg>
);

function Dim({ x1, x2, y, text, c = AM }: { x1: number; x2: number; y: number; text: string; c?: string }) {
  return (
    <>
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} stroke={c} strokeWidth="1" />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} stroke={c} strokeWidth="1" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={c} strokeWidth="1" strokeDasharray="3 3" />
      <text x={(x1 + x2) / 2} y={y - 7} fill={c} textAnchor="middle">{text}</text>
    </>
  );
}

function Arrow({ x1, y1, x2, y2, c }: { x1: number; y1: number; x2: number; y2: number; c: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 4;
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="1" />
      <path
        d={`M${x2} ${y2} L${(x2 - h * Math.cos(a - 0.4)).toFixed(1)} ${(y2 - h * Math.sin(a - 0.4)).toFixed(1)} `
          + `L${(x2 - h * Math.cos(a + 0.4)).toFixed(1)} ${(y2 - h * Math.sin(a + 0.4)).toFixed(1)} Z`}
        fill={c}
      />
    </>
  );
}

/** A log axis, which is the same axis the whole site runs on. */
function LogAxis({ marks, y = 96, unit }: { marks: [number, string][]; y?: number; unit: string }) {
  const lo = Math.log10(marks[0][0]), hi = Math.log10(marks[marks.length - 1][0]);
  const at = (v: number) => 18 + ((Math.log10(v) - lo) / (hi - lo)) * 214;
  return (
    <>
      <line x1="14" y1={y} x2="238" y2={y} stroke={AM} strokeWidth="1" />
      {marks.map(([v, label], i) => (
        <g key={i}>
          <line x1={at(v)} y1={y - 5} x2={at(v)} y2={y + 5} stroke={AM} strokeWidth="1" />
          <text x={at(v)} y={y + 15} fill={i % 2 ? BN : YE} textAnchor="middle">{label}</text>
        </g>
      ))}
      <text x="14" y={y - 10} fill={AD}>LOG SCALE · {unit}</text>
    </>
  );
}

export function PlateGalactic() {
  return (
    <>
      <Svg>
        {/* disc seen edge-on */}
        <ellipse cx="125" cy="56" rx="112" ry="9" fill="none" stroke={AM} strokeWidth="1" />
        <ellipse cx="125" cy="56" rx="112" ry="22" fill="none" stroke={AD} strokeWidth="1" strokeDasharray="3 4" />
        <ellipse cx="125" cy="56" rx="20" ry="15" fill="none" stroke={YE} strokeWidth="1" />
        <circle cx="125" cy="56" r="4" fill={YE} />
        <text x="125" y="34" fill={YE} textAnchor="middle">GALACTIC CENTRE</text>
        <circle cx="207" cy="56" r="2.6" fill={GR} />
        <line x1="207" y1="48" x2="207" y2="30" stroke={GR} strokeWidth="1" />
        <text x="207" y="26" fill={GR} textAnchor="middle">SOL</text>
        <Dim x1={125} x2={207} y={80} text="26,700 LY" c={GR} />
        <Dim x1={13} x2={237} y={112} text="DISC ≈ 100,000 LY ACROSS" />
        <text x="14" y="52" fill={CY}>PERSEUS ARM</text>
        <text x="176" y="70" fill={CY}>ORION SPUR</text>
      </Svg>
      <Note>
        GALACTIC PLANE · SCHEMATIC. FOUR-ARMED LOGARITHMIC SPIRAL AT 12° PITCH — A MODEL, NOT A
        SURVEY. THE MEASURED FACT IS OUR OWN POSITION: 26,700 LY OUT, IN THE ORION SPUR.
      </Note>
    </>
  );
}

export function PlateBubble() {
  const near = [...STARS]
    .map((s, i) => ({ s, i, pc: Math.hypot(s[0], s[1], s[2]) }))
    .sort((a, b) => a.pc - b.pc)
    .slice(0, 4);
  return (
    <>
      <Svg>
        <circle cx="20" cy="46" r="5" fill={YE} />
        <text x="20" y="30" fill={YE} textAnchor="middle">SOL</text>
        {near.map(({ s, pc }, k) => {
          const x = 62 + k * 56;
          return (
            <g key={k}>
              <circle cx={x} cy="46" r="3" fill="#cfe0ff" />
              <text x={x} y="30" fill={BN} textAnchor="middle">{(s[5] || '—').slice(0, 12)}</text>
              <text x={x} y="64" fill={GR} textAnchor="middle">{(pc * 3.26156).toFixed(1)} LY</text>
            </g>
          );
        })}
        <line x1="26" y1="46" x2="236" y2="46" stroke={AD} strokeWidth="1" strokeDasharray="2 4" />
        <Dim x1={20} x2={236} y={96} text="LIGHT TRAVEL MEASURED IN YEARS, NOT MINUTES" c={CY} />
      </Svg>
      <Note>
        LOCAL BUBBLE · REAL CATALOGUE. {STARS.length} STARS FROM HYG v4.1, POSITIONED BY MEASURED
        PARALLAX IN THREE DIMENSIONS — DRAGGING MOVES YOU THROUGH A VOLUME, NOT ACROSS A SKY DOME.
      </Note>
    </>
  );
}

export function PlateOort() {
  return (
    <>
      <Svg>
        <LogAxis
          unit="AU"
          marks={[
            [1, '1'], [BOUNDS.kuiperInner, '30'], [BOUNDS.heliopause, '123'],
            [BOUNDS.oortInner, '2,000'], [20000, '20,000'], [BOUNDS.oortOuter, '100,000'],
          ]}
          y={72}
        />
        <circle cx="18" cy="40" r="3" fill={YE} />
        <text x="18" y="30" fill={YE} textAnchor="middle">SUN</text>
        <text x="112" y="30" fill={CY} textAnchor="middle">HELIOPAUSE</text>
        <text x="196" y="30" fill={BN} textAnchor="middle">OORT SHELL</text>
        <Arrow x1={22} y1={40} x2={232} y2={40} c={AD} />
        <text x="14" y="118" fill={RD}>NO OORT OBJECT HAS EVER BEEN DIRECTLY OBSERVED</text>
      </Svg>
      <Note>
        OORT SHELL · MODELLED. THE SHELL IS INFERRED FROM LONG-PERIOD COMET ORBITS, NOT IMAGED.
        THE POINT CLOUD IS A UNIFORM SAMPLE FOR SCALE, NOT A CATALOGUE OF BODIES.
      </Note>
    </>
  );
}

export function PlateOuter() {
  return (
    <>
      <Svg>
        <LogAxis
          unit="AU"
          marks={[
            [1, 'EARTH 1'], [5.2, 'JUP 5.2'], [9.55, 'SAT 9.6'],
            [19.2, 'URA 19.2'], [30.1, 'NEP 30.1'], [BOUNDS.heliopause, 'HP 123'],
          ]}
          y={70}
        />
        <text x="14" y="34" fill={CY}>TERMINATION SHOCK 94 AU · VOYAGER 1, 2004</text>
        <text x="14" y="46" fill={CY}>HELIOPAUSE 123 AU · VOYAGER 1, 2012-AUG</text>
        <text x="14" y="118" fill={AM}>
          KUIPER BELT {BOUNDS.kuiperInner}–{BOUNDS.kuiperOuter} AU
        </text>
      </Svg>
      <Note>
        OUTER SYSTEM · MEAN ELEMENTS. PLANET POSITIONS COME FROM CIRCULAR MEAN LONGITUDES AT J2000,
        ACCURATE TO ABOUT A DEGREE. THE TWO BOUNDARIES ARE MEASURED SPACECRAFT CROSSINGS.
      </Note>
    </>
  );
}

export function PlateHelio({ sw }: { sw: Snapshot['sw'] }) {
  const days = AU / (sw.speed || 400) / 86400;
  return (
    <>
      <Svg>
        <circle cx="20" cy="60" r="15" fill="none" stroke={YE} strokeWidth="1" />
        <circle cx="20" cy="60" r="8" fill="none" stroke={YE} strokeWidth="1" opacity=".45" />
        {[0, 1, 2, 3, 4].map(k => (
          <path
            key={k}
            d={`M32 ${44 + k * 8} C 90 ${38 + k * 11}, 150 ${52 + k * 5}, 196 ${58 + k}`}
            fill="none"
            stroke={sw.bz < 0 ? RD : CY}
            strokeWidth="1"
            opacity={0.5 - k * 0.05}
          />
        ))}
        <circle cx="204" cy="60" r="5" fill="none" stroke={CY} strokeWidth="1.2" />
        <path d="M192 44 A 22 22 0 0 0 192 76" fill="none" stroke={GR} strokeWidth="1" opacity=".8" />
        <text x="20" y="88" fill={YE} textAnchor="middle">SUN</text>
        <text x="212" y="52" fill={CY}>EARTH</text>
        <text x="176" y="98" fill={GR}>MAGNETOPAUSE</text>
        <text x="110" y="30" fill={sw.bz < 0 ? RD : CY} textAnchor="middle">
          SOLAR WIND · Bz {sw.bz.toFixed(1)} NT
        </text>
        <Dim x1={20} x2={204} y={118} text={`1 AU · TRANSIT ${days.toFixed(1)} D AT ${sw.speed.toFixed(0)} KM/S`} />
      </Svg>
      <Note>
        SOLAR WIND GEOMETRY · NOT TO SCALE. THE STREAM LAG IS THE PARKER SPIRAL; THE MAGNETOPAUSE
        STANDOFF SCALES WITH WIND PRESSURE, SO IT MOVES WITH THE LIVE READING.
      </Note>
    </>
  );
}

export function PlateEncounter({ data }: { data: Snapshot }) {
  const o = data.neo[0];
  if (!o) return <Note>NO ELEMENTS AVAILABLE</Note>;
  const ld = (o.dist * AU) / LD;
  return (
    <>
      <Svg>
        {[34, 58, 82].map((r, k) => (
          <circle key={r} cx="186" cy="66" r={r} fill="none" stroke={AD} strokeWidth="1" strokeDasharray={k ? '2 4' : undefined} />
        ))}
        <circle cx="186" cy="66" r="11" fill="none" stroke={CY} strokeWidth="1.2" />
        <text x="186" y="69" fill={CY} textAnchor="middle">⊕</text>
        <path d="M18 22 L34 16 L48 24 L44 38 L28 42 L14 34 Z" fill="none" stroke={RD} strokeWidth="1.2" />
        <Arrow x1={50} y1={30} x2={140} y2={52} c={RD} />
        <path d="M56 34 C 110 50, 150 74, 168 108" fill="none" stroke={RD} strokeWidth="1" strokeDasharray="4 3" opacity=".7" />
        <text x="16" y="52" fill={RD}>{o.des}</text>
        <text x="92" y="30" fill={RD}>V {o.v.toFixed(2)} KM/S</text>
        <text x="152" y="34" fill={YE}>1 LD RING</text>
        <Dim x1={152} x2={186} y={118} text={`MISS ${ld.toFixed(2)} LD`} c={YE} />
      </Svg>
      <Note>
        ENCOUNTER GEOMETRY · NOT TO SCALE. RINGS ARE LUNAR DISTANCES. THE MISS FIGURE IS THE
        PUBLISHED NOMINAL FOR A FUTURE PASS, NOT AN OBSERVED ONE.
      </Note>
    </>
  );
}

export function PlateGeo({ sats }: { sats: SatState[] }) {
  const iss = sats.find(s => s.name === 'ISS (ZARYA)') ?? sats[0];
  if (!iss) return <Note>NO ELEMENTS AVAILABLE</Note>;
  return (
    <>
      <Svg>
        <rect x="106" y="40" width="38" height="22" fill="none" stroke={AM} strokeWidth="1.2" />
        <rect x="58" y="34" width="44" height="34" fill="none" stroke="var(--color-series-b)" strokeWidth="1" />
        <rect x="148" y="34" width="44" height="34" fill="none" stroke="var(--color-series-b)" strokeWidth="1" />
        {[0, 1, 2, 3, 4, 5].flatMap(k => [
          <line key={`l${k}`} x1={58 + k * 7.3} y1="34" x2={58 + k * 7.3} y2="68" stroke="var(--color-series-b)" strokeWidth=".6" opacity=".55" />,
          <line key={`r${k}`} x1={148 + k * 7.3} y1="34" x2={148 + k * 7.3} y2="68" stroke="var(--color-series-b)" strokeWidth=".6" opacity=".55" />,
        ])}
        <line x1="125" y1="40" x2="125" y2="24" stroke={AM} strokeWidth="1" />
        <path d="M117 24 A 8 8 0 0 1 133 24" fill="none" stroke={GR} strokeWidth="1" />
        <text x="80" y="80" fill="var(--color-series-b)" textAnchor="middle">SOLAR ARRAY</text>
        <text x="170" y="80" fill="var(--color-series-b)" textAnchor="middle">SOLAR ARRAY</text>
        <text x="125" y="20" fill={GR} textAnchor="middle">DOWNLINK</text>
        <path d="M6 126 A 150 150 0 0 1 244 126" fill="none" stroke={AM} strokeWidth="1" />
        <path d="M10 106 A 148 148 0 0 1 240 106" fill="none" stroke={GR} strokeWidth="1" strokeDasharray="4 3" opacity=".7" />
        <text x="30" y="122" fill={AM}>EARTH LIMB</text>
        <text x="196" y="102" fill={GR}>ORBIT</text>
        <Dim
          x1={106} x2={144} y={96} c={YE}
          text={`MEAN ALT ${Math.round(iss.alt).toLocaleString('en-US')} KM · ${iss.per.toFixed(1)} MIN`}
        />
      </Svg>
      <Note>
        SATELLITE BUS · GENERIC, NOT A SPECIFIC SPACECRAFT. THE ALTITUDE AND PERIOD ARE THE REAL
        PROPAGATED VALUES FOR {iss.name}.
      </Note>
    </>
  );
}

export function PlateSurface({ data }: { data: Snapshot }) {
  const big = data.eq.reduce((a, b) => (b.mag > a.mag ? b : a), data.eq[0]);
  const fl = Math.max(0, ...data.fl.map(f => f.alt));
  return (
    <>
      <Svg>
        <line x1="6" y1="72" x2="244" y2="72" stroke={AM} strokeWidth="1.2" />
        {Array.from({ length: 12 }, (_, k) => (
          <line key={k} x1={8 + k * 20} y1="72" x2={2 + k * 20} y2="80" stroke={AD} strokeWidth=".8" />
        ))}
        <path d="M6 56 l10 -6 l7 12 l8 -20 l9 24 l7 -16 l10 8 l9 -3 l120 0" fill="none" stroke={GR} strokeWidth="1" />
        <text x="20" y="42" fill={GR}>SEISMOGRAM</text>
        <path d="M84 106 l4 -7 l4 7 l7 1 l-5 6 l2 7 l-8 -4 l-8 4 l2 -7 l-5 -6 Z" fill={RD} />
        {[[-26, -30], [0, -34], [26, -30]].map(([dx, dy], k) => (
          <Arrow key={k} x1={88} y1={104} x2={88 + dx} y2={104 + dy} c={RD} />
        ))}
        {big && (
          <text x="88" y="126" fill={RD} textAnchor="middle">
            HYPOCENTRE {big.dep.toFixed(0)} KM · M {big.mag.toFixed(1)}
          </text>
        )}
        <path d="M196 18 l4 10 l-4 -2 l-4 2 Z" fill={CY} />
        <line x1="196" y1="30" x2="196" y2="70" stroke={CY} strokeWidth="1" strokeDasharray="3 3" />
        <text x="204" y="22" fill={CY}>FL{String(Math.round(fl / 100)).padStart(3, '0')}</text>
        <text x="204" y="52" fill={CY}>{Math.round(fl * 0.3048).toLocaleString('en-US')} M</text>
      </Svg>
      <Note>
        DEPTH SECTION · NOT TO SCALE. HYPOCENTRE DEPTH AND MAGNITUDE ARE THE LARGEST EVENT IN THE
        CURRENT USGS WINDOW; THE FLIGHT LEVEL IS THE HIGHEST AIRCRAFT IN VIEW.
      </Note>
    </>
  );
}
