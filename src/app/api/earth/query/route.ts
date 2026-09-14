import { NextRequest, NextResponse } from 'next/server';
import { planQuery, MAX_LIMIT } from '@/lib/earth/query';
import { earthServerEnabled, EARTH_SERVER_FLAG } from '@/lib/earth/settings';
import { allRecords } from '@/lib/earth/scheduler';
import { unservedLiveLayers } from '@/lib/earth/registry';
import { sdkLayerIds } from '@/lib/earth/sdk-layers';

/**
 * OSIRIS earth server — the query door.
 *
 *   POST /api/earth/query
 *     headers: x-osiris-user: <id>          (or body.userId; the header wins)
 *     body:    { layer, place | bbox, filter?, limit? }
 *
 * Answers from what the scheduler already holds. It never fetches on the
 * request path, so a warm layer answers in the time it takes to filter an array
 * and a cold one says it is cold instead of making the caller wait to find out.
 *
 * THREE GATE OBLIGATIONS ARE VISIBLE HERE, and drafted verbatim in the PR body:
 *   rule 3  the door names its caller. No user id, no answer (refusal
 *           `anonymous`), checked before any work is done.
 *   rule 2  the cache behind this is MEMORY with a stated TTL. It dies with the
 *           server, which is harmless: everything in it is re-fetchable from a
 *           public upstream in one cadence. The named swap point is
 *           seedSource/peekSource in sourceCache.ts.
 *   bounds  every answer is capped at MAX_LIMIT rows and says whether it
 *           clamped, so no caller can turn this door into a feed dump.
 *
 * Dark by default. With the flag unset the door answers 503 and names the flag,
 * matching how the SDK ingest door reports itself unconfigured
 * (api/sdk/ingest/route.ts:50-57) rather than inventing a second convention
 * (Law 15).
 *
 * GET /api/earth/query reports what the server holds, for witnessing an armed
 * server from outside without asking it for data (Law 32).
 */

/** The header this door reads its caller from. No prior convention existed in
 *  this app, so this leg names one rather than leaving it implicit (Law 6). */
export const USER_HEADER = 'x-osiris-user';

function disabled() {
  return NextResponse.json(
    {
      ok: false,
      refusal: 'disabled',
      detail: `Earth server is off. Set ${EARTH_SERVER_FLAG}=1 to arm it.`,
      timestamp: new Date().toISOString(),
    },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  if (!earthServerEnabled()) return disabled();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, refusal: 'malformed', detail: 'Body must be JSON.' },
      { status: 400 },
    );
  }

  const headerUser = request.headers.get(USER_HEADER);
  const userId = headerUser ?? (typeof body.userId === 'string' ? body.userId : null);

  const outcome = planQuery(body, { userId });

  if (!outcome.ok) {
    // A refusal is named in the body, and the status separates "you are not
    // allowed" from "what you sent does not parse" so a caller can tell a
    // credential problem from a typo without reading prose.
    const status = outcome.refusal === 'anonymous' ? 401
      : outcome.refusal === 'unknown_layer' ? 404
      : 400;
    return NextResponse.json({ ...outcome, timestamp: new Date().toISOString() }, { status });
  }

  return NextResponse.json(
    { ...outcome, timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** What this server holds right now. No data, only the shape of the holdings —
 *  so it needs no user id and leaks nothing a query would not already say. */
export async function GET() {
  if (!earthServerEnabled()) return disabled();

  return NextResponse.json({
    ok: true,
    armed: true,
    maxLimit: MAX_LIMIT,
    layers: allRecords().map(r => ({
      layer: r.layerId,
      cold: !r.everFetched,
      rowCount: r.rowCount,
      fetchedAt: r.fetchedAt,
      lastError: r.lastError,
      attempts: r.attempts,
      skippedTicks: r.skippedTicks,
    })),
    unservedLiveLayers: unservedLiveLayers(),
    sdkLayers: sdkLayerIds(),
    timestamp: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
