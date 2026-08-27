import { NextResponse } from 'next/server';
import { getTraffic, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.traffic
export const revalidate = 60;

export async function GET() {
  try {
    return NextResponse.json(await getTraffic(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.traffic}, stale-while-revalidate=${TTL.traffic * 4}` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
