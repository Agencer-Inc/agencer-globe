/**
 * OSIRIS earth server — the query planner.
 *
 * Answers a bounded question from what the scheduler already holds. It never
 * fetches, never waits on an upstream, and never hands a feed to a model: the
 * whole point is that a caller gets at most MAX_LIMIT rows that are already in
 * memory, with the provenance the catalogue records attached.
 *
 *   { userId?, layer, place|bbox|ring?, filter?, limit? }
 *     |
 *     +-- no userId ------------------> refuse `anonymous`      (THE-GATE rule 3)
 *     +-- bad shape ------------------> refuse `malformed`
 *     +-- two scopes at once ---------> refuse `malformed`, naming both
 *     +-- place not in the table -----> refuse `place_unknown`  (never guesses)
 *     |
 *     +-- sdk_<provider> in the store -> answer from the ingest store, always warm
 *     |
 *     +-- not a catalogue id ---------> refuse `unknown_layer`
 *     +-- catalogue status not live --> ANSWER, cold, reason = that status, and
 *     |                                 the row's own sentence saying why
 *     +-- live but no fetcher here ---> ANSWER, cold, reason `not_served_here`
 *     +-- registered, never fetched --> ANSWER, cold, reason `never_fetched`
 *     |
 *     v
 *   warm: filter -> bbox|ring -> count -> clamp to 50 -> say whether it clamped
 *
 * Cold is read from the scheduler's record and NEVER from whether the cache has
 * rows: a layer that fetched and legitimately got nothing is warm with zero
 * rows, and the cache cannot tell that apart from never-fetched
 * (sourceCache.ts:105, :122). See scheduler.ts for the long version.
 *
 * Licence, source and cadence on every answer are read from the catalogue row
 * verbatim. They are never inferred and never defaulted: a consumer that
 * redistributes this data needs the publisher's terms, not our summary of them.
 */

import { osirisLayer } from '@/lib/layers-catalog';
import { earthLayer } from './registry';
import type { EarthItem } from './registry';
import { layerRecord, layerItems } from './scheduler';
import { resolvePlace, bboxProblems, inBbox, type Bbox } from './places';
import { selectEarthItems, ringProblems } from './select';
import { sdkLayerItems, sdkIdIsClaimable } from './sdk-layers';

/** The hard ceiling. A caller asking for more is answered with 50 and told so. */
export const MAX_LIMIT = 50;

/** Used when the caller names no limit at all. */
export const DEFAULT_LIMIT = 25;

export type Refusal =
  | 'anonymous'
  | 'malformed'
  | 'place_unknown'
  | 'unknown_layer';

export type ColdReason =
  | 'never_fetched'
  | 'not_served_here'
  | 'dead'
  | 'catalogued'
  | 'render_only'
  | 'unsourced';

/**
 * The same list at runtime, so a test can prove it still covers every non-live
 * SourceStatus. Four of these values ARE SourceStatus values, carried across a
 * module boundary by a cast (`row.status as ColdReason` below). A cast is a
 * promise the compiler cannot check: add a status to layers-catalog.ts and this
 * silently starts emitting a coldReason that is not one. The pin is what makes
 * the cast safe, not the cast.
 */
export const COLD_REASONS: readonly ColdReason[] = [
  'never_fetched', 'not_served_here', 'dead', 'catalogued', 'render_only', 'unsourced',
];

export interface EarthQueryInput {
  layer?: unknown;
  place?: unknown;
  bbox?: unknown;
  /** A drawn shape, as [lng, lat] vertices. Exclusive with place and bbox. */
  ring?: unknown;
  filter?: unknown;
  limit?: unknown;
}

export interface EarthProvenance {
  status: string;
  source: string;
  cadence: string;
  licence: string;
  sourceUrl: string | null;
}

export interface EarthAnswer {
  ok: true;
  layer: string;
  /** True when this server holds nothing for the layer, for a named reason. */
  cold: boolean;
  coldReason: ColdReason | null;
  /** Plain words a person can act on. Null when the layer is warm. */
  coldDetail: string | null;
  /** Warm but past its TTL, or warm with the last refresh having failed. */
  stale: boolean;
  /**
   * How long ago THIS SERVER retrieved what it is holding, in seconds. Null
   * when cold, and null for push-fed sdk_ layers where nothing measured it.
   * Not the age of the observation: an aircraft position is already some
   * seconds old when the upstream hands it over, and nothing here can see that.
   */
  ageSeconds: number | null;
  /** The last refresh failure, carried rather than swallowed. */
  lastError: string | null;
  place: string | null;
  bbox: Bbox | null;
  /** The shape the answer was swept against, echoed back so a caller can see
   *  which of its shapes this answer belongs to. */
  ring: number[][] | null;
  filter: string | null;
  limit: number;
  limitRequested: number;
  /** True when the caller asked for more than MAX_LIMIT. Said out loud. */
  limitClamped: boolean;
  /** Matches before the limit was applied, so a caller knows what it did not see. */
  matched: number;
  returned: number;
  items: EarthItem[];
  provenance: EarthProvenance | null;
}

export interface EarthRefusal {
  ok: false;
  refusal: Refusal;
  detail: string;
}

export type EarthQueryOutcome = EarthAnswer | EarthRefusal;

export interface QueryContext {
  /** THE-GATE rule 3: the door names the user. Anonymous is refused by name. */
  userId?: string | null;
  now?: number;
}

function refuse(refusal: Refusal, detail: string): EarthRefusal {
  return { ok: false, refusal, detail };
}

function provenanceFor(layerId: string): EarthProvenance | null {
  const row = osirisLayer(layerId);
  if (!row) return null;
  return {
    status: row.status,
    source: row.source,
    cadence: row.cadence,
    licence: row.licence,
    sourceUrl: row.sourceUrl,
  };
}

/** Substring match over kind and label, case-insensitive. Deliberately dumb:
 *  anything cleverer would be matching a user's wording against meaning. */
function matchesFilter(item: EarthItem, filter: string): boolean {
  return item.kind.includes(filter) || item.label.toLowerCase().includes(filter);
}

function shape(
  layer: string,
  base: {
    cold: boolean;
    coldReason: ColdReason | null;
    coldDetail: string | null;
    stale: boolean;
    ageSeconds: number | null;
    lastError: string | null;
    items: EarthItem[];
  },
  scope: { place: string | null; bbox: Bbox | null; ring: number[][] | null; filter: string | null },
  limits: { limit: number; limitRequested: number; limitClamped: boolean },
): EarthAnswer {
  let items = base.items;
  if (scope.filter) items = items.filter(i => matchesFilter(i, scope.filter!));
  if (scope.bbox) items = items.filter(i => inBbox(i.lat, i.lng, scope.bbox!));
  // A ring is the third scope and never runs beside a box: planQuery refuses
  // two scopes before reaching here, so this is an else in everything but form.
  if (scope.ring) items = selectEarthItems(scope.ring, items);

  const matched = items.length;
  const returned = items.slice(0, limits.limit);

  return {
    ok: true,
    layer,
    ...base,
    ...scope,
    ...limits,
    matched,
    returned: returned.length,
    items: returned,
    provenance: provenanceFor(layer),
  };
}

/**
 * Plan and answer one query.
 *
 * Pure with respect to the network. Everything it reads is already in this
 * process: the scheduler's records and cache, the ingest store, the catalogue.
 */
export function planQuery(input: EarthQueryInput, ctx: QueryContext = {}): EarthQueryOutcome {
  const now = ctx.now ?? Date.now();

  // THE-GATE rule 3, first and unconditionally. A door that names the user only
  // after it has done the work is a door that did the work for a stranger.
  if (typeof ctx.userId !== 'string' || ctx.userId.trim() === '') {
    return refuse('anonymous', 'This door names its caller. Send a user id; anonymous queries are refused.');
  }

  const { layer, place, bbox, ring, filter, limit } = input;

  if (typeof layer !== 'string' || layer.trim() === '') {
    return refuse('malformed', 'layer is required and must be a non-empty string.');
  }
  const layerId = layer.trim();

  // Three scopes now, and the rule is the one it always was: no two of them can
  // both be the answer. Named rather than counted, so a caller that sent two
  // learns WHICH two it sent.
  const sent = ([['place', place], ['bbox', bbox], ['ring', ring]] as const)
    .filter(([, value]) => value !== undefined)
    .map(([label]) => label);
  if (sent.length > 1) {
    return refuse(
      'malformed',
      `Send one scope, not ${sent.length}: got ${sent.join(' and ')}. Two scopes cannot both be the answer.`,
    );
  }

  // Limit: clamp rather than refuse, and say so in the answer.
  let limitRequested = DEFAULT_LIMIT;
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || !Number.isInteger(limit)) {
      return refuse('malformed', 'limit must be a whole number of at least 1.');
    }
    limitRequested = limit;
  }
  const effectiveLimit = Math.min(limitRequested, MAX_LIMIT);
  const limits = {
    limit: effectiveLimit,
    limitRequested,
    limitClamped: limitRequested > MAX_LIMIT,
  };

  // Scope.
  let scopeBbox: Bbox | null = null;
  let scopePlace: string | null = null;
  let scopeRing: number[][] | null = null;
  if (place !== undefined) {
    if (typeof place !== 'string') return refuse('malformed', 'place must be a string.');
    const resolved = resolvePlace(place);
    if (!resolved.ok) return refuse(resolved.refusal, resolved.detail);
    scopeBbox = resolved.bbox;
    scopePlace = resolved.key;
  } else if (bbox !== undefined) {
    const problems = bboxProblems(bbox);
    if (problems.length) return refuse('malformed', problems.join('; '));
    scopeBbox = bbox as Bbox;
  } else if (ring !== undefined) {
    const problems = ringProblems(ring);
    if (problems.length) return refuse('malformed', problems.join('; '));
    scopeRing = ring as number[][];
  }

  let scopeFilter: string | null = null;
  if (filter !== undefined) {
    if (typeof filter !== 'string') return refuse('malformed', 'filter must be a string.');
    const trimmed = filter.trim().toLowerCase();
    scopeFilter = trimmed === '' ? null : trimmed;
  }

  const scope = { place: scopePlace, bbox: scopeBbox, ring: scopeRing, filter: scopeFilter };

  // Our own trove. Checked before the catalogue so an ingested provider is
  // reachable, but sdkIdIsClaimable refuses any id the catalogue owns, so a
  // catalogue layer is never shadowed by an upload.
  if (sdkIdIsClaimable(layerId)) {
    const items = sdkLayerItems(layerId);
    if (items === undefined) {
      return refuse(
        'unknown_layer',
        `${layerId} is not a catalogue layer and no ingested provider backs it. ` +
        'Push entities to /api/sdk/ingest with that source name first.',
      );
    }
    // Push-fed, so never cold: if the store has the provider, it is there.
    // ageSeconds is NULL and not 0. Nothing here measures when those entities
    // were observed; each carries its own timestamp from whoever pushed it, and
    // this server never polls. Zero would assert "measured just now" on no
    // measurement at all. Found by the outside voice.
    return shape(
      layerId,
      {
        cold: false, coldReason: null, coldDetail: null,
        stale: false, ageSeconds: null, lastError: null,
        items,
      },
      scope,
      limits,
    );
  }

  const row = osirisLayer(layerId);
  if (!row) {
    return refuse('unknown_layer', `${layerId} is not a layer in this app's catalogue.`);
  }

  // Not live: answered, not refused, and the reason is the catalogue's own
  // sentence rather than a word this file made up. 313-22b's dead rows are read
  // as they stand and reported honestly; fixing them is a different row.
  if (row.status !== 'live') {
    return shape(
      layerId,
      {
        cold: true,
        coldReason: row.status as ColdReason,
        coldDetail: row.source,
        stale: false, ageSeconds: null, lastError: null,
        items: [],
      },
      scope,
      limits,
    );
  }

  const registered = earthLayer(layerId);
  if (!registered) {
    return shape(
      layerId,
      {
        cold: true,
        coldReason: 'not_served_here',
        coldDetail:
          `${layerId} is live in the catalogue but this server has no fetcher for it yet, ` +
          'so there is nothing cached to answer from.',
        stale: false, ageSeconds: null, lastError: null,
        items: [],
      },
      scope,
      limits,
    );
  }

  const record = layerRecord(layerId);
  if (!record || !record.everFetched) {
    return shape(
      layerId,
      {
        cold: true,
        coldReason: 'never_fetched',
        coldDetail:
          record
            ? `${layerId} is registered but has not completed a fetch yet` +
              (record.lastError ? `; last attempt failed: ${record.lastError}` : '.')
            : `${layerId} is registered but the earth server is not running.`,
        stale: false,
        ageSeconds: null,
        lastError: record?.lastError ?? null,
        items: [],
      },
      scope,
      limits,
    );
  }

  // Warm. Including warm-with-zero-rows, which is a real answer.
  const ageMs = record.fetchedAt === null ? 0 : now - record.fetchedAt;
  // lastRefreshEmpty counts as stale: the rows being served survived a refresh
  // that returned nothing, so they are older than the last successful cycle.
  const stale =
    record.lastError !== null || record.lastRefreshEmpty || ageMs > registered.ttlMs;

  return shape(
    layerId,
    {
      cold: false,
      coldReason: null,
      coldDetail: null,
      stale,
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
      lastError: record.lastError,
      items: layerItems(layerId),
    },
    scope,
    limits,
  );
}
