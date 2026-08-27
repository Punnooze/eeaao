import { NextResponse } from 'next/server';
import { getNeo, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.neo
export const revalidate = 21600;

export async function GET() {
  try {
    return NextResponse.json(await getNeo(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.neo}, stale-while-revalidate=${TTL.neo * 4}` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
