import { describe, it, expect } from 'vitest';
import { selectEarthItems, ringProblems, MAX_RING_POINTS } from './select';
import { PLACES } from './places';
import type { EarthItem } from './registry';

const at = (id: string, lat: number, lng: number): EarthItem =>
  ({ id, lat, lng, label: id, kind: 'quake', props: {} });

const NOTRE_DAME = at('nd', 48.853, 2.349);
const MARSEILLE = at('mrs', 43.296, 5.370);

/** The Paris box as a ring, so a ring answer can be held against a bbox one. */
const boxRing = (b: readonly number[]) => [
  [b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]],
];

describe('ringProblems names what is wrong, in words', () => {
  it('accepts a closed ring and an open one alike', () => {
    expect(ringProblems([[0, 0], [1, 0], [1, 1]])).toEqual([]);
    expect(ringProblems([[0, 0], [1, 0], [1, 1], [0, 0]])).toEqual([]);
  });

  it('rejects anything that is not an array of points', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      expect(ringProblems(bad), String(bad)).not.toEqual([]);
    }
  });

  /* Two points is a line, and a line encloses nothing. Answering "what is
     inside this?" for a shape with no interior would return an empty list that
     looks like an answer rather than a shape that cannot be asked. */
  it('rejects a ring with fewer than three points, because a line has no interior', () => {
    expect(ringProblems([])).not.toEqual([]);
    expect(ringProblems([[0, 0]])).not.toEqual([]);
    expect(ringProblems([[0, 0], [1, 1]])).not.toEqual([]);
  });

  it('names the vertex that was wrong and flags a swapped pair', () => {
    expect(ringProblems([[0, 0], [1, 0], [999, 0]]).join(' ')).toMatch(/vertex 2/);
    expect(ringProblems([[0, 0], [1, 0], [22.5, 114.05]]).join(' ')).toMatch(/swapped/);
  });

  it('rejects a ring past the cap', () => {
    const atCap = Array.from({ length: MAX_RING_POINTS }, (_, i) => [i % 180, 0]);
    expect(ringProblems(atCap)).toEqual([]);
    expect(ringProblems([...atCap, [0, 0]])).not.toEqual([]);
  });
});

describe('selectEarthItems sweeps what is inside a shape', () => {
  /**
   * The pin that says this is the SAME question the bbox scope answers, asked
   * with a different shape. If a ring drawn around the Paris box ever stops
   * agreeing with the Paris box, one of the two is lying about what it covers.
   */
  it('agrees with the equivalent bbox, to the row', () => {
    const got = selectEarthItems(boxRing(PLACES.paris.bbox), [NOTRE_DAME, MARSEILLE]);
    expect(got.map(i => i.id)).toEqual(['nd']);
  });

  it('keeps the order it was given, so a caller can pair it with its own list', () => {
    const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const inside = [at('a', 1, 1), at('b', 2, 2), at('c', 3, 3)];
    expect(selectEarthItems(ring, inside).map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds nothing in a shape that holds nothing, without complaining', () => {
    expect(selectEarthItems([[0, 0], [1, 0], [1, 1]], [NOTRE_DAME])).toEqual([]);
    expect(selectEarthItems([[0, 0], [1, 0], [1, 1]], [])).toEqual([]);
  });

  /* A concave shape is the whole reason a ring exists rather than a second
     bbox: the notch must actually exclude what sits in it, or a caller would
     be better off sending the bounding box and saving the vertices. */
  it('respects a concave shape, excluding what sits in the notch', () => {
    const vShape = [[0, 0], [10, 0], [10, 10], [5, 1], [0, 10]];
    expect(selectEarthItems(vShape, [at('notch', 8, 5)])).toEqual([]);
    expect(selectEarthItems(vShape, [at('arm', 2, 1)]).map(i => i.id)).toEqual(['arm']);
  });

  it('skips an item whose position is not a pair of real numbers', () => {
    const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const broken = [
      { ...at('ok', 1, 1) },
      { ...at('nan', 1, 1), lat: NaN },
      { ...at('missing', 1, 1), lng: undefined as unknown as number },
    ];
    expect(selectEarthItems(ring, broken).map(i => i.id)).toEqual(['ok']);
  });

  it('does not cap: the caller clamps, and needs the true count first', () => {
    const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const many = Array.from({ length: 120 }, (_, i) => at(`x${i}`, 1, 1));
    expect(selectEarthItems(ring, many)).toHaveLength(120);
  });
});
