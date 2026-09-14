import { NextRequest, NextResponse } from 'next/server';
import { planMeasure } from '@/lib/earth/measure';
import { earthServerEnabled, EARTH_SERVER_FLAG, USER_HEADER } from '@/lib/earth/settings';

/**
 * OSIRIS earth server — the measuring door.
 *
 *   POST /api/earth/measure
 *     headers: x-osiris-user: <id>          (or body.userId; the header wins)
 *     body:    { path: [[lng,lat], ...] }
 *
 * Answers a distance and the course it leaves on. Pure arithmetic over geo.ts:
 * no cache, no scheduler, no upstream, nothing to go stale. A request that
 * would take a network call is refused rather than waited on, because there is
 * no such request — everything this door needs is in the body.
 *
 * WHY IT IS NOT A CONTROL VERB. The control door acks what CHANGED. A
 * measurement changes nothing, so an ack would have to carry a fact instead,
 * and the two doors would stop being separable. See lib/earth/measure.ts.
 *
 * Dark by default, behind the same flag and the same caller rule as the query
 * door, so arming the earth server arms both or neither.
 *
 * There is deliberately no GET. The query door's GET witnesses what the server
 * HOLDS; this door holds nothing, and a GET reporting "nothing to report" would
 * be a second witness saying less than the first.
 */

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

  const headerUser = request.headers.get(USER_HEADER);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    // `null`, `[]`, `42` and `"hi"` are all valid JSON and none of them has a
    // .path to read. The query door learned this one the hard way and answered
    // 500 where it documents a refusal; this door starts where that ended.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body is not a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    // A body we cannot read is still no excuse for answering a stranger: name
    // the caller first, exactly as the readable path does.
    if (headerUser === null || headerUser.trim() === '') {
      return NextResponse.json(
        {
          ok: false,
          refusal: 'anonymous',
          detail: 'This door names its caller. Send a user id; anonymous measurements are refused.',
          timestamp: new Date().toISOString(),
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        refusal: 'malformed',
        detail: 'Body must be a JSON object.',
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const userId = headerUser ?? (typeof body.userId === 'string' ? body.userId : null);

  const outcome = planMeasure(body, { userId });

  if (!outcome.ok) {
    // The same split the query door makes: 401 separates "you are not allowed"
    // from 400 "what you sent does not parse", so a caller can tell a
    // credential problem from a typo without reading the prose.
    const status = outcome.refusal === 'anonymous' ? 401 : 400;
    return NextResponse.json({ ...outcome, timestamp: new Date().toISOString() }, { status });
  }

  return NextResponse.json(
    { ...outcome, timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
