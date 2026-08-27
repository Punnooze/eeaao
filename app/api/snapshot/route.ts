import { NextResponse } from 'next/server';
import { getSnapshot, TTL } from '@/lib/sources';

// literal required by Next segment config; mirrors TTL.traffic
export const revalidate = 60;

/**
 * Everything in one call — what the client polls to refresh the console.
 * Wrapped because a build prerenders this route: one upstream feed having a bad
 * minute must degrade the payload, never fail the deploy.
 */
export async function GET() {
  try {
    const snap = await getSnapshot();
    return NextResponse.json(snap, {
      headers: { 'cache-control': `public, s-maxage=${TTL.traffic}, stale-while-revalidate=300` },
    });
  } catch (e) {
    return NextResponse.json(
      { error: String((e as Error).message ?? e), degraded: ['SNAPSHOT ASSEMBLY FAILED'] },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
