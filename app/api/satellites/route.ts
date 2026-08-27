import { NextResponse } from 'next/server';
import { getSatellites, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.tle
export const revalidate = 10800;

export async function GET() {
  try {
    return NextResponse.json(await getSatellites(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.tle}, stale-while-revalidate=${TTL.tle * 4}` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
