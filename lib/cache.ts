import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Server-side cache for feeds Next's data cache cannot hold, or that the
 * upstream will not let us re-download.
 *
 * Two upstreams force this:
 *
 *   CelesTrak answers a repeat pull inside its two-hour update window with
 *   HTTP 403 and the body "GP data has not updated since your last successful
 *   download". That is a politeness limiter, not an outage — the correct
 *   response is to keep serving the copy we already have. Memory alone is not
 *   enough, because a build spawns nine workers and a redeploy starts cold,
 *   either of which would trip the limiter and then have nothing to fall back
 *   to. So the copy goes to disk.
 *
 *   NOAA's minute-cadence plasma archive is 3.5 MB, past Next's 2 MB data-cache
 *   ceiling, so it would otherwise be refetched on every render.
 *
 * Behaviour: fresh memory hit → disk hit → fetch. Concurrent callers collapse
 * onto one request. If a refresh fails and any copy exists, stale wins over
 * blank, because a stale element set still propagates to roughly the right
 * place while an empty one draws nothing.
 */

const DIR = join(tmpdir(), 'eeaao-cache');
const mem = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

const fileFor = (key: string) => join(DIR, `${createHash('sha1').update(key).digest('hex')}.json`);

/** Upstream is fine, it just will not serve us again yet. */
export class NotModifiedError extends Error {}

async function readDisk(key: string): Promise<{ at: number; value: unknown } | null> {
  try {
    const raw = await readFile(fileFor(key), 'utf8');
    const parsed = JSON.parse(raw) as { at: number; value: unknown };
    return typeof parsed?.at === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeDisk(key: string, entry: { at: number; value: unknown }) {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(key), JSON.stringify(entry), 'utf8');
  } catch {
    /* a read-only filesystem degrades us to the memory tier, which is fine */
  }
}

/**
 * Cache-only read: no network, ever. Lets a caller apply everything it already
 * knows for free before spending its request budget on what it does not.
 */
export async function recall<T>(key: string, ttlSec: number): Promise<T | null> {
  const hot = mem.get(key);
  if (hot) return hot.value as T;
  const cold = await readDisk(key);
  if (!cold) return null;
  mem.set(key, cold);
  return cold.value as T;
}

export async function remember<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hot = mem.get(key);
  if (hot && now - hot.at < ttlSec * 1000) return hot.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = (async () => {
    const cold = hot ?? (await readDisk(key));
    if (cold && Date.now() - cold.at < ttlSec * 1000) {
      mem.set(key, cold);
      return cold.value;
    }
    try {
      const value = await load();
      const entry = { at: Date.now(), value };
      mem.set(key, entry);
      void writeDisk(key, entry);
      return value;
    } catch (err) {
      if (cold) {
        // Serve what we have. A limiter response is expected, not an incident.
        // hold it, but expire soon so the next request retries upstream
        mem.set(key, { at: Date.now() - ttlSec * 1000 + 60_000, value: cold.value });
        return cold.value;
      }
      throw err;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p as Promise<T>;
}
