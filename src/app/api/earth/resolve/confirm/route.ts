import { NextRequest } from 'next/server';
import { jsonUtf8 } from '@/lib/json-utf8';
import { earthServerEnabled, EARTH_SERVER_FLAG } from '@/lib/earth/settings';
import { readCaller } from '../route';
import { bboxProblems, normalisePlace, rememberPlace, PLACES, type Bbox } from '@/lib/earth/places';

/**
 * OSIRIS earth server — confirming one resolved place.
 *
 *   POST /api/earth/resolve/confirm
 *     headers: x-osiris-user: <id>
 *     body:    { name, candidate }        // candidate as ../resolve offered it
 *
 * The ONLY thing that writes into the place cache. Its sibling offers
 * candidates and writes nothing; this takes the one the caller chose and makes
 * it resolvable under the words the caller used.
 *
 * WHY TWO CALLS. A resolve that wrote on its own would be a fuzzy geocoder
 * behind resolvePlace with extra steps, which is the thing places.ts:15-19
 * refuses. The choice between "Paris, Île-de-France" and "Paris, Texas" belongs
 * to the party that knows which it meant, and that party is never this server.
 *
 * The write is memory and dies with the server — THE-GATE rule 2's stated swap
 * point, the same one sourceCache names. Anything demo-critical belongs in
 * PLACES as a reviewed hand row instead.
 */

function disabled() {
  return jsonUtf8(
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
  return jsonUtf8(
    { ok: false, refusal, detail, timestamp: new Date().toISOString() },
    { status },
  );
}

export async function POST(request: NextRequest) {
  if (!earthServerEnabled()) return disabled();

  const caller = await readCaller(request);
  if (!caller.ok) return caller.response;

  const name = caller.body.name;
  if (typeof name !== 'string' || name.trim() === '') {
    return refuse('malformed', 'name is required and must be a non-empty string.', 400);
  }

  const candidate = caller.body.candidate;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return refuse('malformed', 'candidate is required and must be the object ../resolve offered.', 400);
  }

  const { bbox, note } = candidate as { bbox?: unknown; note?: unknown };

  // Checked here as well as in rememberPlace. This box will filter a whole
  // layer for every later query naming this place, so a wrong one is not a bad
  // row — it is every answer about that place being quietly wrong.
  const problems = bboxProblems(bbox);
  if (problems.length) {
    return refuse('malformed', `candidate.bbox: ${problems.join('; ')}`, 400);
  }

  // A hand row was typed by a person reading a map and read by a reviewer; a
  // confirmed one came from a fuzzy index. resolvePlace already prefers the
  // hand table, so a write here would be a row nothing ever reads — and a
  // success ack for a write that changed nothing is the quiet lie this repo
  // keeps refusing. Say it instead.
  const key = normalisePlace(name);
  if (Object.hasOwn(PLACES, key)) {
    return refuse(
      'hand_written',
      `"${key}" is already a hand-written place in this server's table, and a hand row ` +
      'always wins. Nothing was written. Query it directly, or send a bbox.',
      409,
    );
  }

  const stored = rememberPlace(name, {
    bbox: bbox as Bbox,
    note: typeof note === 'string' && note.trim()
      ? note
      : `resolved from "${name}" and confirmed by ${caller.userId}; no note was supplied.`,
  });

  return jsonUtf8(
    {
      ok: true,
      key: stored,
      bbox,
      detail: `"${stored}" now resolves for this server run. It is held in memory and dies with the server.`,
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
