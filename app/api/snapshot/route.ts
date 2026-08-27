import { NextResponse } from 'next/server';
import { getSnapshot, TTL } from '@/lib/sources';

// must be a literal for Next segment config; mirrors TTL.traffic
export const revalidate = 60;

/** Everything in one call — what the client polls to refresh the console. */
export async function GET() {
  const snap = await getSnapshot();
  return NextResponse.json(snap, {
    headers: { 'cache-control': `public, s-maxage=${TTL.traffic}, stale-while-revalidate=300` },
  });
}
