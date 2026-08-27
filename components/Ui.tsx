import type { ReactNode } from 'react';

export type Tone = 'live' | 'hazard' | 'caution' | 'series-a' | 'dim';
export type Row = [label: string, value: ReactNode, tone?: Tone];

const TONE: Record<Tone, string> = {
  live: 'var(--color-live)',
  hazard: 'var(--color-hazard)',
  caution: 'var(--color-caution)',
  'series-a': 'var(--color-series-a)',
  dim: 'var(--color-chrome-dim)',
};

export function Panel({ tab, children, chip }: { tab: string; children: ReactNode; chip?: ReactNode }) {
  return (
    <section className="panel">
      <span className="tab">{tab}</span>
      {chip}
      {children}
    </section>
  );
}

export function Rows({ items }: { items: Row[] }) {
  return (
    <dl className="rows">
      {items.map(([k, v, tone], i) => (
        <div className="row" key={`${k}-${i}`}>
          <dt>{k}</dt>
          <span className="lead" />
          <dd style={tone ? { color: TONE[tone] } : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 font-data text-[9.5px] leading-relaxed text-chrome-dim">{children}</p>
  );
}

/** Line chart with an emphasised endpoint — a reading, not decoration. */
export function Spark({ vals, color = 'var(--color-live)', fill }: { vals: number[]; color?: string; fill?: string }) {
  if (vals.length < 2) return <Note>NO SERIES</Note>;
  const w = 240, h = 38;
  const mn = Math.min(...vals), mx = Math.max(...vals), sp = mx - mn || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 2 - ((v - mn) / sp) * (h - 6)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="mt-2 block h-[38px] w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke="color-mix(in srgb, var(--color-chrome) 30%, transparent)" strokeWidth="1" />
      {fill && <path d={`${d} L ${w} ${h - 2} L 0 ${h - 2} Z`} fill={fill} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.2" fill={color} />
    </svg>
  );
}

/** Kp bars, coloured at the storm thresholds rather than uniformly. */
export function Bars({ vals }: { vals: number[] }) {
  if (!vals.length) return <Note>NO SERIES</Note>;
  const mx = Math.max(...vals, 9);
  return (
    <div className="mt-2 flex h-[38px] items-end gap-px border-b border-b-[color-mix(in_srgb,var(--color-chrome)_30%,transparent)]">
      {vals.map((v, i) => (
        <span
          key={i}
          className="flex-1"
          style={{
            height: `${Math.max(2, (v / mx) * 36)}px`,
            background: v >= 5 ? 'var(--color-hazard)' : v >= 4 ? 'var(--color-caution)' : 'var(--color-live-dim)',
          }}
        />
      ))}
    </div>
  );
}

export function Histo({
  vals, edges, label, color = 'var(--color-hazard)', fmt = (n: number) => String(n),
}: { vals: number[]; edges: number[]; label: string; color?: string; fmt?: (n: number) => string }) {
  const buckets = edges.slice(0, -1).map((lo, i) => vals.filter(v => v >= lo && v < edges[i + 1]).length);
  const mx = Math.max(...buckets, 1);
  return (
    <>
      <div className="mt-2 flex flex-col gap-[2px]">
        {buckets.map((c, i) => (
          <div key={i} className="grid grid-cols-[62px_1fr_26px] items-center gap-[6px]">
            <span className="font-data text-right text-[9.5px] text-chrome-dim tabular-nums">
              {fmt(edges[i])}–{fmt(edges[i + 1])}
            </span>
            <span style={{ height: 6, background: color, width: `${Math.max(2, (c / mx) * 100)}%` }} />
            <span className="font-data text-[9.5px] text-live tabular-nums">{c}</span>
          </div>
        ))}
      </div>
      <Note>{label}</Note>
    </>
  );
}

export function Chip({ children, tone = 'live' }: { children: ReactNode; tone?: Tone }) {
  return <span className="chip" style={{ color: TONE[tone] }}>{children}</span>;
}
