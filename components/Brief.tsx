'use client';

import { BRIEFS, systemBrief } from '@/lib/briefings';
import { REG } from '@/lib/regimes';
import type { System } from '@/lib/types';

/**
 * "What am I looking at" — rewritten per rung. Deliberately unboxed: the
 * header already proves that text with a void knock-out reads fine straight
 * over the starfield, and a panel here would occlude the thing being
 * explained. Constant presence, zero footprint.
 */
export default function Brief({ dom, focus }: { dom: number; focus?: System | null }) {
  const inSystem = focus && dom >= 2 && dom <= 5;
  const b = inSystem
    ? systemBrief(focus.host, focus.dist * 3.26156, focus.spect, focus.planets.length)
    : BRIEFS[dom];
  if (!b) return null;
  return (
    <div className="pointer-events-none select-none">
      <p className="knock m-0 font-ui text-[9.5px] font-semibold uppercase tracking-[0.16em] text-hazard">
        Briefing · {inSystem ? 'focused system · archive' : `rung ${dom + 1}/${REG.length} · ${REG[dom].tag}`}
      </p>
      <p className="knock mt-[3px] mb-[5px] font-data text-[10.5px] leading-[1.3] text-caution">
        {b.what}
      </p>
      <p className="knock m-0 max-w-[58ch] text-[12.5px] leading-[1.5] text-bone">{b.body}</p>
      <dl className="mt-[8px] flex flex-col gap-[3px]">
        {b.seeing.map(([mark, meaning]) => (
          <div key={mark} className="grid grid-cols-[128px_1fr] items-baseline gap-[8px]">
            <dt className="knock font-data text-[9px] leading-[1.4] text-series-a">{mark}</dt>
            <dd className="knock m-0 font-ui text-[11.5px] leading-[1.4] text-chrome-dim">{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
