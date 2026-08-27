import { NextResponse } from 'next/server';
import { getSystems, TTL } from '@/lib/sources';

// literal required by Next segment config; mirrors TTL.systems
export const revalidate = 604800;

export async function GET() {
  try {
    return NextResponse.json(await getSystems(), {
      headers: { 'cache-control': `public, s-maxage=${TTL.systems}, stale-while-revalidate=86400` },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
