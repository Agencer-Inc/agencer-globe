import { describe, it, expect } from 'vitest';
import {
  PLACES, resolvePlace, normalisePlace, inBbox, bboxProblems,
  placesTableProblems, knownPlaces, type Bbox,
} from './places';

describe('the place table', () => {
  it('every row is reachable, well-formed and says what it is drawn around', () => {
    expect(placesTableProblems()).toEqual([]);
  });

  it('carries the demo set the ride needs', () => {
    expect(knownPlaces()).toEqual(['ankara', 'istanbul', 'japan', 'paris', 'tokyo']);
  });
});

describe('resolvePlace', () => {
  it('resolves a demo place to its box', () => {
    const got = resolvePlace('Paris');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.bbox).toEqual(PLACES.paris.bbox);
  });

  it('normalises case and inner whitespace before looking up', () => {
    expect(normalisePlace('  ToKYo  ')).toBe('tokyo');
    expect(resolvePlace('  ToKYo  ').ok).toBe(true);
  });

  // The whole reason this table exists rather than a geocoder.
  it('refuses an unknown place BY NAME instead of guessing a nearby one', () => {
    const got = resolvePlace('Marseille');
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.refusal).toBe('place_unknown');
      expect(got.detail).toContain('Marseille');
      expect(got.detail).toContain('paris');
    }
  });

  // "Paris" must not be reachable via an airport city field or a prefix match.
  // A wrong answer that looks right is worse than a refusal.
  it('does not substring-match, so a longer name is refused rather than approximated', () => {
    expect(resolvePlace('Paris, France').ok).toBe(false);
    expect(resolvePlace('par').ok).toBe(false);
    expect(resolvePlace('CDG').ok).toBe(false);
  });

  it('refuses an empty place by name', () => {
    const got = resolvePlace('   ');
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('place_unknown');
  });
});

describe('inBbox', () => {
  const paris = PLACES.paris.bbox;

  it('contains a point inside and excludes one outside', () => {
    expect(inBbox(48.86, 2.35, paris)).toBe(true);   // Notre-Dame
    expect(inBbox(43.30, 5.37, paris)).toBe(false);  // Marseille
  });

  it('excludes a point at the right longitude but the wrong latitude', () => {
    expect(inBbox(10.0, 2.35, paris)).toBe(false);
  });

  // A box that wraps the antimeridian has west > east. The naive
  // `lng >= west && lng <= east` is false for EVERY point in such a box, which
  // reads as quiet airspace rather than as a bug.
  it('handles a box that crosses the antimeridian', () => {
    const bering: Bbox = [170, 50, -170, 66];
    expect(inBbox(60, 179, bering)).toBe(true);
    expect(inBbox(60, -179, bering)).toBe(true);
    expect(inBbox(60, 0, bering)).toBe(false);
  });

  it('rejects a non-finite coordinate rather than letting NaN compare its way through', () => {
    expect(inBbox(NaN, 2.35, paris)).toBe(false);
    expect(inBbox(48.86, NaN, paris)).toBe(false);
  });
});

describe('bboxProblems', () => {
  it('passes a well-formed box', () => {
    expect(bboxProblems([1.8, 48.5, 3.0, 49.2])).toEqual([]);
  });

  it('allows west > east, because that is the antimeridian and it is legal', () => {
    expect(bboxProblems([170, 50, -170, 66])).toEqual([]);
  });

  it('names every way a box can be wrong, rather than returning a bare false', () => {
    expect(bboxProblems('nope')[0]).toContain('must be an array');
    expect(bboxProblems([1, 2, 3])[0]).toContain('four numbers');
    expect(bboxProblems([1, 2, 3, 'x'])[0]).toContain('north is not a finite number');
    expect(bboxProblems([1, 2, 3, NaN])[0]).toContain('north is not a finite number');
    expect(bboxProblems([-200, 0, 10, 10])[0]).toContain('outside -180..180');
    expect(bboxProblems([0, 80, 10, 10])[0]).toContain('is north of north');
  });
});
