/**
 * OSIRIS earth server — the place table.
 *
 * HAND-WRITTEN. Every box below was typed by a person reading a map. Nothing
 * here was resolved by a geocoder, and this table is the entire extent of this
 * server's geography: if a name is not in it, the door refuses by name
 * (`place_unknown`) rather than guessing.
 *
 * Written for the 313-26 demo ride ("show me flights over Paris"), which is the
 * consumer these particular five rows exist for (Law 6: name the consumer a
 * default was written for, at the definition site). A second consumer that
 * needs a sixth place does NOT get it by cleverness; it gets a row here, or a
 * real geocoder (booked as 313-23b).
 *
 * Deriving a box from airports.ts city fields was considered and rejected. That
 * table is keyed by IATA/ICAO (airports.ts:442) and its city field is the 4th
 * element of an airport tuple (airports.ts:128) — it yields a POINT for one
 * airfield, not a box for a city, and "Paris" would silently become "wherever
 * CDG is". A wrong answer that looks right is worse than a refusal.
 *
 *   name --normalise--> exact key lookup --hit--> bbox
 *                             |
 *                             +--miss--> { refusal: 'place_unknown' }
 *                                        (never fuzzy, never nearest)
 */

/** [west, south, east, north] in degrees. The order GeoJSON bbox uses. */
export type Bbox = [number, number, number, number];

export interface PlaceRow {
  /** The box, typed by hand from a map. */
  bbox: Bbox;
  /** What the box was drawn around, so a reader can check it without a tool. */
  note: string;
}

/**
 * The demo set, and nothing else.
 *
 * Keys are already normalised (lowercase, single-spaced). `normalisePlace`
 * below is the only thing that produces a lookup key, so a row whose key is not
 * normalised is unreachable — placesTableProblems() pins exactly that.
 */
export const PLACES: Readonly<Record<string, PlaceRow>> = {
  paris: {
    bbox: [1.8, 48.5, 3.0, 49.2],
    note: 'Greater Paris and its approach corridors, wide enough that arriving traffic is inside the box.',
  },
  tokyo: {
    bbox: [139.3, 35.3, 140.2, 36.0],
    note: 'Tokyo metropolitan area including Haneda and the Chiba side of the bay.',
  },
  japan: {
    bbox: [128.0, 30.0, 146.0, 46.0],
    note: 'The Japanese archipelago from Okinawa in the southwest to Hokkaido in the northeast.',
  },
  ankara: {
    bbox: [32.3, 39.6, 33.2, 40.2],
    note: 'Ankara province around the capital.',
  },
  istanbul: {
    bbox: [28.4, 40.7, 29.6, 41.4],
    note: 'Istanbul across both the European and Anatolian sides of the Bosphorus.',
  },
};

/**
 * Lowercase and collapse whitespace. That is the WHOLE normalisation.
 *
 * No stemming, no accent folding, no substring matching. Each of those would be
 * a rule that turns one place name into a different place's box, and there is
 * no way to test "it never guessed wrong" against an open-ended input space.
 * Refusing is testable; guessing is not.
 */
export function normalisePlace(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type PlaceLookup =
  | { ok: true; key: string; bbox: Bbox; note: string }
  | { ok: false; refusal: 'place_unknown'; detail: string };

/** Resolve a place name to its box, or refuse it by name. Never guesses. */
export function resolvePlace(name: string): PlaceLookup {
  if (typeof name !== 'string' || name.trim() === '') {
    return {
      ok: false,
      refusal: 'place_unknown',
      detail: 'place was empty. Known places: ' + knownPlaces().join(', '),
    };
  }
  const key = normalisePlace(name);
  const row = PLACES[key];
  if (!row) {
    return {
      ok: false,
      refusal: 'place_unknown',
      detail:
        `"${name}" is not in this server's hand-written place table. ` +
        'Send a bbox instead, or ask for one of: ' + knownPlaces().join(', '),
    };
  }
  return { ok: true, key, bbox: row.bbox, note: row.note };
}

/** Every place name this server will answer to, sorted for a stable message. */
export function knownPlaces(): string[] {
  return Object.keys(PLACES).sort();
}

/**
 * Does a point fall inside the box?
 *
 * Handles a box that crosses the antimeridian (west > east, e.g. the Bering
 * Strait). No row in PLACES does that today, but a caller-supplied bbox can,
 * and the naive `lng >= west && lng <= east` returns FALSE for every point in
 * such a box — an empty answer that looks like quiet airspace rather than a
 * bug. Tested both ways round.
 */
export function inBbox(lat: number, lng: number, bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < south || lat > north) return false;
  return west <= east
    ? lng >= west && lng <= east
    : lng >= west || lng <= east; // crosses the antimeridian
}

/**
 * Rules a bbox from the wire has to obey before it reaches inBbox.
 *
 * Returns problems in words rather than a boolean, for the same reason
 * catalogRowProblems does (layers-catalog.ts:149-153): a caller told only
 * "invalid" cannot fix anything. Note there is deliberately no west<east rule —
 * that is the antimeridian case above, and it is legal.
 */
export function bboxProblems(bbox: unknown): string[] {
  if (!Array.isArray(bbox)) return ['bbox must be an array of four numbers [west, south, east, north]'];
  if (bbox.length !== 4) return [`bbox must have four numbers, got ${bbox.length}`];

  const problems: string[] = [];
  const names = ['west', 'south', 'east', 'north'];
  for (let i = 0; i < 4; i++) {
    if (typeof bbox[i] !== 'number' || !Number.isFinite(bbox[i])) {
      problems.push(`${names[i]} is not a finite number`);
    }
  }
  if (problems.length) return problems;

  const [west, south, east, north] = bbox as Bbox;
  if (west < -180 || west > 180) problems.push(`west ${west} is outside -180..180`);
  if (east < -180 || east > 180) problems.push(`east ${east} is outside -180..180`);
  if (south < -90 || south > 90) problems.push(`south ${south} is outside -90..90`);
  if (north < -90 || north > 90) problems.push(`north ${north} is outside -90..90`);
  if (south > north) problems.push(`south ${south} is north of north ${north}`);
  return problems;
}

/**
 * Pin support: a PLACES key that is not already normalised can never be hit,
 * because resolvePlace only ever looks up a normalised key. A table row that is
 * unreachable is a row that silently does not exist (Law 31).
 */
export function placesTableProblems(): string[] {
  const problems: string[] = [];
  for (const [key, row] of Object.entries(PLACES)) {
    if (normalisePlace(key) !== key) {
      problems.push(`place key "${key}" is not normalised, so resolvePlace can never reach it`);
    }
    problems.push(...bboxProblems(row.bbox).map(p => `place "${key}": ${p}`));
    if (!row.note.trim()) problems.push(`place "${key}" has no note saying what the box is drawn around`);
  }
  return problems;
}
