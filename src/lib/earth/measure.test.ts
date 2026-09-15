import { describe, it, expect } from 'vitest';
import { planMeasure, pathProblems, MAX_PATH_POINTS } from './measure';
import { haversine, bearing, formatDistance, compassPoint } from '@/lib/geo';

const USER = { userId: 'op-1' };

/** Hong Kong island, and Shenzhen across the boundary on the mainland. */
const HONG_KONG: [number, number] = [114.1694, 22.3193];
const SHENZHEN: [number, number] = [114.0579, 22.5431];

describe('the door names its caller (THE-GATE rule 3)', () => {
  it('refuses an anonymous measurement BY NAME', () => {
    const got = planMeasure({ path: [HONG_KONG, SHENZHEN] }, {});
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('anonymous');
  });

  it('refuses a blank or non-string user id', () => {
    for (const userId of ['', '   ', null, undefined, 7 as unknown as string]) {
      const got = planMeasure({ path: [HONG_KONG, SHENZHEN] }, { userId: userId as string });
      expect(got.ok, `userId ${JSON.stringify(userId)}`).toBe(false);
    }
  });

  // Checked FIRST, before the path is even looked at: a door that validates its
  // input before naming its caller has already done work for a stranger.
  it('names the caller before it judges the path', () => {
    const got = planMeasure({ path: 'not a path' }, {});
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('anonymous');
  });
});

/**
 * The validator is pinned against paths built to break each rule, because a
 * validator nobody proved rejects anything is a validator that passes
 * everything (Law 31). Same standard as bboxProblems and registryProblems.
 */
describe('pathProblems names what is wrong, in words', () => {
  it('accepts a well-formed path', () => {
    expect(pathProblems([HONG_KONG, SHENZHEN])).toEqual([]);
  });

  it('rejects a path that is not an array', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      expect(pathProblems(bad), String(bad)).not.toEqual([]);
    }
  });

  it('rejects a path with fewer than two points: one point is a place, not a distance', () => {
    expect(pathProblems([])).not.toEqual([]);
    expect(pathProblems([HONG_KONG])).not.toEqual([]);
  });

  it('rejects a point that is not a pair of numbers', () => {
    expect(pathProblems([HONG_KONG, [114.05]])).not.toEqual([]);
    expect(pathProblems([HONG_KONG, [114.05, 22.5, 7]])).not.toEqual([]);
    expect(pathProblems([HONG_KONG, ['114.05', '22.5']])).not.toEqual([]);
    expect(pathProblems([HONG_KONG, null])).not.toEqual([]);
  });

  it('rejects a non-finite coordinate', () => {
    expect(pathProblems([HONG_KONG, [NaN, 22.5]])).not.toEqual([]);
    expect(pathProblems([HONG_KONG, [114.05, Infinity]])).not.toEqual([]);
  });

  it('rejects a coordinate outside its own range, and says which', () => {
    const tooFarEast = pathProblems([HONG_KONG, [181, 22.5]]);
    expect(tooFarEast.join(' ')).toMatch(/lng/);
    const tooFarNorth = pathProblems([HONG_KONG, [114.05, 91]]);
    expect(tooFarNorth.join(' ')).toMatch(/lat/);
  });

  /**
   * The single most common bug in geospatial code, and the reason geo.ts never
   * varies its axis order. A swapped pair inside the legal ranges cannot be
   * detected, but one outside them must be named rather than measured.
   */
  it('rejects a plainly swapped pair (lat in the lng slot)', () => {
    expect(pathProblems([[51.5074, -0.1278], [114.05, 22.5]])).toEqual([]);
    expect(pathProblems([[22.5, 114.05], HONG_KONG]).length).toBeGreaterThan(0);
  });

  it('names the point that was wrong, not just that something was', () => {
    const problems = pathProblems([HONG_KONG, SHENZHEN, [999, 0]]);
    expect(problems.join(' ')).toMatch(/2/);
  });

  it('rejects a path longer than the cap: one verb must not carry a feed', () => {
    const tooMany = Array.from({ length: MAX_PATH_POINTS + 1 }, (_, i) => [i % 180, 0]);
    expect(pathProblems(tooMany)).not.toEqual([]);
    const atCap = Array.from({ length: MAX_PATH_POINTS }, (_, i) => [i % 180, 0]);
    expect(pathProblems(atCap)).toEqual([]);
  });
});

describe('a malformed path is refused by name', () => {
  it('refuses `malformed` and carries the problems as the detail', () => {
    const got = planMeasure({ path: [HONG_KONG] }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.refusal).toBe('malformed');
      expect(got.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('the measurement itself', () => {
  /**
   * The absolute pin. Two points on the 60th parallel, ten degrees apart:
   * 555 km. Read the pair backwards and it becomes ten degrees of LATITUDE,
   * which is 1112 km — so this value catches an axis swap that a mid-latitude
   * city pair would hide.
   */
  it('reads [lng, lat], and a swap would show', () => {
    const got = planMeasure({ path: [[0, 60], [10, 60]] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(Math.round(got.km)).toBe(555);
  });

  it('measures a two-point path as the great-circle distance', () => {
    const got = planMeasure({ path: [HONG_KONG, SHENZHEN] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.km).toBeCloseTo(haversine(HONG_KONG, SHENZHEN), 9);
  });

  it('sums the legs of a multi-point path, and lists each one', () => {
    const LONDON: [number, number] = [-0.1278, 51.5074];
    const PARIS: [number, number] = [2.3522, 48.8566];
    const got = planMeasure({ path: [LONDON, PARIS, HONG_KONG] }, USER);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.legs).toHaveLength(2);
    expect(got.legs[0].km).toBeCloseTo(haversine(LONDON, PARIS), 9);
    expect(got.legs[1].km).toBeCloseTo(haversine(PARIS, HONG_KONG), 9);
    expect(got.km).toBeCloseTo(got.legs[0].km + got.legs[1].km, 9);
  });

  it('reports the course it leaves on, which is the first leg bearing', () => {
    const got = planMeasure({ path: [HONG_KONG, SHENZHEN] }, USER);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.bearing).toBeCloseTo(bearing(HONG_KONG, SHENZHEN), 9);
    expect(got.bearing).toBe(got.legs[0].bearing);
    expect(got.compass).toBe(compassPoint(got.bearing));
  });

  /**
   * A great circle changes heading along its length, so the reported bearing is
   * the one you LEAVE on and not one you can hold. Pinned so a later change
   * cannot quietly start reporting the final bearing under the same name.
   */
  it('reports the INITIAL bearing, not the final one', () => {
    const got = planMeasure({ path: [[0, 60], [90, 60]] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.bearing).toBeCloseTo(bearing([0, 60], [90, 60]), 9);
  });

  it('formats the readout with geo.ts, verbatim', () => {
    const got = planMeasure({ path: [HONG_KONG, SHENZHEN] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.formatted).toBe(formatDistance(got.km));
  });

  it('counts the points it measured', () => {
    const got = planMeasure({ path: [HONG_KONG, SHENZHEN, [114.0, 23.0]] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.points).toBe(3);
  });

  /**
   * Two points either side of the antimeridian are close together, and the
   * naive difference of longitudes makes them almost a whole world apart.
   * haversine already handles it; this pins that the door does not undo it.
   */
  it('measures the short way across the antimeridian', () => {
    const got = planMeasure({ path: [[179.5, 0], [-179.5, 0]] }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(Math.round(got.km)).toBe(111);
  });

  it('measures zero for a path that does not move, without dividing by it', () => {
    const got = planMeasure({ path: [HONG_KONG, HONG_KONG] }, USER);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.km).toBe(0);
    expect(Number.isFinite(got.bearing)).toBe(true);
  });
});
