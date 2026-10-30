'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AU, clamp, deriveSat, isoZ, LD, tMinus } from '@/lib/astro';
import { detailOf } from '@/lib/detail';
import { anchorAt, anchorLabel, drawFrame, LAND_REF, type Mark, type Sel } from '@/lib/draw';
import { LAND } from '@/lib/land';
import { alphaOf, DEC_PER_PX, dominant, fmtScale, LMAX, LMIN, N_REG, railFrac, REG } from '@/lib/regimes';
import type { Snapshot, System } from '@/lib/types';
import Brief from './Brief';
import Docs from './Docs';
import ObjectLog, { type SurfMode } from './ObjectLog';
import { Rows } from './Ui';

const TONE_VAR: Record<string, string> = {
  live: 'var(--color-live)',
  hazard: 'var(--color-hazard)',
  caution: 'var(--color-caution)',
  'series-a': 'var(--color-series-a)',
};

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
  const [camView, setCamView] = useState({ lat: 14, lon: 78 });
  const [rate, setRate] = useState<number>(1);
  const [held, setHeld] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  // Overlays are opt-out, not structural: the canvas never gives up space.
  const [showLog, setShowLog] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
  const [showBrief, setShowBrief] = useState(true);
  const [bare, setBare] = useState(false);
  const [panned, setPanned] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [flashed, setFlashed] = useState(false);
  // Falls back to a fixed point until the visitor allows geolocation.
  const [obs, setObs] = useState({ lat: 12.97, lon: 77.59, label: 'BLR', live: false });
  /** A foreign star whose system replaces ours on the inner rungs. */
  const [focus, setFocus] = useState<System | null>(null);

  const heroRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const L = useRef(REG[0].L);
  const target = useRef<number | null>(null);
  const cam = useRef({ lat: 14, lon: 78 });
  const sim = useRef(initial.t);
  const wall = useRef(0);
  const marks = useRef<Mark[]>([]);
  /** Free pan, in screen radii, so it holds its visual position across zoom. */
  const pan = useRef({ x: 0, y: 0 });
  const obsRef = useRef(obs);
  obsRef.current = obs;
  const focusRef = useRef<System | null>(null);
  focusRef.current = focus;
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

  /* ── per-viewport defaults + rung transitions ────────────────── */
  useEffect(() => { if (matchMedia('(max-width: 1023px)').matches) setShowLog(false); }, []);

  const prevDom = useRef(dom);
  useEffect(() => {
    if (prevDom.current !== dom) { prevDom.current = dom; setFlashed(true); }
  }, [dom]);

  // On the mobile strip, keep the current rung in view.
  useEffect(() => {
    if (!matchMedia('(max-width: 767px)').matches) return;
    navRef.current?.querySelector('[aria-current=true]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [dom, bare]);

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
    let camCommitted = { ...cam.current };

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
        anchor: anchorAt(L.current, sim.current, focusRef.current),
        pan: pan.current,
        observer: obsRef.current,
        focus: focusRef.current,
      });

      if (Math.abs(L.current - committed) > 1e-4) {
        committed = L.current;
        setUiL(L.current);
      }
      if (Math.abs(cam.current.lat - camCommitted.lat) > 0.05
        || Math.abs(cam.current.lon - camCommitted.lon) > 0.05) {
        camCommitted = { ...cam.current };
        setCamView(camCommitted);
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

  /* ── where the visitor actually is ───────────────────────────── */
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = +pos.coords.latitude.toFixed(4);
        const lon = +pos.coords.longitude.toFixed(4);
        setObs({ lat, lon, label: 'YOU', live: true });
        // Face the globe at them, so descending lands where they are.
        cam.current = { lat, lon };
      },
      () => { /* denied or unavailable: the default observer stands */ },
      { timeout: 8000, maximumAge: 600000 },
    );
  }, []);

  /* ── input ───────────────────────────────────────────────────── */
  const jump = useCallback((i: number) => { target.current = REG[i].L; setZoomed(true); setTip(null); }, []);

  const recentre = useCallback(() => {
    pan.current = { x: 0, y: 0 };
    setPanned(false);
    setTip(null);
  }, []);

  /** Put the visitor's own ground under the crosshair. */
  const locate = useCallback(() => {
    const o = obsRef.current;
    cam.current = { lat: o.lat, lon: o.lon };
    pan.current = { x: 0, y: 0 };
    setPanned(false);
    target.current = REG[REG.length - 1].L;
    setTip(null);
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomed(true);
      const next = clamp(L.current + clamp(e.deltaY, -260, 260) * DEC_PER_PX, LMIN, LMAX);
      if (next === L.current) return;      // at an end stop
      target.current = null;
      L.current = next;
      setUiL(next);
      setTip(null);
    };
    hero.addEventListener('wheel', onWheel, { passive: false });

    // Two gestures on one surface: plain drag flies the plane, a modified
    // drag orbits the camera. Both were wanted; a mode switch would have
    // meant reaching for a control mid-flight.
    let drag: { x: number; y: number; id: number; orbit: boolean } | null = null;
    let moved = 0;
    const isOrbit = (e: PointerEvent) => e.shiftKey || e.ctrlKey || e.altKey || e.button === 2;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-ladder]')) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId, orbit: isOrbit(e) };
      moved = 0;
      hero.style.cursor = drag.orbit ? 'grabbing' : 'move';
      hero.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (drag.orbit) {
        cam.current.lon -= dx * 0.32;
        cam.current.lat = clamp(cam.current.lat + dy * 0.28, -88, 88);
      } else {
        const R = Math.min(size.current.w, size.current.h) * 0.46 || 1;
        pan.current.x += dx / R;
        pan.current.y += dy / R;
        if (moved > 6) setPanned(true);
      }
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
      hero.style.cursor = 'grab';
    };
    hero.addEventListener('contextmenu', (e: Event) => e.preventDefault());
    hero.addEventListener('pointerdown', down);
    hero.addEventListener('pointermove', move);
    hero.addEventListener('pointerup', up);
    hero.addEventListener('pointercancel', () => { drag = null; });

    // One finger pans (handled by the pointer events above); two fingers
    // pinch to zoom and twist to orbit.
    let pinch = 0;
    let twist = 0;
    const gap = (e: TouchEvent) => Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    const angleOf = (e: TouchEvent) => Math.atan2(
      e.touches[1].clientY - e.touches[0].clientY,
      e.touches[1].clientX - e.touches[0].clientX);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinch = gap(e); twist = angleOf(e); }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      const d = gap(e), th = angleOf(e);
      setZoomed(true);
      target.current = null;
      L.current = clamp(L.current - Math.log10(d / pinch) * 1.4, LMIN, LMAX);
      cam.current.lon -= ((th - twist) * 180) / Math.PI;
      pinch = d; twist = th;
      setUiL(L.current);
    };
    hero.addEventListener('touchstart', ts, { passive: true });
    hero.addEventListener('touchmove', tm, { passive: true });
    hero.addEventListener('touchend', () => { pinch = 0; }, { passive: true });

    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches?.('input,textarea')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setZoomed(true);
        target.current = null;
        L.current = clamp(L.current + (e.key === 'ArrowDown' ? 0.25 : -0.25), LMIN, LMAX);
        setUiL(L.current);
      }
      const n = Number(e.key);
      if (n >= 1 && n <= N_REG) jump(n - 1);
      if (e.key === 'l') setShowLog(v => !v);
      if (e.key === 'r') setShowDocs(v => !v);
      if (e.key === 'h') setBare(v => !v);
      if (e.key === 'b') setShowBrief(v => !v);
      if (e.key === 'c') recentre();
      if (e.key === 'g') locate();
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
  }, [jump, recentre, locate]);

  /* ── readouts ────────────────────────────────────────────────── */
  const hw = Math.pow(10, uiL);
  const detail = detailOf(sel, data, sats, tick, focus);
  const onDetent = REG.some(r => Math.abs(r.L - uiL) < 0.07);
  const pipTop = `${clamp(railFrac(uiL), 0, 1) * 100}%`;

  /** Descend into the selected star's system. */
  const flyToSystem = (sy: System) => {
    setFocus(sy);
    pan.current = { x: 0, y: 0 };
    setPanned(false);
    setSel(null);
    setTip(null);
    // Frame the system by its own outermost orbit. A fixed rung would land at
    // 1.9 AU, where Proxima's planets at 0.03 AU are sub-pixel.
    const outer = Math.max(0.02, ...sy.planets.map(p => p.a ?? 0));
    target.current = clamp(Math.log10(outer * 2.4 * AU), LMIN, LMAX);
  };
  const returnToSol = () => {
    setFocus(null);
    pan.current = { x: 0, y: 0 };
    setPanned(false);
    setSel(null);
    setTip(null);
    target.current = REG[4].L;
  };

  const goToEncounter = () => {
    if (!detail?.jumpMs) return;
    sim.current = detail.jumpMs - 5400000;
    setHeld(false);
    setTick(sim.current);
    if (Math.abs(L.current - REG[5].L) > 0.35) target.current = REG[5].L;
  };

  return (
    <div className="stage select-none" ref={heroRef} style={{ cursor: 'grab' }}>
      <canvas ref={cvRef} className="absolute inset-0 z-0 block h-full w-full" />

      {!bare && (
        <>
          {/* ── header block: sits inside the view, never above it ── */}
          <div className="pointer-events-none absolute right-0 top-0 z-[3] flex flex-col items-end px-[14px] pt-4 text-right">
            <span key={dom} className="tab anim-pop pointer-events-auto !left-auto !right-3 !top-2">{REG[dom].tab}</span>
            <h1 className="t-display hdr-title glow-display anim-boot mt-6 max-w-[13ch]">
              Everything Everywhere All&nbsp;at&nbsp;Once
            </h1>
            <p className="knock anim-rise mt-[6px] font-ui text-[10.5px] font-medium uppercase tracking-[0.2em] text-chrome max-md:hidden"
              style={{ animationDelay: '120ms' }}>
              One descent · galaxy to ground · eight regimes
            </p>
            <div className="mt-[10px] flex flex-col items-end gap-[2px] font-data text-[10px] leading-snug text-chrome-dim tabular-nums">
              <p className="knock anim-rise" style={{ animationDelay: '200ms' }}>{counts(dom, data)}</p>
              <p className="knock anim-rise max-md:hidden" style={{ animationDelay: '280ms' }}>
                VIEW HALF-WIDTH <b className="text-live">{fmtScale(hw)}</b> ·{' '}
                LOG₁₀ KM <b className="text-caution">{uiL.toFixed(2)}</b>
              </p>
              {focus && (
                <p className="knock">
                  FOCUSED <b className="text-caution">{focus.host.toUpperCase()}</b> ·{' '}
                  <b className="text-live">{(focus.dist * 3.26156).toFixed(2)} LY</b> ·{' '}
                  {focus.planets.length} PLANET(S)
                </p>
              )}
              <details className="telemetry mt-[2px]">
                <summary className="btn pointer-events-auto ml-auto w-fit list-none">Telemetry ▸</summary>
                <div className="mt-[6px] flex flex-col items-end gap-[2px]">
                  <p className="knock">SRC · NOAA SWPC · JPL SSD/CNEOS · CELESTRAK · USGS · ADSB.LOL · HYG</p>
                  <p className="knock">
                    SIM <b className="text-live">{isoZ(tick)}</b> · ×{rate}{held ? ' · HELD' : ''}
                  </p>
                  <p className="knock">
                    CENTRE <b className="text-caution">{anchorLabel(uiL, focus)}</b>
                    {panned && <> · PANNED <b className="text-hazard">OFF AXIS</b></>}
                  </p>
                  <p className="knock">
                    VIEW <b className="text-caution">
                      {camView.lat >= 0 ? '+' : ''}{camView.lat.toFixed(1)}°{' '}
                      {(((camView.lon % 360) + 360) % 360).toFixed(1)}°
                    </b> · SHIFT-DRAG TO ORBIT
                  </p>
                  <p className="knock">
                    OBSERVER <b className={obs.live ? 'text-live' : 'text-chrome-dim'}>
                      {obs.live
                        ? `${Math.abs(obs.lat).toFixed(2)}${obs.lat >= 0 ? 'N' : 'S'} ${Math.abs(obs.lon).toFixed(2)}${obs.lon >= 0 ? 'E' : 'W'}`
                        : 'DEFAULT · BLR'}
                    </b>
                  </p>
                </div>
              </details>
            </div>
          </div>

          {/* ── regime change banner: translate on the wrapper, animation inside ── */}
          {flashed && (
            <div key={dom} className="pointer-events-none absolute left-1/2 top-[38%] z-[3] -translate-x-1/2 text-center">
              <div className="regime-flash">
                <p className="t-display glow-display" style={{ color: 'var(--color-chrome)', fontSize: 'clamp(1.4rem, 4vw, 3rem)' }}>
                  {REG[dom].tab}
                </p>
                <p className="t-data knock mt-1">{fmtScale(REG[dom].hw)}</p>
              </div>
            </div>
          )}

          {/* ── scroll cue: until the first zoom ── */}
          {!zoomed && (
            <div className="pointer-events-none absolute left-1/2 top-[44%] z-[4] -translate-x-1/2">
              <span className="bob knock font-ui text-[10.5px] font-semibold uppercase tracking-[0.18em] text-live">
                <span className="max-md:hidden">Scroll to descend ↓</span>
                <span className="md:hidden">Pinch to descend</span>
              </span>
            </div>
          )}

          {/* ── log ladder: rung position ∝ log10 distance ── */}
          <nav
            ref={navRef}
            data-ladder
            aria-label="Scale ladder"
            className="ladder anim-rise z-[5]"
            style={{ animationDelay: '200ms' }}
          >
            <span
              aria-hidden="true"
              className="ladder-rail absolute bottom-0 top-0 w-px"
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
              className="ladder-rail absolute h-px w-[15px] -translate-x-1/2 -translate-y-1/2 bg-live"
              style={{ left: 'calc(82px + 11px)', top: pipTop, boxShadow: '0 0 7px var(--color-live)' }}
            />
            {!onDetent && (
              <span
                aria-hidden="true"
                className="ladder-rail absolute -translate-y-1/2 whitespace-nowrap font-data text-[9px] text-live"
                style={{ left: 'calc(82px + 24px)', top: pipTop }}
              >
                {fmtScale(hw)}
              </span>
            )}
          </nav>

          {/* ── click callout ── */}
          {tip && detail && (
            <div
              className="overlay anim-pop absolute z-[7] max-w-[216px] px-2 pb-[6px] pt-[7px]"
              style={{
                left: clamp(tip.x + 14, 8, Math.max(8, size.current.w - 232)),
                top: clamp(tip.y - 10, 8, Math.max(8, size.current.h - 200)),
              }}
            >
              <div className="mb-[5px] border-b border-dotted border-b-[color-mix(in_srgb,var(--color-chrome)_35%,transparent)] pb-[5px]">
                <p className="flex items-baseline gap-[6px]">
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
                <p
                  className="mt-[2px] font-ui text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: TONE_VAR[detail.tone] }}
                >
                  {detail.kind}
                </p>
              </div>
              <Rows items={detail.rows.slice(0, 6)} />
              {detail.jumpMs && (
                <button type="button" className="btn mt-[6px] w-full" onClick={goToEncounter}>
                  Go to encounter
                </button>
              )}
              {sel?.kind === 'system' && data.sys[sel.i] && (
                <button type="button" className="btn mt-[6px] w-full"
                  onClick={() => flyToSystem(data.sys[sel.i])}>
                  Fly to system
                </button>
              )}
            </div>
          )}

          {/* ── object log: floats, collapses to nothing ── */}
          {showLog && (
            <div
              className="overlay anim-sheet log-sheet absolute right-2 z-[6] flex w-[min(330px,42vw)] flex-col"
              style={{ top: 'calc(58% - 8px)', bottom: showDocs ? 'calc(58vh + 46px)' : '76px' }}
            >
              <ObjectLog
                dom={dom} data={data} sats={sats} sel={sel} simT={tick}
                focus={focus}
                mode={mode}
                onSelect={s => { setSel(s); setTip(null); }}
                onMode={setMode}
                onClose={() => setShowLog(false)}
                onFly={flyToSystem}
                onReturn={returnToSol}
              />
            </div>
          )}

          {/* ── readouts drawer ── */}
          {showDocs && (
            <div
              className="drawer anim-sheet absolute bottom-[38px] left-0 right-0 z-[8] h-[58vh] overflow-y-auto border-t"
              style={{ borderTopColor: 'var(--hair)', background: 'rgba(5,6,10,0.94)' }}
            >
              <Docs dom={dom} data={data} sats={sats} simT={tick} />
            </div>
          )}

          {/* ── briefing: what this rung actually is ── */}
          {showBrief && (
            <div
              className="brief-wrap absolute z-[4]"
              style={showDocs ? { bottom: 'calc(58vh + 60px)' } : undefined}
            >
              <Brief dom={dom} focus={focus} />
            </div>
          )}

          {/* ── legend + affordances ── */}
          <div
            className="hint-bar absolute left-0 right-0 z-[4] flex flex-wrap items-center gap-y-1 gap-x-[13px] px-3 py-[7px]"
            style={{ bottom: showDocs ? 'calc(58vh + 38px)' : '38px' }}
          >
            <span className="t-label knock max-md:hidden">{REG[dom].tag}</span>
            <span className="knock font-ui text-[9.5px] font-semibold uppercase tracking-[0.13em] text-chrome-dim max-md:hidden">
              Rung {dom + 1} of {N_REG} · blend {(alphaOf(dom, uiL) * 100).toFixed(0)}%
            </span>
            <span className="fade-hint knock ml-auto hidden font-ui text-[9.5px] font-medium uppercase tracking-[0.14em] text-chrome-dim lg:inline">
              Wheel · zoom | Drag · pan | Shift-drag · orbit | 1–8 · jump | B · brief | C · recentre | G · locate
            </span>
            <span className="knock font-ui text-[9.5px] font-medium uppercase tracking-[0.14em] text-chrome-dim md:hidden">
              Pinch · zoom &nbsp; Drag · pan &nbsp; Tap · inspect
            </span>
          </div>
        </>
      )}

      {/* ── mission rail ── */}
      <footer className="anim-rise absolute bottom-0 left-0 right-0 z-[9] flex items-center gap-[9px] overflow-x-auto border-t bg-void px-3 py-[6px]"
        style={{ borderTopColor: 'var(--hair)', scrollbarWidth: 'none', animationDelay: '360ms' }}>
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

        <span className="mx-1 h-[14px] w-px shrink-0 bg-[var(--hair)]" />
        <button type="button" className="btn" aria-pressed={showLog} onClick={() => setShowLog(v => !v)}>
          Log
        </button>
        <button type="button" className="btn" aria-pressed={showBrief} onClick={() => setShowBrief(v => !v)}>
          Brief
        </button>
        <button type="button" className="btn" aria-pressed={showDocs} onClick={() => setShowDocs(v => !v)}>
          Readouts
        </button>
        <button type="button" className="btn" aria-pressed={bare} onClick={() => setBare(v => !v)}>
          {bare ? 'Show chrome' : 'Clear view'}
        </button>
        <span className="mx-1 h-[14px] w-px shrink-0 bg-[var(--hair)]" />
        <button type="button" className="btn" onClick={locate}>
          {obs.live ? 'Locate me' : 'Locate'}
        </button>
        <button type="button" className="btn" aria-pressed={panned} onClick={recentre}>
          Recentre
        </button>
        {focus && (
          <button type="button" className="btn" aria-pressed onClick={returnToSol}>
            Return to Sol
          </button>
        )}

        <span className="t-label ml-auto hidden whitespace-nowrap lg:inline">Mission time</span>
        <span className="relative hidden h-px min-w-[30px] max-w-[240px] flex-1 bg-[color-mix(in_srgb,var(--color-chrome)_40%,transparent)] lg:block">
          <span
            className="absolute -top-1 h-[9px] w-2 bg-live"
            style={{ left: `calc(${(((tick % 86400000) / 86400000) * 100).toFixed(2)}% - 4px)` }}
          />
        </span>
        {!held && <span className="live-dot hidden shrink-0 sm:block" />}
        <span
          className="hidden whitespace-nowrap font-data text-[11px] tabular-nums sm:inline"
          style={{ color: held ? 'var(--color-caution)' : 'var(--color-live)' }}
        >
          {isoZ(tick)}
        </span>
      </footer>
    </div>
  );
}
