import { NextResponse } from 'next/server';
import { getSeismic, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.seismic
export const revalidate = 300;

export async function GET() {
  try {
    return NextResponse.json(await getSeismic(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.seismic}, stale-while-revalidate=${TTL.seismic * 4}` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
