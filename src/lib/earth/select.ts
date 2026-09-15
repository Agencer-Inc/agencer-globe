/**
 * OSIRIS earth server — what is inside a shape.
 *
 * "Extract the data actively" was already built, and wired to a mouse:
 * aoi.ts:132 sweeps every tracked layer against a drawn ring and reports what
 * is in it, grouped and counted. Nothing could ask it. This is the same
 * question, asked of what the EARTH SERVER holds.
 *
 * WHY THIS IS NOT aoi.ts. That function sweeps `Record<string, any>` — the
 * eleven-key live store page.tsx keeps in the browser (commercial_flights,
 * satellites, cameras, maritime_ships and the rest). This one sweeps
 * EarthItem[], which is what the scheduler holds and what the query door can
 * answer from with provenance attached. They answer the same question over
 * different universes, and merging them would make one of the two lie about
 * what it covers. aoi.ts keeps doing exactly what it does.
 *
 * The geometry itself is NOT rewritten: pointInPolygon and bboxOf are imported
 * from aoi.ts. That buys the cheap bbox rejection the sweep needs to stay
 * affordable, and the vertex-crossing rule that keeps a point on the boundary
 * stable instead of flickering in and out as a shape is redrawn — both already
 * reasoned about and pinned there.
 */

import { pointInPolygon, bboxOf } from '@/lib/aoi';
import { lngLatProblems } from '@/lib/geo';
import type { EarthItem } from './registry';

/**
 * The most vertices a ring from the wire may carry.
 *
 * Matches the control door's own shape cap. The sweep is O(items x vertices)
 * with no early exit inside the ray cast, so a ring is the one input here that
 * multiplies the cost of every row rather than adding to it.
 */
export const MAX_RING_POINTS = 512;

/**
 * The rules a ring must obey, returned in words.
 *
 * The same standard bboxProblems (places.ts:136-143) and registryProblems hold,
 * and pinned against rings built to break each rule: a validator nobody proved
 * rejects anything is a validator that passes everything (Law 31).
 */
export function ringProblems(ring: unknown): string[] {
  if (!Array.isArray(ring)) {
    return ['ring must be an array of [lng, lat] pairs'];
  }
  if (ring.length < 3) {
    return [
      `a ring needs at least three points to enclose anything, got ${ring.length}` +
      (ring.length === 2 ? ': two points are a line, and a line has no interior' : ''),
    ];
  }
  if (ring.length > MAX_RING_POINTS) {
    return [`ring has ${ring.length} points, more than the ${MAX_RING_POINTS} this door sweeps`];
  }

  const problems: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    problems.push(...lngLatProblems(ring[i], `vertex ${i}`));
  }
  return problems;
}

/**
 * Everything in `items` that falls inside `ring`, in the order given.
 *
 * DELIBERATELY UNCAPPED. aoi.ts caps its per-group listing at 50 because it
 * feeds a panel a person reads; this feeds the query door, which needs the true
 * count BEFORE it clamps so it can report `matched` honestly (query.ts:114-118).
 * Capping here would make the door's own honesty impossible.
 *
 * An item whose position is not a pair of real numbers is skipped rather than
 * counted at [0,0], which is a real place in the Gulf of Guinea.
 */
export function selectEarthItems(ring: number[][], items: readonly EarthItem[]): EarthItem[] {
  if (!ring || ring.length < 3) return [];

  // The overwhelming majority fail on a pair of numeric comparisons: a
  // city-sized ring against thousands of aircraft rejects nearly all of them
  // before the ray cast runs at all.
  const box = bboxOf(ring);
  const out: EarthItem[] = [];

  for (const item of items) {
    const { lat, lng } = item;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < box.west || lng > box.east || lat < box.south || lat > box.north) continue;
    if (!pointInPolygon(lng, lat, ring)) continue;
    out.push(item);
  }

  return out;
}
