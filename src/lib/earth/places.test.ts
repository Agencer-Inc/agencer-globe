import { describe, it, expect, afterEach } from 'vitest';
import {
  PLACES, resolvePlace, normalisePlace, inBbox, bboxProblems,
  placesTableProblems, knownPlaces, rememberPlace, clearPlaceCache,
  cachedPlaces, type Bbox,
} from './places';

afterEach(() => clearPlaceCache());

describe('the place table', () => {
  it('every row is reachable, well-formed and says what it is drawn around', () => {
    expect(placesTableProblems()).toEqual([]);
  });

  it('carries the demo set the ride needs', () => {
    expect(knownPlaces()).toEqual(['ankara', 'istanbul', 'japan', 'paris', 'tokyo']);
  });
});

/**
 * The resolve door (api/earth/resolve) is the only thing that reaches a
 * geocoder, and it writes what a caller CONFIRMED into this cache. resolvePlace
 * itself stays exactly what it was: an exact lookup that never guesses and
 * never reaches the network. All that changed is the size of the table it
 * looks in.
 */
describe('the resolved-place cache', () => {
  const POLAND: Bbox = [14.122929, 49.002046, 24.1458933, 54.8357841];

  it('refuses a place until something confirms it, then resolves it', () => {
    expect(resolvePlace('poland').ok).toBe(false);

    rememberPlace('Poland', { bbox: POLAND, note: 'Nominatim administrative boundary for Polska.' });

    const got = resolvePlace('poland');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.bbox).toEqual(POLAND);
  });

  it('normalises on the way in, so the key a lookup builds is the key that was written', () => {
    rememberPlace('  The  Canary Islands ', { bbox: POLAND, note: 'n/a' });
    expect(resolvePlace('the canary islands').ok).toBe(true);
  });

  /* A hand row was typed by a person reading a map and reviewed in a diff; a
     cached one came from a fuzzy index. When both answer to a name, the one a
     human wrote wins, or an upstream could quietly move Paris. */
  it('never lets a cached row shadow a hand-written one', () => {
    rememberPlace('paris', { bbox: [0, 0, 1, 1], note: 'an upstream disagreeing about Paris' });

    const got = resolvePlace('Paris');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.bbox).toEqual(PLACES.paris.bbox);
  });

  /* places.ts:93-100 found this once on the hand table: every key on
     Object.prototype resolves through a bare index to something TRUTHY with no
     bbox, so the caller reads ok:true, drops its geographic filter and returns
     a whole layer for a query that named one city. A Map cannot reintroduce it,
     and this pin is what says so. */
  it('still misses on an inherited key, through the cache as well', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(resolvePlace(key).ok, key).toBe(false);
    }
  });

  it('lists what it has learned, and forgets it on command', () => {
    rememberPlace('Poland', { bbox: POLAND, note: 'n/a' });
    expect(cachedPlaces()).toEqual(['poland']);
    expect(knownPlaces()).toContain('poland');

    clearPlaceCache();
    expect(cachedPlaces()).toEqual([]);
    expect(resolvePlace('poland').ok).toBe(false);
  });

  it('refuses to remember a box that is not one', () => {
    expect(() => rememberPlace('nowhere', { bbox: [1, 2, 3] as unknown as Bbox, note: 'x' })).toThrow();
    expect(resolvePlace('nowhere').ok).toBe(false);
  });

  /* A caller told only "unknown" cannot act. Told that a door exists which can
     resolve the name, it can. */
  it('points an unknown name at the door that can resolve it', () => {
    const got = resolvePlace('gdansk');
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.detail).toMatch(/resolve/i);
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

  // Found by the outside voice. PLACES is an ordinary object, so every key on
  // Object.prototype resolves through it and is TRUTHY with an undefined bbox.
  // The caller then sees ok:true with no box and drops the geographic filter
  // entirely. The "Marseille" pin above could never catch this: a normal miss
  // is falsy, an inherited one is not.
  it('refuses an inherited prototype key, which is truthy but carries no box', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const got = resolvePlace(key);
      expect(got.ok, `place ${key}`).toBe(false);
      if (!got.ok) expect(got.refusal).toBe('place_unknown');
    }
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
