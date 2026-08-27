'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AU, clamp, deriveSat, isoZ, LD, tMinus } from '@/lib/astro';
import { detailOf } from '@/lib/detail';
import { anchorAt, anchorLabel, drawFrame, LAND_REF, type Mark, type Sel } from '@/lib/draw';
import { LAND } from '@/lib/land';
import { alphaOf, DEC_PER_PX, dominant, fmtScale, LMAX, LMIN, N_REG, railFrac, REG } from '@/lib/regimes';
import type { Snapshot } from '@/lib/types';
import Docs from './Docs';
import ObjectLog, { type SurfMode } from './ObjectLog';
import { Rows } from './Ui';

const RATES = [1, 120, 3600] as const;
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');

/** Per-regime header counts — the numbers that matter at that scale. */
function counts(dom: number, d: Snapshot) {
  const sats = d.satTotals;
  const all = sats.ISS + sats.GPS + sats.GEO + sats.STL + sats.OWB;
  const hz = (v: string) => <b className="text-hazard">{v}</b>;
  const lv = (v: string) => <b className="text-live">{v}</b>;
  switch (dom) {
    case 0: return <>RADIUS {lv('26,700 LY')} · ARM {hz('ORION SPUR')} · PERIOD {lv('230 MYR')}</>;
    case 1: return <>STARS {lv(String(d.sw ? 998 : 0))} · WITHIN {hz('560 LY')} · PARALLAX MEASURED</>;
    case 2: return <>SHELL {hz('2,000–100,000 AU')} · OBSERVED {hz('NONE')}</>;
    case 3: return <>HELIOPAUSE {lv('123 AU')} · KUIPER {hz('30–50 AU')}</>;
    case 4: return <>PLOTTED {hz(String(d.neo.length))} · TRACKED {hz(n0(d.neoTotal))} · KP {lv(d.sw.kp.toFixed(2))} · WIND {lv(`${d.sw.speed.toFixed(0)} KM/S`)}</>;
    case 5: return <>APPROACHES {hz(n0(d.neoTotal))} · PLOTTED {hz(String(d.neo.length))} · NEAREST {lv(d.neo[0] ? `${((d.neo[0].dist * AU) / LD).toFixed(2)} LD` : '—')}</>;
    case 6: return <>CATALOGUE {lv(n0(all))} · PROPAGATED {lv(String(d.sat.length))} · AURORA {lv(`${d.sw.aurLat.toFixed(0)}°N`)}</>;
    default: return <>EVENTS {hz(String(d.eqTotal))} · M4.5+ 7D · AIRCRAFT {lv(String(d.flTotal))} · OBSERVER BLR</>;
  }
}

export default function Console({ initial }: { initial: Snapshot }) {
  const [data, setData] = useState(initial);
  const [uiL, setUiL] = useState(REG[0].L);
  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<SurfMode>('eq');
  const [tick, setTick] = useState(initial.t);
  const [rate, setRate] = useState<number>(1);
  const [held, setHeld] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  // Overlays are opt-out, not structural: the canvas never gives up space.
  const [showLog, setShowLog] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
  const [bare, setBare] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const L = useRef(REG[0].L);
  const target = useRef<number | null>(null);
  const cam = useRef({ lat: 14, lon: 78 });
  const sim = useRef(initial.t);
  const wall = useRef(0);
  const marks = useRef<Mark[]>([]);
  const selRef = useRef<Sel>(null);
  const rateRef = useRef(1);
  const heldRef = useRef(false);
  const dataRef = useRef(initial);
  const size = useRef({ w: 0, h: 0 });

  selRef.current = sel;
  rateRef.current = rate;
  heldRef.current = held;
  dataRef.current = data;

  const sats = useMemo(() => data.sat.map(deriveSat), [data.sat]);
  const satsRef = useRef(sats);
  satsRef.current = sats;

  const dom = dominant(uiL);
  const reduced = useRef(false);

  LAND_REF.value = LAND;

  /* ── canvas loop ─────────────────────────────────────────────── */
  useEffect(() => {
    reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let px = 1;
    const resize = () => {
      px = Math.min(2, devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      size.current = { w, h };
      cv.width = Math.round(w * px);
      cv.height = Math.round(h * px);
      ctx.setTransform(px, 0, 0, px, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    wall.current = performance.now();
    let committed = L.current;

    const loop = () => {
      const now = performance.now();
      const dt = now - wall.current;
      wall.current = now;
      if (!heldRef.current) sim.current += dt * rateRef.current;

      if (target.current !== null) {
        const step = 2.6 * (dt / 1000);          // decades per second, linear
        const d = target.current - L.current;
        if (Math.abs(d) < step) { L.current = target.current; target.current = null; }
        else L.current += Math.sign(d) * step;
      }

      marks.current = drawFrame(ctx, {
        W: size.current.w, H: size.current.h,
        L: L.current,
        camLat: cam.current.lat, camLon: cam.current.lon,
        simT: sim.current,
        data: dataRef.current,
        sats: satsRef.current,
        sel: selRef.current,
        reduced: reduced.current,
        anchor: anchorAt(L.current, sim.current),
      });

      if (Math.abs(L.current - committed) > 1e-4) {
        committed = L.current;
        setUiL(L.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  /* ── 1 Hz readouts ───────────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => setTick(sim.current), 1000);
    return () => clearInterval(id);
  }, []);

  /* ── live refresh ────────────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/snapshot');
        if (r.ok) setData(await r.json());
      } catch { /* a missed poll is not worth surfacing; the next one retries */ }
    }, 60000);
    return () => clearInterval(id);
  }, []);

  /* ── input ───────────────────────────────────────────────────── */
  const jump = useCallback((i: number) => { target.current = REG[i].L; setTip(null); }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = clamp(L.current + clamp(e.deltaY, -260, 260) * DEC_PER_PX, LMIN, LMAX);
      if (next === L.current) return;      // at an end stop
      target.current = null;
      L.current = next;
      setUiL(next);
      setTip(null);
    };
    hero.addEventListener('wheel', onWheel, { passive: false });

    let drag: { x: number; y: number; id: number } | null = null;
    let moved = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-ladder]')) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      moved = 0;
      hero.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.current.lon -= dx * 0.32;
      cam.current.lat = clamp(cam.current.lat + dy * 0.28, -88, 88);
      drag.x = e.clientX; drag.y = e.clientY;
      if (moved > 6) setTip(null);
    };
    const up = (e: PointerEvent) => {
      if (drag && moved < 6) {
        const r = cvRef.current!.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        let best: Mark | null = null, bd = 15 * 15;
        for (const m of marks.current) {
          const d = (m.x - mx) ** 2 + (m.y - my) ** 2;
          if (d < bd) { bd = d; best = m; }
        }
        if (best) { setSel({ kind: best.kind, i: best.i }); setTip({ x: best.x, y: best.y }); }
        else { setSel(null); setTip(null); }
      }
      drag = null;
    };
    hero.addEventListener('pointerdown', down);
    hero.addEventListener('pointermove', move);
    hero.addEventListener('pointerup', up);
    hero.addEventListener('pointercancel', () => { drag = null; });

    let pinch = 0;
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
      }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      target.current = null;
      L.current = clamp(L.current - Math.log10(d / pinch) * 1.4, LMIN, LMAX);
      pinch = d;
      setUiL(L.current);
    };
    hero.addEventListener('touchstart', ts, { passive: true });
    hero.addEventListener('touchmove', tm, { passive: true });
    hero.addEventListener('touchend', () => { pinch = 0; }, { passive: true });

    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches?.('input,textarea')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        target.current = null;
        L.current = clamp(L.current + (e.key === 'ArrowDown' ? 0.25 : -0.25), LMIN, LMAX);
        setUiL(L.current);
      }
      const n = Number(e.key);
      if (n >= 1 && n <= N_REG) jump(n - 1);
      if (e.key === 'l') setShowLog(v => !v);
      if (e.key === 'r') setShowDocs(v => !v);
      if (e.key === 'h') setBare(v => !v);
    };
    addEventListener('keydown', key);

    return () => {
      hero.removeEventListener('wheel', onWheel);
      hero.removeEventListener('pointerdown', down);
      hero.removeEventListener('pointermove', move);
      hero.removeEventListener('pointerup', up);
      hero.removeEventListener('touchstart', ts);
      hero.removeEventListener('touchmove', tm);
      removeEventListener('keydown', key);
    };
  }, [jump]);

  /* ── readouts ────────────────────────────────────────────────── */
  const hw = Math.pow(10, uiL);
  const detail = detailOf(sel, data, sats, tick);
  const onDetent = REG.some(r => Math.abs(r.L - uiL) < 0.07);
  const pipTop = `${clamp(railFrac(uiL), 0, 1) * 100}%`;

  const goToEncounter = () => {
    if (!detail?.jumpMs) return;
    sim.current = detail.jumpMs - 5400000;
    setHeld(false);
    setTick(sim.current);
    if (Math.abs(L.current - REG[5].L) > 0.35) target.current = REG[5].L;
  };

  return (
    <div className="stage" ref={heroRef} style={{ cursor: 'grab' }}>
      <canvas ref={cvRef} className="absolute inset-0 z-0 block h-full w-full" />

      {!bare && (
        <>
          {/* ── header block: sits inside the view, never above it ── */}
          <div className="pointer-events-none absolute right-0 top-0 z-[3] flex flex-col items-end px-[14px] pt-4 text-right">
            <span className="tab pointer-events-auto !left-auto !right-3 !top-2">{REG[dom].tab}</span>
            <h1 className="t-display glow-display mt-6 max-w-[13ch]">
              Everything Everywhere All&nbsp;at&nbsp;Once
            </h1>
            <p className="knock mt-[6px] font-ui text-[10.5px] font-medium uppercase tracking-[0.2em] text-chrome">
              One descent · galaxy to ground · eight regimes
            </p>
            <div className="mt-[10px] flex flex-col items-end gap-[2px] font-data text-[10px] leading-snug text-chrome-dim tabular-nums">
              <p className="knock">SRC · NOAA SWPC · JPL SSD/CNEOS · CELESTRAK · USGS · ADSB.LOL · HYG</p>
              <p className="knock">{counts(dom, data)}</p>
              <p className="knock">
                SIM <b className="text-live">{isoZ(tick)}</b> · ×{rate}{held ? ' · HELD' : ''}
              </p>
              <p className="knock">
                VIEW HALF-WIDTH <b className="text-live">{fmtScale(hw)}</b> ·{' '}
                LOG₁₀ KM <b className="text-caution">{uiL.toFixed(2)}</b>
              </p>
              <p className="knock">
                CENTRE <b className="text-caution">{anchorLabel(uiL)}</b>
              </p>
            </div>
          </div>

          {/* ── log ladder: rung position ∝ log10 distance ── */}
          <nav
            data-ladder
            aria-label="Scale ladder"
            className="absolute left-3 top-1/2 z-[5] h-[min(72vh,620px)] w-[196px] -translate-y-1/2"
          >
            <span
              aria-hidden="true"
              className="absolute bottom-0 top-0 w-px"
              style={{
                left: 'calc(82px + 11px)',
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-chrome) 12%, transparent),'
                  + ' color-mix(in srgb, var(--color-chrome) 50%, transparent),'
                  + ' color-mix(in srgb, var(--color-chrome) 12%, transparent))',
              }}
            />
            {REG.map((r, i) => (
              <button
                key={r.key}
                type="button"
                className="rung"
                aria-current={i === dom}
                style={{ top: `${railFrac(r.L) * 100}%` }}
                onClick={() => jump(i)}
              >
                <span className="d">{fmtScale(r.hw)}</span>
                <span className="m" />
                <span className="n">{r.tab}</span>
              </button>
            ))}
            <span
              aria-hidden="true"
              className="absolute h-px w-[15px] -translate-x-1/2 -translate-y-1/2 bg-live"
              style={{ left: 'calc(82px + 11px)', top: pipTop, boxShadow: '0 0 7px var(--color-live)' }}
            />
            {!onDetent && (
              <span
                aria-hidden="true"
                className="absolute -translate-y-1/2 whitespace-nowrap font-data text-[9px] text-live"
                style={{ left: 'calc(82px + 24px)', top: pipTop }}
              >
                {fmtScale(hw)}
              </span>
            )}
          </nav>

          {/* ── click callout ── */}
          {tip && detail && (
            <div
              className="overlay absolute z-[7] max-w-[216px] px-2 pb-[6px] pt-[7px]"
              style={{
                left: clamp(tip.x + 14, 8, Math.max(8, size.current.w - 232)),
                top: clamp(tip.y - 10, 8, Math.max(8, size.current.h - 200)),
              }}
            >
              <p className="mb-[5px] flex items-baseline gap-[6px] border-b border-dotted border-b-[color-mix(in_srgb,var(--color-chrome)_35%,transparent)] pb-1">
                <b className="font-data text-[10.5px] text-caution">{detail.title}</b>
                <button
                  type="button"
                  aria-label="Close"
                  className="ml-auto cursor-pointer border-0 bg-transparent px-[2px] font-ui text-[11px] font-semibold text-chrome-dim hover:text-hazard"
                  onClick={() => { setSel(null); setTip(null); }}
                >
                  ✕
                </button>
              </p>
              <Rows items={detail.rows.slice(0, 6)} />
              {detail.jumpMs && (
                <button type="button" className="btn mt-[6px] w-full" onClick={goToEncounter}>
                  Go to encounter
                </button>
              )}
            </div>
          )}

          {/* ── object log: floats, collapses to nothing ── */}
          {showLog && (
            <div
              className="overlay absolute right-2 z-[6] flex w-[min(330px,42vw)] flex-col"
              style={{ top: 'calc(58% - 8px)', bottom: showDocs ? 'calc(58vh + 46px)' : '76px' }}
            >
              <ObjectLog
                dom={dom} data={data} sats={sats} sel={sel} simT={tick}
                mode={mode}
                onSelect={s => { setSel(s); setTip(null); }}
                onMode={setMode}
                onClose={() => setShowLog(false)}
              />
            </div>
          )}

          {/* ── readouts drawer ── */}
          {showDocs && (
            <div
              className="absolute bottom-[38px] left-0 right-0 z-[8] h-[58vh] overflow-y-auto border-t"
              style={{ borderTopColor: 'var(--hair)', background: 'rgba(5,6,10,0.94)' }}
            >
              <Docs dom={dom} data={data} sats={sats} simT={tick} />
            </div>
          )}

          {/* ── legend + affordances ── */}
          <div
            className="absolute left-0 right-0 z-[4] flex flex-wrap items-center gap-y-1 gap-x-[13px] px-3 py-[7px]"
            style={{ bottom: showDocs ? 'calc(58vh + 38px)' : '38px' }}
          >
            <span className="t-label knock">{REG[dom].tag}</span>
            <span className="knock font-ui text-[9.5px] font-semibold uppercase tracking-[0.13em] text-chrome-dim">
              Rung {dom + 1} of {N_REG} · blend {(alphaOf(dom, uiL) * 100).toFixed(0)}%
            </span>
            <span className="knock ml-auto font-ui text-[9.5px] font-medium uppercase tracking-[0.14em] text-chrome-dim">
              Wheel · log zoom | Drag · orbit | 1–8 · jump | L R H · panels
            </span>
          </div>
        </>
      )}

      {/* ── mission rail ── */}
      <footer className="absolute bottom-0 left-0 right-0 z-[9] flex items-center gap-[9px] border-t bg-void px-3 py-[6px]"
        style={{ borderTopColor: 'var(--hair)' }}>
        <button type="button" className="btn" aria-pressed={held} onClick={() => setHeld(h => !h)}>
          {held ? '▶ Resume' : '⏸ Hold'}
        </button>
        {RATES.map(r => (
          <button key={r} type="button" className="btn" aria-pressed={rate === r} onClick={() => setRate(r)}>
            ×{r === 3600 ? '1H' : r}
          </button>
        ))}
        <button
          type="button" className="btn"
          onClick={() => { sim.current = Date.now(); setHeld(false); setRate(1); setTick(sim.current); }}
        >
          Now
        </button>

        <span className="mx-1 h-[14px] w-px bg-[var(--hair)]" />
        <button type="button" className="btn" aria-pressed={showLog} onClick={() => setShowLog(v => !v)}>
          Log
        </button>
        <button type="button" className="btn" aria-pressed={showDocs} onClick={() => setShowDocs(v => !v)}>
          Readouts
        </button>
        <button type="button" className="btn" aria-pressed={bare} onClick={() => setBare(v => !v)}>
          {bare ? 'Show chrome' : 'Clear view'}
        </button>

        <span className="t-label ml-auto hidden whitespace-nowrap lg:inline">Mission time</span>
        <span className="relative hidden h-px min-w-[30px] max-w-[240px] flex-1 bg-[color-mix(in_srgb,var(--color-chrome)_40%,transparent)] lg:block">
          <span
            className="absolute -top-1 h-[9px] w-2 bg-live"
            style={{ left: `calc(${(((tick % 86400000) / 86400000) * 100).toFixed(2)}% - 4px)` }}
          />
        </span>
        <span
          className="whitespace-nowrap font-data text-[11px] tabular-nums"
          style={{ color: held ? 'var(--color-caution)' : 'var(--color-live)' }}
        >
          {isoZ(tick)}
        </span>
      </footer>
    </div>
  );
}
