/**
 * OSIRIS earth server — the measuring door.
 *
 * Answers "how far is it from here to there?" and nothing else. No state, no
 * cache, no network: every number below comes out of geo.ts, which was written
 * and tested long before anything could ask it a question.
 *
 *   { userId?, path: [[lng,lat], ...] }
 *     |
 *     +-- no userId ------------------> refuse `anonymous`  (THE-GATE rule 3)
 *     +-- pathProblems() is not empty -> refuse `malformed`, problems in words
 *     |
 *     v
 *   leg distances -> total -> initial bearing -> formatted readout
 *
 * WHY THIS IS NOT A CONTROL-DOOR VERB. The control door's acks say what
 * CHANGED (control-door.ts:86-94). A measurement changes nothing; it is a fact
 * about the world that the caller wants back. Putting it on the control door
 * would make that door answer "what is there", which is the query side's job,
 * and the two would stop being separable. Control performs, query knows.
 *
 * ACCURACY, SAID OUT LOUD. geo.ts is spherical rather than ellipsoidal and its
 * header states the cost: up to ~0.5% against WGS84. A consumer putting this
 * number on a screen is entitled to know that before it does, so the figure is
 * repeated here rather than left one file away.
 */

import { haversine, bearing, compassPoint, formatDistance, lngLatProblems, type LngLat } from '@/lib/geo';

/**
 * The most points one measurement may carry.
 *
 * The query door caps its answer at 50 rows so no caller can turn it into a
 * feed dump (query.ts:43-44); the same reasoning binds the input side here. A
 * path is drawn by a person or planned by a brain, and neither produces
 * hundreds of legs — but nothing in the wire format stops a caller sending a
 * hundred thousand, and the sweep is O(n) with a trigonometric constant.
 */
export const MAX_PATH_POINTS = 512;

export type MeasureRefusal = 'anonymous' | 'malformed';

export interface MeasureLeg {
  km: number;
  /** Initial bearing of THIS leg, degrees clockwise from north. */
  bearing: number;
}

export interface MeasureAnswer {
  ok: true;
  /** How many points were measured, so a caller can check nothing was dropped. */
  points: number;
  km: number;
  /** formatDistance() verbatim: metres under a kilometre, then km. */
  formatted: string;
  /**
   * The course the path LEAVES on — the first leg's initial bearing.
   *
   * Not a course anyone can hold: a great circle changes heading along its
   * length (geo.ts:36-41). Named `bearing` because that is what geo.ts calls
   * it, and the per-leg figures are in `legs` for anyone who needs the rest.
   */
  bearing: number;
  compass: string;
  legs: MeasureLeg[];
  /** Stated on every answer, because the consumer draws conclusions from it. */
  accuracyNote: string;
}

export interface MeasureRefused {
  ok: false;
  refusal: MeasureRefusal;
  detail: string;
}

export type MeasureOutcome = MeasureAnswer | MeasureRefused;

export interface MeasureInput {
  path?: unknown;
}

export interface MeasureContext {
  /** THE-GATE rule 3: the door names the user. Anonymous is refused by name. */
  userId?: string | null;
}

const ACCURACY_NOTE =
  'Spherical earth, mean radius 6371 km. Up to ~0.5% from a WGS84 ellipsoidal ' +
  'distance, which is well inside the error of the positions being measured.';

/**
 * The rules a path from the wire has to obey, returned in words.
 *
 * Words rather than a boolean for the same reason bboxProblems does it
 * (places.ts:136-143): a caller told only "invalid" cannot fix anything. Each
 * problem names the INDEX of the offending point, because a caller sending a
 * forty-leg path needs to know which leg it got wrong.
 */
export function pathProblems(path: unknown): string[] {
  if (!Array.isArray(path)) {
    return ['path must be an array of [lng, lat] pairs'];
  }
  if (path.length < 2) {
    return [
      `path needs at least two points to have a length, got ${path.length}` +
      (path.length === 1 ? ': one point is a place, not a distance' : ''),
    ];
  }
  if (path.length > MAX_PATH_POINTS) {
    return [`path has ${path.length} points, more than the ${MAX_PATH_POINTS} this door measures in one call`];
  }

  const problems: string[] = [];
  for (let i = 0; i < path.length; i++) {
    // geo.ts owns the per-point rules, because the control door's draw verb
    // asks the same question and one rule with two copies is one rule that
    // drifts. It names the point, so a forty-leg path says which leg was wrong.
    problems.push(...lngLatProblems(path[i], `point ${i}`));
  }
  return problems;
}

function refuse(refusal: MeasureRefusal, detail: string): MeasureRefused {
  return { ok: false, refusal, detail };
}

/**
 * Measure one path.
 *
 * Pure. Nothing here reads the clock, the cache, the scheduler or the network,
 * which is what lets the door answer in the time it takes to walk an array.
 */
export function planMeasure(input: MeasureInput, ctx: MeasureContext = {}): MeasureOutcome {
  // Rule 3, first and unconditionally, before the path is even looked at.
  if (typeof ctx.userId !== 'string' || ctx.userId.trim() === '') {
    return refuse('anonymous', 'This door names its caller. Send a user id; anonymous measurements are refused.');
  }

  const problems = pathProblems(input.path);
  if (problems.length) return refuse('malformed', problems.join('; '));

  const path = input.path as LngLat[];

  const legs: MeasureLeg[] = [];
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    const legKm = haversine(path[i - 1], path[i]);
    km += legKm;
    legs.push({ km: legKm, bearing: bearing(path[i - 1], path[i]) });
  }

  // Always at least one leg: pathProblems refused anything shorter.
  const initial = legs[0].bearing;

  return {
    ok: true,
    points: path.length,
    km,
    formatted: formatDistance(km),
    bearing: initial,
    compass: compassPoint(initial),
    legs,
    accuracyNote: ACCURACY_NOTE,
  };
}
