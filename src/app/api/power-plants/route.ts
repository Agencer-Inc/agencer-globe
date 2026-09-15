import { jsonUtf8 } from '@/lib/json-utf8';
import { cachedSource } from '@/lib/sourceCache';
import { osirisLayer } from '@/lib/layers-catalog';
import { parsePowerPlants, type PowerPlant } from '@/lib/power-plants';

/**
 * OSIRIS — power stations.
 *
 * THE LICENCE FOR THIS DATA HAS NOT BEEN READ. The catalogue row carries that
 * sentence and the earth query door repeats it verbatim on every answer. This
 * route exists so the layer can be seen working; reading the publisher's terms
 * is 313-24 and it has not happened.
 *
 * THIS ROUTE OWNS THE UPSTREAM (Law 19). It holds the fetch, the parse and the
 * cache, and lib/earth/registry reads THIS rather than opening its own
 * connection to the publisher — exactly as the earth flights fetcher reads
 * api/flights rather than holding its own ADS-B budget. One owner per upstream
 * means one cache, one licence record and one place to change the URL.
 *
 * The URL is read from the catalogue row, never retyped: a second copy of a url
 * is a second thing that can drift from the licence recorded beside it.
 */

export const maxDuration = 60;

/** A release, not a feed: the published database changes on the order of
 *  months, so a day is already far more often than it moves. */
const TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_KEY = 'power_plants';

const loadPlants = cachedSource<PowerPlant>(
  CACHE_KEY,
  async () => {
    const url = osirisLayer('power_plants')?.sourceUrl;
    if (!url) throw new Error('power_plants has no sourceUrl in the catalogue');

    // ~12MB. AbortSignal.timeout rather than a bare fetch so a hung CDN cannot
    // hold the route open for the whole of maxDuration.
    const res = await fetch(url, {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) throw new Error(`power plant database answered ${res.status}`);

    return parsePowerPlants(await res.text());
  },
  TTL_MS,
);

export async function GET() {
  try {
    const plants = await loadPlants();
    return jsonUtf8(
      {
        plants,
        total: plants.length,
        // Repeated here as well as on the earth answer. A consumer reading this
        // route directly never passes the query door, and must not be the one
        // party that is not told.
        licence: osirisLayer('power_plants')?.licence ?? 'NOT READ.',
        source: osirisLayer('power_plants')?.source ?? null,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' } },
    );
  } catch (error) {
    console.error('[OSIRIS] power plants error:', error);
    return jsonUtf8(
      { plants: [], total: 0, error: error instanceof Error ? error.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
