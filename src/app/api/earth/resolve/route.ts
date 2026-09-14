import { NextRequest, NextResponse } from 'next/server';
import { earthServerEnabled, EARTH_SERVER_FLAG, USER_HEADER } from '@/lib/earth/settings';
import { selfOrigin } from '@/lib/earth/registry';
import { toCandidates, type GeoHit } from '@/lib/earth/geocode';

/**
 * OSIRIS earth server — the resolving door.
 *
 *   POST /api/earth/resolve
 *     headers: x-osiris-user: <id>          (or body.userId; the header wins)
 *     body:    { name }
 *
 * Answers "what could this name mean?" with CANDIDATES — plural, each carrying
 * the context that tells two places of one name apart — and writes nothing. The
 * caller picks one and posts it to ./confirm, which is the only thing that
 * writes into the place table's cache.
 *
 * WHY THIS IS A DOOR OF ITS OWN, AND NOT resolvePlace GROWING A GEOCODER.
 * Photon is a FUZZY index and api/geosearch says so in its own header — that is
 * exactly what makes it good at "sydny opera house". Behind resolvePlace it
 * would make "Springfield" silently one of forty Springfields, the failure
 * places.ts:15-19 refuses in writing. Two other things follow from the split:
 *
 *   - resolvePlace stays SYNCHRONOUS and never touches the network, so
 *     planQuery stays synchronous with it.
 *   - the 20s worst case that made control-door.ts:297-300 refuse to geocode
 *     lives here, on a door a caller rings deliberately, and never on a verb.
 *
 * THE FAN-OUT IS NOT DUPLICATED. api/geosearch owns Photon and Nominatim — the
 * merge, the prominence rule, the 10-minute cache — and this door reads its
 * answer, the way the flights fetcher reads api/flights rather than opening its
 * own ADS-B budget (registry.ts:145-155). One owner per upstream (Law 19).
 *
 * Dark by default, behind the same flag and caller rule as the query and
 * measuring doors, so arming the earth server arms all three or none.
 */

/** Long enough for geosearch's own two 8s upstream calls plus its merge. Past
 *  that the caller is better told than left waiting. */
export const RESOLVE_TIMEOUT_MS = 20_000;

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

function refuse(refusal: string, detail: string, status: number) {
  return NextResponse.json(
    { ok: false, refusal, detail, timestamp: new Date().toISOString() },
    { status },
  );
}

/** Shared by both halves: read the caller, or refuse before doing any work. */
export async function readCaller(request: NextRequest): Promise<
  { ok: true; userId: string; body: Record<string, unknown> } | { ok: false; response: NextResponse }
> {
  const headerUser = request.headers.get(USER_HEADER);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body is not a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    // A body we cannot read is still no excuse for answering a stranger.
    if (headerUser === null || headerUser.trim() === '') {
      return {
        ok: false,
        response: refuse('anonymous', 'This door names its caller. Send a user id; anonymous callers are refused.', 401),
      };
    }
    return { ok: false, response: refuse('malformed', 'Body must be a JSON object.', 400) };
  }

  const userId = headerUser ?? (typeof body.userId === 'string' ? body.userId : null);
  if (typeof userId !== 'string' || userId.trim() === '') {
    return {
      ok: false,
      response: refuse('anonymous', 'This door names its caller. Send a user id; anonymous callers are refused.', 401),
    };
  }

  return { ok: true, userId, body };
}

export async function POST(request: NextRequest) {
  if (!earthServerEnabled()) return disabled();

  // Rule 3 FIRST, before any upstream is touched: a door that geocodes and then
  // asks who is calling has already spent 20 seconds of somebody else's rate
  // limit on a stranger.
  const caller = await readCaller(request);
  if (!caller.ok) return caller.response;

  const name = caller.body.name;
  if (typeof name !== 'string' || name.trim() === '') {
    return refuse('malformed', 'name is required and must be a non-empty string.', 400);
  }

  let hits: GeoHit[];
  try {
    const res = await fetch(
      `${selfOrigin()}/api/geosearch?q=${encodeURIComponent(name.trim())}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`/api/geosearch answered ${res.status}`);
    const data = (await res.json()) as { results?: GeoHit[] };
    hits = Array.isArray(data.results) ? data.results : [];
  } catch (error) {
    // Nothing-matched and could-not-ask are different facts, and a caller that
    // cannot tell them apart retries the wrong one.
    return refuse(
      'upstream_unavailable',
      `the geocoder could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  const candidates = toCandidates(name, hits);

  return NextResponse.json(
    {
      ok: true,
      name,
      candidates,
      // Said out loud, because an empty list is an answer and not a failure.
      detail: candidates.length
        ? `${candidates.length} candidate(s). Nothing is written until one is confirmed at POST /api/earth/resolve/confirm.`
        : `no place matched "${name}". Nothing was written.`,
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
