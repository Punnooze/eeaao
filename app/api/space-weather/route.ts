import { NextResponse } from 'next/server';
import { getSpaceWeather, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.swSummary
export const revalidate = 300;

export async function GET() {
  try {
    return NextResponse.json(await getSpaceWeather(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.swSummary}, stale-while-revalidate=${TTL.swSummary * 4}` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
