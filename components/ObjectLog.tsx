'use client';

import { useEffect, useRef } from 'react';
import { AU, LD, PC, PLANETS, type SatState } from '@/lib/astro';
import { BOUNDS } from '@/lib/astro';
import type { Sel } from '@/lib/draw';
import { detailOf } from '@/lib/detail';
import { REG } from '@/lib/regimes';
import { STARS } from '@/lib/stars';
import type { Snapshot } from '@/lib/types';
import { Chip, Rows } from './Ui';

export type SurfMode = 'eq' | 'fl';

type LogRow = { id: string; cells: [string, string, string]; sel?: Sel };
type LogSpec = { tab: string; cols: string; head: [string, string, string]; rows: LogRow[] };

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');

function specFor(dom: number, d: Snapshot, sats: SatState[], mode: SurfMode): LogSpec {
  switch (dom) {
    case 0:
      return {
        tab: 'Scale Reference', cols: '1fr 74px 52px', head: ['Landmark', 'Distance', 'Light'],
        rows: [
          { id: 'gc', cells: ['Galactic centre · Sgr A*', '26,700 LY', '26.7 KYR'] },
          { id: 'disc', cells: ['Disc diameter', '100,000 LY', '100 KYR'] },
          { id: 'per', cells: ['Perseus arm', '~6,400 LY', '6.4 KYR'] },
          { id: 'lb', cells: ['Local Bubble wall', '~150 LY', '150 YR'] },
          { id: 'px', cells: ['Nearest star', '4.25 LY', '4.25 YR'] },
          { id: 'hp', cells: ['Heliopause', '123 AU', '17.0 HR'] },
          { id: 'sun', cells: ['Sun', '1 AU', '8.3 MIN'] },
          { id: 'moon', cells: ['Moon', '1 LD', '1.28 S'] },
        ],
      };
    case 1: {
      const rows = STARS
        .map((s, i) => ({ s, i, pc: Math.hypot(s[0], s[1], s[2]) }))
        .sort((a, b) => a.pc - b.pc)
        .slice(0, 200)
        .map(({ s, i, pc }) => ({
          id: `s${i}`,
          cells: [s[5] || `HYG ${i}`, `${(pc * 3.26156).toFixed(2)}`, s[3].toFixed(2)] as [string, string, string],
          sel: { kind: 'star', i } as Sel,
        }));
      return { tab: 'Star Catalogue', cols: '1fr 54px 40px', head: ['Star', 'LY', 'Mag'], rows };
    }
    case 2:
      return {
        tab: 'Boundaries', cols: '1fr 78px 44px', head: ['Feature', 'Radius', 'Status'],
        rows: [
          { id: 'k', cells: ['Kuiper belt', `${BOUNDS.kuiperInner}–${BOUNDS.kuiperOuter} AU`, 'OBSERVED'] },
          { id: 'ts', cells: ['Termination shock', `${BOUNDS.terminationShock} AU`, 'CROSSED'] },
          { id: 'hp', cells: ['Heliopause', `${BOUNDS.heliopause} AU`, 'CROSSED'] },
          { id: 'oi', cells: ['Inner Oort shell', `${n0(BOUNDS.oortInner)} AU`, 'INFERRED'] },
          { id: 'oo', cells: ['Outer Oort shell', `${n0(BOUNDS.oortOuter)} AU`, 'INFERRED'] },
          { id: 'hill', cells: ['Solar Hill sphere', '~230,000 AU', 'COMPUTED'] },
        ],
      };
    case 3:
      return {
        tab: 'Outer Bodies', cols: '1fr 60px 52px', head: ['Body', 'AU', 'Period'],
        rows: PLANETS.slice(4).map((p, k) => ({
          id: p.n,
          cells: [p.n, p.a.toFixed(3), `${(360 / p.dL / 365.25).toFixed(1)} YR`] as [string, string, string],
          sel: { kind: 'planet', i: k + 4 } as Sel,
        })),
      };
    case 4:
      return {
        tab: 'Orbit Catalogue', cols: '1fr 52px 38px', head: ['Designation', 'a · AU', 'Class'],
        rows: d.neo.map((o, i) => ({
          id: o.des,
          cells: [o.des, o.a.toFixed(3), o.cls] as [string, string, string],
          sel: { kind: 'neo', i } as Sel,
        })),
      };
    case 5:
      return {
        tab: 'Close Approaches', cols: '1fr 54px 54px', head: ['Designation', 'Miss · LD', 'V · km/s'],
        rows: d.neo.map((o, i) => ({
          id: o.des,
          cells: [o.des, ((o.dist * AU) / LD).toFixed(2), o.v.toFixed(1)] as [string, string, string],
          sel: { kind: 'neo', i } as Sel,
        })),
      };
    case 6:
      return {
        tab: 'Active Satellites', cols: '1fr 54px 34px', head: ['Object', 'Alt · km', 'Grp'],
        rows: sats.map((s, i) => ({
          id: `${s.name}-${i}`,
          cells: [s.name, n0(s.alt), s.grp] as [string, string, string],
          sel: { kind: 'sat', i } as Sel,
        })),
      };
    default:
      return mode === 'eq'
        ? {
          tab: 'Surface Events', cols: '1fr 34px 46px', head: ['Region', 'Mag', 'Dep · km'],
          rows: d.eq.map((e, i) => ({
            id: `${e.time}-${i}`,
            cells: [e.place, e.mag.toFixed(1), e.dep.toFixed(0)] as [string, string, string],
            sel: { kind: 'quake', i } as Sel,
          })),
        }
        : {
          tab: 'Air Traffic', cols: '1fr 44px 44px', head: ['Callsign', 'FL', 'Type'],
          rows: d.fl.map((f, i) => ({
            id: `${f.flight}-${i}`,
            cells: [f.flight, String(Math.round(f.alt / 100)).padStart(3, '0'), f.type] as [string, string, string],
            sel: { kind: 'flight', i } as Sel,
          })),
        };
  }
}

export default function ObjectLog({
  dom, data, sats, sel, simT, mode, onSelect, onMode, onClose,
}: {
  dom: number; data: Snapshot; sats: SatState[]; sel: Sel; simT: number;
  mode: SurfMode;
  onSelect: (s: Sel) => void;
  onMode: (m: SurfMode) => void;
  onClose?: () => void;
}) {
  const spec = specFor(dom, data, sats, mode);
  const detail = detailOf(sel, data, sats, simT);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel?.kind, sel?.i]);

  const tag = REG[dom].tag;

  return (
    <aside className="panel flex min-h-0 flex-1 flex-col">
      <span className="tab">{spec.tab}</span>
      <div className="mb-[7px] flex flex-wrap items-baseline gap-[7px]">
        <span className="t-label">{spec.head[0]}s</span>
        <span className="t-data text-[10px]">{spec.rows.length}</span>
        <Chip tone={tag === 'LIVE' || tag === 'PROPAGATED' ? 'live' : 'series-a'}>{tag}</Chip>
        {dom === 7 && (
          <span className="flex gap-1">
            {(['eq', 'fl'] as const).map(m => (
              <button
                key={m}
                type="button"
                className="chip cursor-pointer bg-transparent"
                style={{ color: mode === m ? 'var(--color-live)' : 'var(--color-chrome-dim)' }}
                onClick={() => { onMode(m); onSelect(null); }}
              >
                {m === 'eq' ? 'Seismic' : 'Traffic'}
              </button>
            ))}
          </span>
        )}
        {onClose && (
          <button
            type="button"
            aria-label="Hide object log"
            className="ml-auto cursor-pointer border-0 bg-transparent px-[2px] font-ui text-[11px] font-semibold text-chrome-dim hover:text-hazard"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>

      {detail && (
        <div className="mb-[7px] border-y border-dotted border-y-[color-mix(in_srgb,var(--color-chrome)_30%,transparent)] py-[6px]">
          <p className="t-data mb-[5px] text-caution">{detail.title}</p>
          <Rows items={detail.rows} />
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="ohdr" style={{ gridTemplateColumns: spec.cols }}>
          {spec.head.map((h, i) => (
            <span key={h} className="t-label" style={{ textAlign: i ? 'right' : 'left', letterSpacing: '.1em' }}>{h}</span>
          ))}
        </div>
        {spec.rows.map(r => {
          const isSel = !!r.sel && sel?.kind === r.sel.kind && sel.i === r.sel.i;
          const cells = (
            <>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-bone">{r.cells[0]}</span>
              <span className="whitespace-nowrap text-right">{r.cells[1]}</span>
              <span className="whitespace-nowrap text-right">{r.cells[2]}</span>
            </>
          );
          return r.sel ? (
            <button
              key={r.id}
              type="button"
              className="orow"
              aria-selected={isSel}
              style={{ gridTemplateColumns: spec.cols }}
              onClick={() => onSelect(isSel ? null : r.sel!)}
            >
              {cells}
            </button>
          ) : (
            <div key={r.id} className="orow cursor-default" style={{ gridTemplateColumns: spec.cols }}>
              {cells}
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-data text-[9.5px] text-chrome-dim">
        {spec.rows.length} ROWS · {REG[dom].tab.toUpperCase()}
      </p>
    </aside>
  );
}
