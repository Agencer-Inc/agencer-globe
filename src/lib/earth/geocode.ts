/**
 * OSIRIS earth server — turning a geocoder hit into a place candidate.
 *
 * api/geosearch answers with POINTS. The place table stores BOXES, because
 * "flights over Paris" needs an area and not a dot (places.ts:37-43). This
 * module is the step between, and every rule it applies is written down here
 * rather than inferred at the call site.
 *
 *   GeoHit (a point, sometimes a box)
 *     |
 *     +-- the publisher sent a box? ----> use it VERBATIM, bboxSource 'upstream'
 *     +-- it did not? -----------------> a circle by kind, bboxSource 'derived'
 *     |
 *     v
 *   PlaceCandidate — keyed by the name that was ASKED, carrying the context
 *                    that tells two places of one name apart
 *
 * NOTHING HERE CHOOSES. It shapes candidates and hands back all of them; the
 * caller picks, because the caller is the only party that knows whether it
 * meant Paris in France or Paris in Texas. That is the whole reason the fuzzy
 * step sits at its own door instead of behind resolvePlace: a geocoder ranking
 * silently is a guess, and a refusal beats a guess — but a caller choosing from
 * candidates with their context in front of it is neither.
 */

import { destination } from '@/lib/geo';
import { bboxProblems, normalisePlace, type Bbox } from './places';

/**
 * What api/geosearch returns, structurally.
 *
 * Declared rather than imported: that module is a route and pulls
 * next/server with it, and nothing in lib/earth should drag a Response type
 * into itself to name six fields. GeoResult satisfies this shape.
 */
export interface GeoHit {
  name: string;
  context: string;
  lat: number;
  lng: number;
  kind: string;
  source: 'photon' | 'nominatim';
  bbox?: Bbox;
  bboxSource?: 'upstream';
}

export interface PlaceCandidate {
  /** The key a confirm would write, normalised from the name that was ASKED. */
  key: string;
  /** What the publisher calls it. May differ from the asked name entirely. */
  label: string;
  /** What tells two places of one name apart: "Texas, United States". */
  context: string;
  bbox: Bbox;
  /** Whether the publisher drew this box or this module did. */
  bboxSource: 'upstream' | 'derived';
  kind: string;
  resolvedBy: 'photon' | 'nominatim';
  /** The sentence stored with the row, saying what the box is drawn around. */
  note: string;
}

/**
 * How big a box to draw around a point when the publisher gave none.
 *
 * These are radii in km and they are guesses — stated as such, in the note on
 * every row that uses one, and flagged by `bboxSource: 'derived'` so a caller
 * never has to infer it from the numbers. The kinds are api/geosearch's own
 * (classifyKind), not a second vocabulary.
 *
 * A country or a region reaching this table is a bad sign rather than a normal
 * one: both upstreams publish real administrative extents, so an administrative
 * hit with no box usually means the feature is not what it claimed. The figures
 * are here so the candidate can still be OFFERED and judged, not so it can be
 * trusted.
 */
export const RADIUS_KM_BY_KIND: Readonly<Record<string, number>> = {
  country: 200,
  region: 100,
  city: 15,
  place: 5,
  poi: 1,
  street: 1,
  address: 0.2,
};

/** Used for a kind with no rule of its own. Small on purpose: a box that is too
 *  small returns too little and is noticed, where one that is too big returns a
 *  neighbouring city's traffic and looks correct. */
export const DEFAULT_RADIUS_KM = 2;

/** The most candidates one resolve offers. Matches geosearch's own merge cap. */
export const MAX_CANDIDATES = 8;

/**
 * A box of true geodesic radius around a point.
 *
 * Walks four real bearings rather than scaling degrees, for the reason
 * circleToRing does (geo.ts:117-128): a degree of longitude shortens toward the
 * poles, so a naive offset becomes an ellipse — over Svalbard, not subtly. The
 * box is therefore WIDER in degrees the further north it sits, which is what
 * makes its east-west reach a real distance.
 */
export function boxAround(lat: number, lng: number, radiusKm: number): Bbox {
  const from: [number, number] = [lng, lat];
  const north = Math.min(90, destination(from, 0, radiusKm)[1]);
  const south = Math.max(-90, destination(from, 180, radiusKm)[1]);
  const east = destination(from, 90, radiusKm)[0];
  const west = destination(from, 270, radiusKm)[0];
  // west > east is legal and means the box crosses the antimeridian; inBbox
  // handles it both ways round (places.ts:118-126), so it is left alone.
  return [west, south, east, north];
}

/**
 * Shape one hit into a candidate, or null when it cannot be used.
 *
 * `asked` is the name the CALLER used, and it is what the key is built from. An
 * upstream's own label is stored as `label` and never as the key: keying by it
 * would write "Polska" and go on refusing "Poland" forever.
 */
export function toCandidate(asked: string, hit: GeoHit): PlaceCandidate | null {
  if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null;
  if (Math.abs(hit.lat) > 90 || Math.abs(hit.lng) > 180) return null;

  // The publisher's box wins, but only if it survives the same check the query
  // door would put it through. A box that fails is not passed on as a smaller
  // problem — it is discarded, and the point is used instead, because a broken
  // extent silently filters a whole layer to nothing.
  const published = hit.bbox && bboxProblems(hit.bbox).length === 0 ? hit.bbox : undefined;

  const radiusKm = RADIUS_KM_BY_KIND[hit.kind] ?? DEFAULT_RADIUS_KM;
  const bbox = published ?? boxAround(hit.lat, hit.lng, radiusKm);
  const bboxSource: 'upstream' | 'derived' = published ? 'upstream' : 'derived';

  const where = hit.context ? `${hit.name} — ${hit.context}` : hit.name;
  const note = published
    ? `${where}; bounding box as published by ${hit.source}.`
    : `${where}; no box published, so this is a ${radiusKm} km circle around the ` +
      `point ${hit.source} returned for a ${hit.kind}.`;

  return {
    key: normalisePlace(asked),
    label: hit.name,
    context: hit.context,
    bbox,
    bboxSource,
    kind: hit.kind,
    resolvedBy: hit.source,
    note,
  };
}

/**
 * Shape every usable hit, in the order they arrived.
 *
 * The order is geosearch's, which already promotes a globally prominent
 * landmark over a lexical match (route.ts:53-60). Nothing here re-ranks: a
 * second opinion on ordering would be this module quietly choosing, and it
 * does not choose.
 */
export function toCandidates(asked: string, hits: readonly GeoHit[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  for (const hit of hits) {
    if (out.length >= MAX_CANDIDATES) break;
    const candidate = toCandidate(asked, hit);
    if (candidate) out.push(candidate);
  }
  return out;
}
